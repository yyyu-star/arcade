/**
 * 分享卡（0.12.0，仓库根 docs/social.md 1.1）：结算页的"分享"按钮生成一张 1080×1350 的战绩图（Canvas 画，不经服务器，0 行写入），
 * 手机上支持带文件的 navigator.share 就直接调系统分享，不支持的出预览，"保存图片""复制链接"两个按钮。
 *
 * - 游戏只交数据（`ShareCard`），画法统一在这里，几个游戏风格一致；kit 不认识任何游戏，名字、图标、主题色都由游戏给。
 * - 这个文件只在调用时碰 DOM，import 时不碰（房间、测试里 import 没事）；排版的算法是纯函数，测试在 test/share.test.ts。
 * - 图上只有游戏给的数据：别人的隐藏信息（没摊的底牌、手牌）游戏自己别放进来。
 * - 右下角的二维码（0.15.0）：朋友圈里的图不能点，扫码是唯一入口。内容是运行时的 location.origin 加上 opts.url 的路径，
 *   kit 和游戏都不写域名；编码器是 qr.ts（自己写的最小子集，不引依赖）。
 * - 微信内置浏览器（0.15.0）：没有 navigator.share，下载链接也常常不生效，预览图改用 data: URL（blob: 的图长按经常存不下来），提示改成长按。
 */
import { qrEncode } from './qr.js';

/** 卡的尺寸：竖版 4:5，社交软件里不被裁 */
export const CARD_W = 1080;
export const CARD_H = 1350;
/** 小数据最多三条，多的不画 */
export const MAX_STATS = 3;

/** 图标、插画：一个能画的图（img / canvas / ImageBitmap），或者从图集里切一块（crop 是源图的像素） */
export type ShareArt =
  | CanvasImageSource
  | { image: CanvasImageSource; crop?: { x: number; y: number; w: number; h: number }; fit?: 'contain' | 'cover' };

export interface ShareCard {
  /** 游戏名（显示用，比如游戏自己的中文名） */
  game: string;
  /** 这一张是什么：比如"实盘小档 · 8 副"、"每日挑战" */
  title: string;
  /** 一个大数字和它的说明：守了多久、赚了多少、名次 */
  big: { value: string; label: string };
  /** 两三条小数据，最多 3 条 */
  stats?: readonly { label: string; value: string }[];
  /** 一句名场面（模板拼的，不收玩家的自由文字） */
  line?: string;
  /** 主题色 #rrggbb，底色按它渐变 */
  accent: string;
  /** 游戏图标或插画（可选）；是 img 时先 decode，失败就不画，照常出卡 */
  art?: ShareArt;
  /** 玩家昵称和称号（可选） */
  player?: { name: string; badge?: string };
  /** 日期，默认现在（按北京时间写成 2026.10.16） */
  date?: Date;
}

