/**
 * 0.6.5 结局海报：一局结束后在浏览器里用 canvas 画一张竖图（结局、称号、打法评语、关键数字、最赚的一笔），
 * 能分享就用系统分享（navigator.share 带图片），不能就下载。不走后端，不带账号信息。
 *
 * 结束页一打开就在后台画好：iOS 的分享必须在点击的同一下里调用，点了再画（等 toBlob）会被当成不是用户点的。
 */
import { formatMoney, formatPoints, type RunSummary } from '../core/index.ts';
import { artRef, stockKey } from './assets.ts';
import { chips } from './liveText.ts';
import { arrowOf, COLOR, FONT, FONT_NUM, signColor } from './theme.ts';

const POSTER_W = 1080;
const POSTER_H = 1350;

interface PosterContent {
  /** 通关 / 出局 */
  result: string;
  won: boolean;
  /** 右上角的小标签：每日挑战、实盘几档；没有为 null */
  badge: string | null;
  title: string;
  styleTag: string;
  styleLine: string;
  /** 四格关键数字：[数, 说明, 颜色（可省）] */
  stats: [string, string, number?][];
  /** 最赚的一笔：名字、涨幅文字、颜色、股票 id（画小人用）；没交易为 null */
  best: { name: string; ret: string; color: number; stockId: string; up: boolean } | null;
  /** 底下一行小字：人设 · 难度 · 编号 */
  footer: string;
  /** 系统分享框的标题（每日挑战带上名次，发出去就是一句邀请） */
  shareTitle: string;
}

/**
 * 海报上写什么（纯函数，测试看这里）。
 * 每日挑战的海报底下一行写"所有人同一局"（0.6.10），晒出去就是邀请；rank 是交分后读到的今天全站名次，有的话写进右上角标签和分享标题。
 */
export function posterContent(sum: Readonly<RunSummary>, rank?: number | null): PosterContent {
  const months = sum.live?.months ?? 12;
  const stats: [string, string, number?][] = [
    [formatMoney(sum.account), sum.won ? '带着上岸' : '最后剩下'],
    [`${sum.billsPaid}/${months}`, '个月的钱还上了', sum.won ? COLOR.accentDark : undefined],
  ];
  if (sum.live) stats.push([`×${(sum.live.bp / 10_000).toFixed(2)}`, '资产翻了几倍', signColor(sum.live.bp - 10_000)]);
  else if (sum.tradeMoney !== null) stats.push([formatMoney(sum.tradeMoney, { sign: true }), '炒股净赚', signColor(sum.tradeMoney)]);
  else stats.push([formatMoney(sum.peakAccount), '最高到过']);
  stats.push([`${sum.limitUpDays} 天`, sum.maxBoards >= 2 ? `涨停，最多连涨 ${sum.maxBoards} 天` : '手里有涨停']);
  const best = sum.bestTrade
    ? {
        name: sum.bestTrade.name,
        ret: `${arrowOf(sum.bestTrade.ret)}${formatPoints(Math.abs(sum.bestTrade.ret), 1, false)}`,
        color: signColor(sum.bestTrade.ret),
        stockId: sum.bestTrade.stockId,
        up: sum.bestTrade.ret >= 0,
      }
    : null;
  return {
    result: sum.won ? '通关' : '出局',
    won: sum.won,
    badge: sum.live ? `实盘 · ${chips(sum.live.stake)}` : sum.daily ? `每日挑战 ${sum.daily.slice(5).replace('-', '/')}${rank ? ` · 第${rank}名` : ''}` : null,
    title: sum.title,
    styleTag: sum.style.tag,
    styleLine: sum.style.line,
    stats,
    best,
    footer: sum.daily ? `${sum.personaName} · 今天所有人同一局，来比比` : `${sum.personaName} · ${sum.difficultyName} · #${sum.seed}`,
    shareTitle: sum.daily ? `开盘每日挑战${rank ? ` · 今天第 ${rank} 名` : ''}，同一局你来试试` : '开盘 · 我的这一局',
  };
}

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 按宽度折行（中文按字断）；最多 maxLines 行，多了最后一行加省略号。 */
export function wrapText(measure: (s: string) => number, text: string, width: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (measure(line + ch) > width && line) {
      out.push(line);
      line = ch;
      if (out.length === maxLines) break;
    } else line += ch;
  }
  if (out.length < maxLines && line) out.push(line);
  else if (out.length === maxLines && line) out[maxLines - 1] = `${Array.from(out[maxLines - 1] as string).slice(0, -1).join('')}…`;
  return out;
}

/** 一张图集里的图：原图、切片、去掉透明边以后的偏移（画到 canvas 上用） */
interface PosterArt {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 去透明边前的整幅大小，和切片在里面的偏移 */
  fullW: number;
  fullH: number;
  ox: number;
  oy: number;
}

