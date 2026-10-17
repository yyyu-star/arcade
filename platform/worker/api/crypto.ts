/**
 * 哈希与随机数（docs/platform-backend.md 5.1）。
 * 密码：PBKDF2-SHA256 再套一层 pepper HMAC；恢复码、会话令牌、IP：只存 HMAC。各用各的 pepper，带 kid 可轮换。
 */
import type { Env } from '../env';

const enc = new TextEncoder();
/** Crockford base32：去掉了容易看错的 I、L、O、U。 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** n 位 Crockford base32 随机串。256 是 32 的倍数，按位与取余不偏。 */
function randomCrockford(n: number): string {
  let s = '';
  for (const b of randomBytes(n)) s += CROCKFORD[b & 31];
  return s;
}

/** 128 位随机的用户 id。 */
export function newUserId(): string {
  return b64url(randomBytes(16));
}

/** 动态的 id：毫秒时间的 36 进制（补到 9 位）+ 64 位随机。按 id 的字典序就是按时间，Cron 能按范围删。 */
export function newFeedId(now: number): string {
  return feedIdPrefix(now) + b64url(randomBytes(8));
}
export const feedIdPrefix = (ms: number): string => Math.max(0, Math.floor(ms)).toString(36).padStart(9, '0');

/** 96 位随机的邀请 id（16 位 base64url）：知道 id 也只能对自己收到的点"不了"，不用更长。 */
export function newInviteId(): string {
  return b64url(randomBytes(12));
}

/** 20 位、约 100 bit 的恢复码，每 5 位一组给人看。 */
export function newRecoveryCode(): string {
  return randomCrockford(20).replace(/(.{5})(?=.)/g, '$1-');
}

/** 归一化用户输入的恢复码：不分大小写、忽略横线和空格，I、L 当 1，O 当 0。格式不对返回 null。 */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return s.length === 20 && [...s].every((c) => CROCKFORD.includes(c)) ? s : null;
}

export function newFriendCode(): string {
  return randomCrockford(8);
}

/** 归一化好友码：规则同恢复码（不分大小写、忽略横线和空格，I、L 当 1，O 当 0）。格式不对返回 null。 */
export function normalizeFriendCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return s.length === 8 && [...s].every((c) => CROCKFORD.includes(c)) ? s : null;
}

/** 常量时间比较；长度不同直接不等（长度本身不是秘密）。 */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

// ---------- pepper ----------

export type PepperName = 'PEPPER_PW' | 'PEPPER_RC' | 'PEPPER_SID' | 'PEPPER_IP';

export interface Pepper {
  kid: string;
  key: CryptoKey;
}

/** 缺 Secret 或格式不对时抛它，接口返回 503，免得用空 pepper 写出没法验证的哈希。 */
export class MissingSecretError extends Error {}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importHmacKey(secret: string): Promise<CryptoKey> {
  let p = keyCache.get(secret);
  if (!p) {
    p = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, p);
  }
  return p;
}

async function parsePepper(value: string | undefined): Promise<Pepper | null> {
  if (!value) return null;
  const i = value.indexOf(':');
  const kid = value.slice(0, i);
  const secret = value.slice(i + 1);
  if (i <= 0 || !/^[A-Za-z0-9_-]{1,16}$/.test(kid) || secret.length < 16) return null;
  return { kid, key: await importHmacKey(secret) };
}

/** 当前 pepper：新哈希一律用它。 */
async function currentPepper(env: Env, name: PepperName): Promise<Pepper> {
  const p = await parsePepper(env[name]);
  if (!p) throw new MissingSecretError(name);
  return p;
}

/** 按 kid 找 pepper：当前的或 *_PREV。都对不上返回 null（哈希视为不匹配）。 */
async function pepperByKid(env: Env, name: Exclude<PepperName, 'PEPPER_IP'>, kid: string): Promise<Pepper | null> {
  const cur = await currentPepper(env, name);
  if (cur.kid === kid) return cur;
  const prev = await parsePepper(env[`${name}_PREV`]);
  return prev && prev.kid === kid ? prev : null;
}