/** 截短：超过 max 个字符的截掉、补省略号（按码点算，不切坏表情） */
export function clip(s: string, max: number): string {
  const cs = [...s.trim()];
  return cs.length <= max ? cs.join('') : `${cs.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/** 游戏给的主题色只认 #rrggbb，不认的用一个中性的深红 */
export function accentOf(x: string): string {
  return /^#[0-9a-f]{6}$/i.test(x) ? x.toLowerCase() : '#9b2f24';
}

/** 颜色变深 / 变浅：k < 0 往黑走，k > 0 往白走（-1..1） */
export function shade(hex: string, k: number): string {
  const c = accentOf(hex);
  const ch = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const out = ch.map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** 日期按北京时间写：2026.10.16 */
export function cardDate(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
}

/** 卡上真正要画的字：截短、最多三条小数据、颜色认好 */
export function normalizeCard(card: ShareCard): Required<Omit<ShareCard, 'art' | 'player'>> & Pick<ShareCard, 'art' | 'player'> {
  return {
    game: clip(card.game, 12),
    title: clip(card.title, 20),
    big: { value: clip(card.big.value, 10), label: clip(card.big.label, 16) },
    stats: (card.stats ?? []).slice(0, MAX_STATS).map((s) => ({ label: clip(s.label, 8), value: clip(s.value, 10) })),
    line: clip(card.line ?? '', 60),
    accent: accentOf(card.accent),
    date: card.date ?? new Date(),
    art: card.art,
    player: card.player ? { name: clip(card.player.name, 12), ...(card.player.badge ? { badge: clip(card.player.badge, 10) } : {}) } : undefined,
  };
}

/** 不放在行首的收尾标点：右引号、右括号、逗号句号这些 */
const CLOSING = /^[”’」』）》〉】〕\]),.!?;:，。！？、；：…]+$/u;

/**
 * 按宽度折行（中文逐字、英文按词），最多 maxLines 行，放不下的最后一行补省略号。measure 由调用方给（Canvas 的 measureText），测试给假的
 */
export function wrapLines(text: string, maxW: number, measure: (s: string) => number, maxLines: number): string[] {
  const tokens = text.match(/[A-Za-z0-9.,'%+\-]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let cur = '';
  let cut = false;
  for (const t of tokens) {
    const space = /^\s+$/.test(t);
    if (!cur && space) continue;
    // 行满了还有字没放：截断
    if (lines.length === maxLines) {
      cut = true;
      break;
    }
    const next = cur + t;
    if (measure(next) <= maxW || !cur) {
      cur = next;
      continue;
    }
    // 收尾的引号、标点不单独起一行：把上一行最后一个字一起带下来（0.12.3）
    if (!space && CLOSING.test(t)) {
      const cs = [...cur.trimEnd()];
      if (cs.length >= 2) {
        const last = cs.pop()!;
        lines.push(cs.join('').trimEnd());
        cur = last + t;
        if (lines.length === maxLines) {
          cut = true;
          break;
        }
        continue;
      }
    }
    lines.push(cur.trimEnd());
    cur = space ? '' : t;
    if (cur && lines.length === maxLines) {
      cut = true;
      break;
    }
  }
  if (!cut && cur) lines.push(cur.trimEnd());
  if (cut) {
    let last = lines[maxLines - 1]!;
    while (last && measure(`${last}…`) > maxW) last = [...last].slice(0, -1).join('');
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** 图怎么放进框：contain 整张放进去、居中；cover 铺满框、裁掉多的（中间那块）。返回 drawImage 的九个参数里后八个 */
export function artRect(
  src: { w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
  fit: 'contain' | 'cover' = 'contain',
  crop?: { x: number; y: number; w: number; h: number },
): [number, number, number, number, number, number, number, number] {
  let sx = crop?.x ?? 0;
  let sy = crop?.y ?? 0;
  let sw = crop?.w ?? src.w;
  let sh = crop?.h ?? src.h;
  if (fit === 'cover') {
    const k = Math.max(box.w / sw, box.h / sh);
    const vw = box.w / k;
    const vh = box.h / k;
    sx += (sw - vw) / 2;
    sy += (sh - vh) / 2;
    sw = vw;
    sh = vh;
    return [sx, sy, sw, sh, box.x, box.y, box.w, box.h];
  }
  const k = Math.min(box.w / sw, box.h / sh);
  const dw = sw * k;
  const dh = sh * k;
  return [sx, sy, sw, sh, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh];
}

/**
 * 码里和分享出去的链接（0.15.0）：只认运行时的 origin，游戏给的 url 只取路径、查询和 # 后面的部分。
 * 这样 kit 和游戏里都不写域名，单独部署的游戏（workers.dev）扫出来也是它自己
 */
export function shareLink(url: string, origin: string): string {
  const u = new URL(url, `${origin}/`);
  return `${origin}${u.pathname}${u.search}${u.hash}`;
}

/** 系统分享的文字末尾带上链接（0.15.0）：有的 App 只取 text、不取 url */
export function shareText(text: string, link: string): string {
  return text.includes(link) ? text : `${text} ${link}`;
}

/** 微信内置浏览器（UA 带 MicroMessenger，含企业微信） */
export function isWeChat(ua: string): boolean {
  return /MicroMessenger/i.test(ua);
}

/**
 * 调不调系统分享（0.15.1）：只给手机、平板。桌面（Windows、Mac、Linux，含触屏笔记本）的系统共享面板发不出图：
 * Windows Chrome 的 canShare 对文件回 true，弹出系统共享，选微信后微信 PC 版是空白窗口、再报"共享失败"。桌面一律直接出预览，复制图片去粘贴。
 * iPadOS 的 Safari 默认报桌面版 UA（Macintosh），靠多点触控认出来；微信里照旧不调（isWeChat）
 */
export function useSystemShare(ua: string, maxTouchPoints: number): boolean {
  if (isWeChat(ua)) return false;
  if (/Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/**
 * 预览层怎么出（0.15.0）：微信里用 data: URL、提示长按、不给"保存图片"；
 * 桌面（0.15.1）多一个"复制图片"（浏览器支持才真的摆出来），提示去微信里粘贴；手机照旧
 */
export function previewMode(ua: string, maxTouchPoints = 0): { dataUrl: boolean; tip: string; save: boolean; copyImage: boolean } {
  if (isWeChat(ua)) return { dataUrl: true, tip: '长按图片 → 发送给朋友，或保存后发朋友圈', save: false, copyImage: false };
  if (!useSystemShare(ua, maxTouchPoints)) return { dataUrl: false, tip: '复制图片，到微信或 QQ 的聊天框里粘贴就能发', save: true, copyImage: true };
  return { dataUrl: false, tip: '手机上也可以长按图片保存', save: true, copyImage: false };
}

/** 二维码在卡上的框：白底留白 ≥ 4 格（扫码的规范要求），每格整数像素、对齐像素，截图后也清楚 */
export const QR_BOX = 248;
export function qrLayout(size: number, box = QR_BOX): { cell: number; pad: number } {
  const cell = Math.max(1, Math.floor(box / (size + 8)));
  return { cell, pad: Math.floor((box - cell * size) / 2) };
}

// ───────────── 画（只在调用时碰 DOM） ─────────────

const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif';

function sizeOf(img: CanvasImageSource): { w: number; h: number } {
  const o = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: unknown; height?: unknown; displayWidth?: number; displayHeight?: number };
  const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'object' && v && 'baseVal' in v ? Number((v as { baseVal: { value: number } }).baseVal.value) : 0);
  const w = o.naturalWidth || o.videoWidth || o.displayWidth || num(o.width);
  const h = o.naturalHeight || o.videoHeight || o.displayHeight || num(o.height);
  return { w, h };
}

/** art 的两种写法拆开；是 img 就先 decode（没加载完、坏图都在这里失败），失败返回 null，卡照常出 */
async function readyArt(art: ShareArt | undefined): Promise<{ image: CanvasImageSource; crop?: { x: number; y: number; w: number; h: number }; fit: 'contain' | 'cover' } | null> {
  if (!art) return null;
  const spec = typeof art === 'object' && art !== null && 'image' in art && !('naturalWidth' in art) ? art : { image: art as CanvasImageSource };
  const img = spec.image as { decode?: () => Promise<void>; naturalWidth?: number };
  if (typeof img.decode === 'function' && 'naturalWidth' in img) {
    try {
      await img.decode();
    } catch {
      return null;
    }
  }
  const { w, h } = sizeOf(spec.image);
  if (!w || !h) return null;
  return { image: spec.image, crop: spec.crop, fit: spec.fit ?? 'contain' };
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 字太宽就缩小字号，最小到 min */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, maxW: number, min: number): number {
  let s = size;
  for (; s > min; s -= 4) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = `${weight} ${s}px ${FONT}`;
  return s;
}

/**
 * 画一张卡。canvas 不给就新建一个 1080×1350 的。link 给了（0.15.0，prepareShare 用 shareLink 算好的）就在右下角画二维码，
 * 太长编不了码就不画
 */
export async function drawShareCard(input: ShareCard, canvas?: HTMLCanvasElement, link?: string): Promise<HTMLCanvasElement> {
  const c = normalizeCard(input);
  const qr = link ? qrEncode(link) : null;
  // 二维码的白框：右下角，压在底栏上；名场面和日期往左让
  const qx = CARD_W - 72 - QR_BOX;
  const qy = CARD_H - 40 - QR_BOX - 44;
  const cv = canvas ?? document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d')!;
  const art = await readyArt(c.art);
  const W = CARD_W;
  const M = 72;

  // 底：主题色从上往下变深，再压一层很淡的斜纹
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, CARD_H);
  bg.addColorStop(0, shade(c.accent, 0.12));
  bg.addColorStop(1, shade(c.accent, -0.55));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, CARD_H);
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 28;
  for (let x = -CARD_H; x < W; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, CARD_H);
    ctx.lineTo(x + CARD_H, 0);
    ctx.stroke();
  }
  ctx.restore();

  // 顶：图标 + 游戏名 + 这一张是什么
  let tx = M;
  if (art) {
    const box = { x: M, y: 70, w: 180, h: 180 };
    ctx.save();
    round(ctx, box.x, box.y, box.w, box.h, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(art.image, ...artRect(sizeOf(art.image), box, art.fit, art.crop));
    } catch {
      // 跨域的图、坏图：不画，卡照常出
    }
    ctx.restore();
    tx = M + 180 + 36;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  fitFont(ctx, c.game, '800', 84, W - tx - M, 48);
  ctx.fillText(c.game, tx, 160);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  fitFont(ctx, c.title, '600', 44, W - tx - M, 30);
  ctx.fillText(c.title, tx, 228);

  // 中：大数字
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  fitFont(ctx, c.big.value, '900', 230, W - 2 * M, 96);
  ctx.fillText(c.big.value, W / 2, 600);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  fitFont(ctx, c.big.label, '700', 54, W - 2 * M, 34);
  ctx.fillText(c.big.label, W / 2, 690);

  // 小数据：一排最多三格
  const n = c.stats.length;
  if (n) {
    const gap = 28;
    const cw = (W - 2 * M - gap * (n - 1)) / n;
    c.stats.forEach((s, i) => {
      const x = M + i * (cw + gap);
      round(ctx, x, 770, cw, 190, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      fitFont(ctx, s.value, '800', 76, cw - 32, 40);
      ctx.fillText(s.value, x + cw / 2, 870);
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      fitFont(ctx, s.label, '600', 36, cw - 32, 26);
      ctx.fillText(s.label, x + cw / 2, 925);
    });
  }

  // 一句名场面：最多两行
  if (c.line) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 50px ${FONT}`;
    const lw = qr ? qx - 32 - M : W - 2 * M - 40;
    const lines = wrapLines(`“${c.line}”`, lw, (s) => ctx.measureText(s).width, 2);
    lines.forEach((l, i) => ctx.fillText(l, qr ? M + lw / 2 : W / 2, 1065 + i * 66));
  }

  // 底：昵称、称号、日期
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, CARD_H - 150, W, 150);
  ctx.font = `600 38px ${FONT}`;
  const dateRight = qr ? qx - 28 : W - M;
  const dateLeft = dateRight - ctx.measureText(cardDate(c.date)).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  if (c.player) {
    fitFont(ctx, c.player.name, '800', 50, Math.min(W * 0.5, dateLeft - 24 - M), 32);
    ctx.fillText(c.player.name, M, CARD_H - 62);
    if (c.player.badge) {
      const nw = ctx.measureText(c.player.name).width;
      ctx.font = `700 34px ${FONT}`;
      const bw = ctx.measureText(c.player.badge).width + 36;
      const bx = M + nw + 24;
      if (bx + bw < Math.min(W * 0.72, dateLeft - 16)) {
        round(ctx, bx, CARD_H - 104, bw, 54, 27);
        ctx.fillStyle = shade(c.accent, 0.75);
        ctx.fill();
        ctx.fillStyle = shade(c.accent, -0.5);
        ctx.fillText(c.player.badge, bx + 18, CARD_H - 66);
      }
    }
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(cardDate(c.date), dateRight, CARD_H - 62);

  if (qr) {
    // 纯白底、近黑的格，不叠阴影和渐变：对比度够，手机截图压缩后照样扫得出
    ctx.fillStyle = '#ffffff';
    round(ctx, qx, qy, QR_BOX, QR_BOX + 44, 24);
    ctx.fill();
    const { cell, pad } = qrLayout(qr.size);
    ctx.fillStyle = '#111111';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) if (qr.dark[y]![x]) ctx.fillRect(qx + pad + x * cell, qy + pad + y * cell, cell, cell);
    }
    ctx.fillStyle = '#444444';
    ctx.textAlign = 'center';
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText('扫码来玩', qx + QR_BOX / 2, qy + QR_BOX + 22);
  }
  return cv;
}