/** 从 Phaser 的纹理里取一张图（股票小人）；没有就 null，海报照样画，只是少个小人。 */
function posterArt(textures: Phaser.Textures.TextureManager, key: string): PosterArt | null {
  const ref = artRef(textures, key);
  if (!ref) return null;
  const f = textures.getFrame(ref.tex, ref.frame);
  if (!f) return null;
  const image = f.source.image as CanvasImageSource;
  // frame.x / y 是去掉透明边以后在整幅里的偏移（没去边时为 0）
  return { image, sx: f.cutX, sy: f.cutY, sw: f.cutWidth, sh: f.cutHeight, fullW: f.realWidth, fullH: f.realHeight, ox: f.x, oy: f.y };
}

function drawPoster(g: CanvasRenderingContext2D, c: PosterContent, art: PosterArt | null): void {
  const W = POSTER_W;
  const H = POSTER_H;
  const P = 72;
  const font = (px: number, bold = false, num = false): string => `${bold ? 'bold ' : ''}${px}px ${num ? FONT_NUM : FONT}`;
  // 底：暖纸色 + 上半截一块主题色的斜光
  g.fillStyle = css(COLOR.paper);
  g.fillRect(0, 0, W, H);
  const glow = g.createLinearGradient(0, 0, 0, 560);
  glow.addColorStop(0, css(c.won ? 0xffd9a8 : 0xd9e2f2));
  glow.addColorStop(1, css(COLOR.paper));
  g.fillStyle = glow;
  g.fillRect(0, 0, W, 560);
  // 背景上淡淡的涨跌折线（固定形状，纯装饰）
  g.strokeStyle = css(c.won ? 0xffb37a : 0xa9b8d6);
  g.globalAlpha = 0.35;
  g.lineWidth = 10;
  g.lineJoin = 'round';
  g.beginPath();
  const pts = c.won ? [0.62, 0.7, 0.55, 0.6, 0.4, 0.46, 0.28, 0.32, 0.12] : [0.15, 0.22, 0.18, 0.35, 0.3, 0.48, 0.44, 0.6, 0.66];
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = 120 + p * 420;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
  g.globalAlpha = 1;

  // 抬头：游戏名 + 标签
  g.textBaseline = 'middle';
  g.fillStyle = css(COLOR.ink);
  g.font = font(44, true);
  g.fillText('开盘', P, 96);
  g.font = font(26);
  g.fillStyle = css(COLOR.muted);
  g.fillText('股市小肉鸽', P + 104, 100);
  const pill = (x: number, y: number, text: string, fill: number, size = 30): number => {
    g.font = font(size, true);
    const w = g.measureText(text).width + size * 1.4;
    roundRect(g, x, y - size * 0.9, w, size * 1.8, size * 0.9);
    g.fillStyle = css(fill);
    g.fill();
    g.fillStyle = css(COLOR.white);
    g.fillText(text, x + size * 0.7, y + 1);
    return w;
  };
  if (c.badge) {
    g.font = font(26, true);
    const w = g.measureText(c.badge).width + 26 * 1.4;
    pill(W - P - w, 96, c.badge, COLOR.info, 26);
  }

  // 结局 + 称号 + 打法标签
  let y = 230;
  pill(P, y, c.result, c.won ? COLOR.accent : COLOR.danger, 34);
  y += 110;
  g.fillStyle = css(COLOR.ink);
  // 称号和打法标签排一行：称号长（"差一点上岸的韭菜"）就缩字号，缩到 72 还放不下，标签挪到下一行
  g.font = font(30, true);
  const tagW = g.measureText(c.styleTag).width + 30 * 1.4;
  let size = 104;
  const titleWidth = (): number => {
    g.font = font(size, true);
    return g.measureText(c.title).width;
  };
  while (size > 72 && P + titleWidth() + 28 + tagW > W - P) size -= 4;
  const titleW = titleWidth();
  g.fillText(c.title, P, y);
  if (P + titleW + 28 + tagW <= W - P) pill(P + titleW + 28, y + 6, c.styleTag, COLOR.info, 30);
  else {
    y += size / 2 + 40;
    pill(P, y, c.styleTag, COLOR.info, 30);
    y -= 30;
  }
  // 一句评语（引号框）
  y += 96;
  g.font = font(38);
  const lines = wrapText((s) => g.measureText(s).width, `“${c.styleLine}”`, W - 2 * P - 40, 3);
  const qh = 40 + lines.length * 54;
  roundRect(g, P, y, W - 2 * P, qh, 28);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fill();
  g.fillStyle = css(COLOR.accentDark);
  lines.forEach((l, i) => g.fillText(l, P + 24, y + 47 + i * 54));
  y += qh + 40;

  // 四格数字
  const cw = (W - 2 * P - 28) / 2;
  const ch = 150;
  c.stats.forEach(([v, label, color], i) => {
    const x = P + (i % 2) * (cw + 28);
    const yy = y + Math.floor(i / 2) * (ch + 24);
    roundRect(g, x, yy, cw, ch, 24);
    g.fillStyle = css(COLOR.white);
    g.fill();
    g.strokeStyle = css(COLOR.edge);
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = css(color ?? COLOR.ink);
    g.font = font(54, true, true);
    let size = 54;
    while (g.measureText(v).width > cw - 48 && size > 30) g.font = font((size -= 4), true, true);
    g.fillText(v, x + 24, yy + 58);
    g.fillStyle = css(COLOR.muted);
    g.font = font(28);
    g.fillText(label, x + 24, yy + 112);
  });
  y += 2 * ch + 24 + 40;

  // 最赚的一笔：小人 + 名字 + 涨幅
  const bh = H - 110 - y;
  roundRect(g, P, y, W - 2 * P, bh, 28);
  g.fillStyle = css(c.won ? 0xfff0dc : 0xeef1f7);
  g.fill();
  if (c.best) {
    const size = Math.min(bh - 30, 230);
    if (art) {
      const k = size / Math.max(art.fullW, art.fullH);
      g.drawImage(art.image, art.sx, art.sy, art.sw, art.sh, P + 30 + art.ox * k, y + (bh - size) / 2 + art.oy * k, art.sw * k, art.sh * k);
    }
    const tx = P + (art ? size + 60 : 40);
    g.fillStyle = css(COLOR.muted);
    g.font = font(30);
    g.fillText('最赚的一笔', tx, y + bh / 2 - 70);
    g.fillStyle = css(COLOR.ink);
    g.font = font(48, true);
    g.fillText(c.best.name, tx, y + bh / 2 - 10);
    g.fillStyle = css(c.best.color);
    g.font = font(72, true, true);
    g.fillText(c.best.ret, tx, y + bh / 2 + 66);
  } else {
    g.fillStyle = css(COLOR.muted);
    g.font = font(40, true);
    g.fillText('这局一笔都没买，主打一个看', P + 40, y + bh / 2);
  }

  // 底：人设难度编号 + 去哪玩
  g.fillStyle = css(COLOR.dim);
  g.font = font(26);
  g.fillText(c.footer, P, H - 56);
  // 去哪玩：写当前页面的站点（部署在哪就是哪，代码里不写站点地址）
  const site = typeof location === 'undefined' ? '' : location.host;
  if (site) {
    g.textAlign = 'right';
    g.fillStyle = css(COLOR.accentDark);
    g.font = font(28, true);
    g.fillText(site, W - P, H - 56);
    g.textAlign = 'left';
  }
}

