/**
 * 用户名、密码、昵称的规则（docs/platform-backend.md 5.1）。名单都放在平台里，不引用游戏代码。
 */
import { GAME_IDS } from '../../src/games';
import { WEAK_PASSWORDS } from './weak-passwords';

/** 用户名只用来登录；这些保留给平台和游戏自己，免得被人注册来冒充。游戏 id 从 games.ts 派生，登记了就保留。 */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'sys', 'arcade', 'official', 'support', 'service', 'staff',
  'kefu', 'guanfang', 'guanliyuan', 'xitong', 'api', 'www', 'null', 'undefined', 'lab',
  ...GAME_IDS,
]);

/**
 * 各游戏电脑人物的名字，按游戏 id 分组。真人昵称不许用，免得冒充电脑（docs/project.md 第 3 节第 10 条）。
 * 只在注册、改昵称、管理员建号时查：以后加进来的名字不追溯，已经用了的人照常登录、照常显示。
 *
 * 为什么手抄、不读各游戏公开的 JSON（0.10.19 评估过）：这是服务端的检查，读的话注册要跨 Worker 去取各游戏的文件，
 * 游戏没部署、拆走或者超时，检查就悄悄失效；而电脑人物很少变，漏同步的后果只是有人起了个和电脑一样的昵称。
 * 同步规则：游戏加、改电脑人物时，在它的 PR 说明里写上名字，维护者转给平台补进对应游戏的那一组；
 * games.ts 每登记一个游戏这里就要有一组（没有电脑就空数组），测试会检查（test/validate.test.ts）。
 */
export const RESERVED_PERSONAS: Readonly<Record<string, readonly string[]>> = {
  guandan: ['老张', '小美', '阿强'],
  kaipan: ['小李', '老王', '张姐', '老赵'], // 群聊里的人物
  // 前 6 个 2026-10-14 德州上线前先加上，后 4 个随德州 0.2.0 加（2026-10-15）
  texas: ['稳哥', '阿飙', '老好', '慢慢', '算盘', '江湖', '虎子', '老鹰', '叨叨', '小白'],
  mahjong: ['幺妹儿', '熊猫哥', '盖碗儿', '兔头哥', '火锅婆婆', '板凳儿'], // 0.10.9，麻将上线前先加上
};
const PERSONA_NAMES = new Set(Object.values(RESERVED_PERSONAS).flat());
/** 昵称里出现就拒绝的词：冒充电脑、官方。 */
const RESERVED_WORDS = ['电脑', '官方', '管理员', '系统', '客服'];
/**
 * 敏感词起步名单：只放最常见的骂人话。维护者可以随时补充；命中按"包含"算（去掉空白和符号、转小写后比）。
 */
const SENSITIVE_WORDS = [
  '傻逼', '傻b', '煞笔', '沙比', '操你', '草你', '草泥马', '你妈', '他妈', '妈的', '狗日', '日你',
  '婊子', '贱人', '杂种', '去死', '滚蛋', '屌', '鸡巴', '肏',
  'fuck', 'shit', 'bitch', 'cunt', 'nigger',
];

export function normalizeUsername(input: string): string {
  return input.normalize('NFKC').toLowerCase();
}

/** 只看格式。登录、找回用它：保留名只在注册时查，以后加了保留名，已经注册的老用户照样能登录。 */
export function isUsernameFormat(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

/** 注册用：格式 + 保留名。 */
export function checkUsername(username: string): 'ok' | 'invalid_username' {
  if (!isUsernameFormat(username) || RESERVED_USERNAMES.has(username)) return 'invalid_username';
  return 'ok';
}

/** 密码做 NFKC（同一个密码从不同输入法打出来哈希一致），不去空格、不改大小写。 */
export function normalizePassword(input: string): string {
  return input.normalize('NFKC');
}

/** password 须已归一化；长度按码点数。 */
export function checkPassword(password: string, username: string): 'ok' | 'weak_password' {
  const n = [...password].length;
  if (n < 8 || n > 128) return 'weak_password';
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower) || lower === username) return 'weak_password';
  return 'ok';
}

/** 昵称：NFKC、去首尾空白、连续空白合成一个。 */
export function normalizeDisplayName(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function checkDisplayName(name: string): 'ok' | 'invalid_display_name' | 'reserved_display_name' {
  const n = [...name].length;
  // 控制字符、零宽等格式字符、私用区和未分配码点、行/段分隔符
  if (n < 2 || n > 12 || /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u.test(name)) return 'invalid_display_name';
  const bare = name.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  if (SENSITIVE_WORDS.some((w) => bare.includes(w))) return 'invalid_display_name';
  if (RESERVED_WORDS.some((w) => bare.includes(w))) return 'reserved_display_name';
  const persona = bare.replace(/\d+$/u, '');
  if (PERSONA_NAMES.has(persona)) return 'reserved_display_name';
  return 'ok';
}