/** 画成 PNG；link 见 drawShareCard */
export async function shareCardBlob(card: ShareCard, link?: string): Promise<Blob> {
  const cv = await drawShareCard(card, undefined, link);
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export interface ShareOptions {
  /**
   * 分享出去的链接：游戏地址，好友房结算带房间码。只用它的路径、查询和 # 后面的部分，前面一律换成运行时的 location.origin（0.15.0），
   * 写相对路径（`./?room=123456`）或绝对地址都行；卡上的二维码、系统分享、"复制链接"用的都是换过的这一个
   */
  url: string;
  /** 系统分享里的一句话，默认用卡的游戏名和大数字拼；末尾自动带上链接（0.15.0） */
  text?: string;
  /** 存图的文件名，默认 share.png */
  fileName?: string;
  /** 预览层的 z-index，默认 11000（0.12.4 起；要比游戏的弹窗和 social 的横条、面板都高） */
  zIndex?: number;
  /** 冒烟、调试看的流水：`分享 系统`、`分享 预览`、`分享 保存`、`分享 复制` */
  log?(line: string): void;
}

/** 结果：调了系统分享 / 出了预览 / 用户在系统分享里取消了 */
export type ShareResult = 'shared' | 'preview' | 'cancelled';

const PREVIEW_ID = 'arcade-share-preview';

/** 先画好的卡（0.12.3）：ready 画完（失败也是 resolve，到时候 share 退回预览或报错）；share 在点击里调 */
export interface PreparedShare {
  ready: Promise<void>;
  /**
   * 在点击的处理函数里直接调（前面别 await）：卡已经画好就同步调 navigator.share，iOS 的"用户激活"还在；
   * 没画好就等画完再试，调不起来（激活过期、不支持）退回预览
   */
  share(): Promise<ShareResult>;
}

/**
 * 结算页一出现就先画卡（0.12.3）：iOS 只允许在点击的那一下里调 navigator.share，点了才画（解码图标、toBlob 要几百毫秒）激活就过期了，
 * 只能退到预览。游戏在结算页出来时调它，点"分享"时调返回的 share()
 */
export function prepareShare(card: ShareCard, opts: ShareOptions): PreparedShare {
  const name = opts.fileName ?? 'share.png';
  // 没有 DOM（房间、测试里）时 location 也没有：链接照原样，画卡那一步本来就会失败
  const link = typeof location === 'undefined' ? opts.url : shareLink(opts.url, location.origin);
  const text = shareText(opts.text ?? `${card.game} · ${card.big.label} ${card.big.value}`, link);
  const o: ShareOptions = { ...opts, url: link };
  let blob: Blob | null = null;
  let failed: unknown = null;
  const ready = shareCardBlob(card, link).then(
    (b) => {
      blob = b;
    },
    (e: unknown) => {
      failed = e ?? new Error('draw failed');
    },
  );
  const attempt = (b: Blob): Promise<ShareResult> => {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    // 只有手机、平板试系统分享；桌面和微信直接出预览（useSystemShare）
    if (useSystemShare(nav.userAgent, nav.maxTouchPoints ?? 0) && typeof File === 'function' && typeof nav.share === 'function') {
      const data: ShareData = { files: [new File([b], name, { type: 'image/png' })], title: card.game, text, url: link };
      if (nav.canShare?.(data)) {
        // 同步调（这一行之前没有 await）：点击的激活还在
        return nav.share(data).then(
          () => {
            opts.log?.('分享 系统');
            return 'shared' as const;
          },
          (e: { name?: string }) => {
            if (e?.name === 'AbortError') return 'cancelled' as const;
            // 别的错（激活过期、权限、不支持的类型）：退回预览
            showPreview(b, name, o);
            return 'preview' as const;
          },
        );
      }
    }
    showPreview(b, name, o);
    return Promise.resolve('preview');
  };
  return {
    ready,
    share(): Promise<ShareResult> {
      if (blob) return attempt(blob);
      return ready.then(() => {
        if (!blob) throw failed;
        return attempt(blob);
      });
    },
  };
}

/**
 * 点"分享"：画卡，能带文件调系统分享就调，不能就出预览（保存图片、复制链接）。
 * 系统分享出错（不是用户取消）也退回预览，总能拿到图。iOS 上点了才画会错过用户激活，结算页能先画的用 prepareShare
 */
export async function shareCard(card: ShareCard, opts: ShareOptions): Promise<ShareResult> {
  const p = prepareShare(card, opts);
  await p.ready;
  return p.share();
}

/** 不支持系统分享时：预览图 + "保存图片""复制链接"；点空白处或"关闭"收起。微信里见 previewMode */
function showPreview(blob: Blob, name: string, opts: ShareOptions): void {
  document.getElementById(PREVIEW_ID)?.remove();
  const mode = previewMode(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  // 微信里不用 blob:（长按存不下来），也就不建对象 URL
  const url = mode.dataUrl ? '' : URL.createObjectURL(blob);
  const root = document.createElement('div');
  root.id = PREVIEW_ID;
  root.setAttribute('role', 'dialog');
  root.style.cssText = `position:fixed;inset:0;z-index:${opts.zIndex ?? 11000};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.72);font:600 16px ${FONT};color:#fff`;
  const close = (): void => {
    root.remove();
    if (url) URL.revokeObjectURL(url);
  };
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  const img = document.createElement('img');
  if (url) img.src = url;
  else {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') img.src = reader.result;
    };
    reader.readAsDataURL(blob);
  }
  img.alt = '战绩图';
  img.style.cssText = 'max-width:min(92vw,540px);max-height:calc(100% - 140px);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  const tip = document.createElement('div');
  tip.textContent = mode.tip;
  tip.style.cssText = 'font-size:13px;opacity:.75';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
  const btn = (label: string, key: string, fn: () => void, primary = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset['key'] = key;
    b.style.cssText = `min-width:120px;min-height:48px;padding:0 20px;border-radius:24px;border:2px solid #fff;font:inherit;cursor:pointer;${primary ? 'background:#fff;color:#222' : 'background:transparent;color:#fff'}`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  // 不支持 ClipboardItem 的浏览器不摆"复制图片"，"保存图片"当主按钮
  const canCopyImage = mode.copyImage && typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
  if (mode.copyImage && !canCopyImage) tip.textContent = '保存图片后，到微信或 QQ 的聊天框里发';
  const save = btn('保存图片', 'share:save', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    opts.log?.('分享 保存');
  }, !canCopyImage);
  // 复制图片（0.15.1，桌面）：在点击里直接写剪贴板（用户激活还在），图已经画好了
  const copyImg = btn('复制图片', 'share:copy-image', () => {
    const done = (ok: boolean): void => {
      copyImg.textContent = ok ? '已复制' : '复制不了';
      tip.textContent = ok ? '已复制，去微信里粘贴' : '复制不了图片，点"保存图片"存下来再发';
      opts.log?.(ok ? '分享 复制图片' : '分享 复制图片失败');
    };
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => done(true), () => done(false));
  }, true);
  const copy = btn('复制链接', 'share:copy', () => {
    const done = (ok: boolean): void => {
      copy.textContent = ok ? '已复制' : '复制不了，链接：';
      if (!ok) tip.textContent = opts.url;
      opts.log?.(ok ? '分享 复制' : '分享 复制失败');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(opts.url).then(() => done(true), () => done(false));
    else done(false);
  });
  const shut = btn('关闭', 'share:close', close);
  if (canCopyImage) row.appendChild(copyImg);
  if (mode.save) row.appendChild(save);
  row.appendChild(copy);
  row.appendChild(shut);
  root.appendChild(img);
  root.appendChild(tip);
  root.appendChild(row);
  document.body.appendChild(root);
  opts.log?.('分享 预览');
}