/** 画好一张海报（PNG）。画不出来（没有 canvas、内存紧）返回 null，按钮就不出。 */
export async function renderPoster(c: PosterContent, art: PosterArt | null): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const g = canvas.getContext('2d');
    if (!g) return null;
    drawPoster(g, c, art);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    // 画完就放掉画布（省内存设备上 1080×1350 也有 5 MB 多）
    canvas.width = canvas.height = 0;
    return blob;
  } catch {
    return null;
  }
}

export function posterArtFor(textures: Phaser.Textures.TextureManager, c: PosterContent): PosterArt | null {
  return c.best ? posterArt(textures, stockKey(c.best.stockId, c.best.up ? 'limitup' : 'worried')) : null;
}

type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

/**
 * 分享文字里带的游戏地址（0.6.11）：朋友收到图能直接点进来。按当前页面推，挂在哪就是哪、不写死域名；
 * 去掉 ?debug=1、#… 这类参数，`/games/kaipan/index.html` 和没带斜杠的 `/games/kaipan` 都归到 `/games/kaipan/`。
 */
export function gameLink(href: string): string {
  const u = new URL(href);
  const p = u.pathname;
  const dir = /\/[^/]*\.[^/]*$/.test(p) ? p.replace(/[^/]*$/, '') : p.endsWith('/') ? p : `${p}/`;
  return `${u.origin}${dir}`;
}

/** 能分享图片就分享（手机上弹系统分享，文字带上游戏地址），不能就下载。要在点击的同一下里调用。 */
export async function sharePoster(blob: Blob, name: string, title = '开盘 · 我的这一局'): Promise<ShareOutcome> {
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      // 只放 text：带上 title 的话，安卓不少应用（和 iOS 的备忘录、邮件）会把标题和正文拼在一起，同一句出现两遍
      await nav.share({ files: [file], text: `${title} ${gameLink(location.href)}` });
      return 'shared';
    } catch (e) {
      // 玩家自己关掉分享框：不当失败，也不再弹下载
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