async function hmac(key: CryptoKey, data: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

// ---------- 密码 ----------

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

/** 存成 pbkdf2-sha256$<迭代次数>$<pepper kid>$<盐>$<哈希>。password 须已归一化（validate.ts）。 */
export async function hashPassword(env: Env, password: string, iterations: number): Promise<string> {
  const pepper = await currentPepper(env, 'PEPPER_PW');
  const salt = randomBytes(16);
  const h = await hmac(pepper.key, await pbkdf2(password, salt, iterations));
  return `pbkdf2-sha256$${iterations}$${pepper.kid}$${b64url(salt)}$${b64url(h)}`;
}

/** ok：密码对不对；rehash：对了但迭代次数或 pepper 已过时，应顺手重哈希。 */
export async function verifyPassword(
  env: Env,
  password: string,
  stored: string,
  iterations: number,
): Promise<{ ok: boolean; rehash: boolean }> {
  const parts = stored.split('$');
  const iter = Number(parts[1]);
  const salt = fromB64url(parts[3] ?? '');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2-sha256' || !Number.isInteger(iter) || iter < 1 || !salt) {
    return { ok: false, rehash: false };
  }
  const pepper = await pepperByKid(env, 'PEPPER_PW', parts[2]!);
  if (!pepper) return { ok: false, rehash: false };
  const h = b64url(await hmac(pepper.key, await pbkdf2(password, salt, iter)));
  const ok = safeEqual(h, parts[4]!);
  const cur = await currentPepper(env, 'PEPPER_PW');
  return { ok, rehash: ok && (iter !== iterations || pepper.kid !== cur.kid) };
}

// ---------- 恢复码 ----------

/** 存成 <kid>$<HMAC(用户 id:归一化的码)>。code 须已归一化。 */
export async function hashRecoveryCode(env: Env, userId: string, code: string): Promise<string> {
  const pepper = await currentPepper(env, 'PEPPER_RC');
  return `${pepper.kid}$${b64url(await hmac(pepper.key, `${userId}:${code}`))}`;
}

export async function verifyRecoveryCode(env: Env, userId: string, code: string, stored: string): Promise<boolean> {
  const i = stored.indexOf('$');
  const pepper = await pepperByKid(env, 'PEPPER_RC', stored.slice(0, i));
  if (i <= 0 || !pepper) return false;
  return safeEqual(b64url(await hmac(pepper.key, `${userId}:${code}`)), stored.slice(i + 1));
}

// ---------- 会话令牌 ----------

/** 新令牌：cookie 里放 <kid>.<令牌>，库里存 <kid>$<HMAC(令牌)>。 */
export async function newSessionToken(env: Env): Promise<{ cookie: string; hash: string }> {
  const pepper = await currentPepper(env, 'PEPPER_SID');
  const token = b64url(randomBytes(32));
  return { cookie: `${pepper.kid}.${token}`, hash: `${pepper.kid}$${b64url(await hmac(pepper.key, token))}` };
}

/** cookie 值 → 库里的 token_hash；格式不对或 kid 不认识返回 null。 */
export async function sessionHashFromCookie(env: Env, cookie: string): Promise<string | null> {
  const m = /^([A-Za-z0-9_-]{1,16})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  if (!m) return null;
  const pepper = await pepperByKid(env, 'PEPPER_SID', m[1]!);
  return pepper ? `${pepper.kid}$${b64url(await hmac(pepper.key, m[2]!))}` : null;
}

// ---------- IP ----------

/** IPv6 只取前 /64：一个用户通常拿到一整段，按单个地址计数等于没限。 */
export function ipPrefix(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':') + '::/64';
}

/** IP 的 HMAC 截成 16 字节，只当限流计数的键，不存原文。 */
export async function hashIp(env: Env, ip: string): Promise<string> {
  const pepper = await currentPepper(env, 'PEPPER_IP');
  return b64url((await hmac(pepper.key, ipPrefix(ip))).slice(0, 16));
}
