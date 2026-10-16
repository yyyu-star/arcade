import type Phaser from 'phaser';
import { ACHIEVEMENTS, ITEMS, MAX_DIFFICULTY, MIN_DIFFICULTY, PERSONA_IDS, STOCKS, type Face, type ThemeId } from '../core/index.ts';
import { LOW_MEMORY, RENDER_SCALE } from './theme.ts';

/**
 * 素材清单与加载（v3 美术，见 public/assets/art/README.md 的「v3 美术」一节）。
 *
 * 每张素材有一个逻辑 key（如 `stock:ai_leader:calm`、`fx:flame`）和「世界坐标」尺寸 w×h。取图一律经 artRef(key)：
 * - 有图集（public/assets/art/v3/atlas/）时从图集取帧，帧名 = 素材路径去掉 `assets/art/v3/` 前缀和 `.svg`
 *   （如 `stocks/ai_leader/calm`、`items/longtou`）；
 * - 没有图集、或图集里缺这一帧时，回退到逐个 SVG，按 RENDER_SCALE 倍光栅化，保证高分屏清晰。
 * 可选素材（道具图标、眨眼、标题主视觉）可能还没交：先用 fetch 确认是 SVG 再交给纹理管理器，缺了就当不存在，不报错。
 */
interface AssetDef {
  key: string;
  /** 相对站点根目录的路径 */
  path: string;
  /** 世界坐标尺寸（素材像素） */
  w: number;
  h: number;
  /** 可选素材：文件可能不存在 */
  optional?: boolean;
  /** 九宫格 / 平铺用：图集里的这一帧不能裁边、不能旋转，否则改用单独的 SVG */
  plain?: boolean;
  /** 不在启动时加载，第一次进交易场景时再加载（只有雷雨天用得到的图层） */
  lazy?: boolean;
}

const V3 = 'assets/art/v3/';
const ATLAS_DIR = `${V3}atlas/`;
/**
 * 图集分两组（见 atlas/README.md）：game（对局用，首屏加载）和 meta（人设、难度、成就、图鉴，按需加载）。
 * 入口是 Phaser multiatlas（{ textures: [...] }），也接受 JSON Hash / Array（{ frames, meta.image }）；纹理 key 与组名相同。
 */
type AtlasGroup = 'game' | 'meta';
const ATLAS_GROUPS: readonly AtlasGroup[] = ['game', 'meta'];

const SCENE_LAYERS = [
  'sky_bull', 'sky_flat', 'sky_bear', 'city', 'haze_bear', 'rain', 'lightning', 'lightning_2', 'lightning_3',
  'wall', 'desk', 'steam', 'cat', 'cat_tail', 'cat_zzz', 'ambient_bull', 'ambient_flat', 'ambient_bear', 'lamp_light', 'monitor_glow',
] as const;
type SceneLayer = (typeof SCENE_LAYERS)[number];

const FRIEND_IDS = ['xiaoli', 'laowang', 'zhangjie', 'qunzhu', 'laozhao', 'dav', 'neimu', 'zhuchang', 'kongjun'] as const;
export type AvatarFace = 'normal' | 'smug' | 'awkward';
const AVATAR_FACES: readonly AvatarFace[] = ['normal', 'smug', 'awkward'];
const THEME_BADGES: readonly ThemeId[] = ['ai', 'newenergy', 'consumer', 'pharma', 'finance', 'lowalt', 'gaming', 'pig'];
const ROLES = ['leader', 'follower', 'bluechip', 'meme', 'st'] as const;

/** 0.5 去文字化的小图标（tools/art/glyphs.ts）：替代界面上的说明文字。arrow_* 为白色，用时按涨跌色着色。 */
export const GLYPHS = ['target', 'bank', 'house', 'wallet', 'bag', 'calendar', 'hourglass', 'gift', 'bolt', 'trophy', 'book', 'star', 'arrow_up', 'arrow_down', 'horn', 'bear',
  // 0.5.1 丰满化：天气、贴纸、情绪脸、放大镜
  'sun', 'cloud', 'rain', 'storm', 'rainbow', 'rocket', 'cry', 'moneybag', 'leek', 'melon', 'hammer', 'face_hot', 'face_happy', 'face_calm', 'face_sad', 'face_cold', 'magnifier'] as const;
export type Glyph = (typeof GLYPHS)[number];
export function glyphKey(g: Glyph): string {
  return `glyph:${g}`;
}

/** 九宫格切片（左、右、上、下，素材像素），见 README。 */
export const SLICES = {
  phone_frame: [48, 48, 48, 48],
  chat_header: [36, 36, 34, 12],
  bubble_left: [20, 16, 22, 16],
  bubble_right: [16, 20, 22, 16],
  bubble_card: [24, 24, 24, 24],
  system_pill: [14, 14, 0, 0],
  card_holding: [18, 18, 18, 18],
  panel_paper: [20, 20, 20, 20],
  button_big: [24, 24, 16, 16],
  button_buy: [24, 24, 16, 16],
  tag_pill: [10, 10, 0, 0],
  codex_tab: [24, 24, 18, 10],
  codex_tab_active: [24, 24, 18, 10],
  codex_card: [24, 24, 24, 24],
  progress_track: [12, 12, 0, 0],
  progress_fill: [12, 12, 0, 0],
  recap_paper: [24, 24, 24, 24],
} as const;
export type SliceKey = keyof typeof SLICES;

/** 只有大盘阴雨（bear）时才看得见的图层：开始菜单用不到，进交易场景时再加载，省下启动请求 */
const BEAR_ONLY = new Set<string>(['sky_bear', 'haze_bear', 'rain', 'lightning', 'lightning_2', 'lightning_3', 'ambient_bear']);

const asset = (key: string, path: string, w: number, h: number, extra: Partial<AssetDef> = {}): AssetDef => ({ key, path: `${V3}${path}`, w, h, ...extra });
const plain = { plain: true };

/** 启动时必载的固定素材（股票、道具、标题主视觉另算）。 */
const ASSETS: readonly AssetDef[] = [
  ...SCENE_LAYERS.map((n) => asset(`scene:${n}`, `scene/${n}.svg`, 1280, 720, { plain: n === 'rain', lazy: BEAR_ONLY.has(n) })),
  asset('chat:phone_frame', 'chat/phone_frame.svg', 360, 720, plain),
  asset('chat:phone_notch', 'chat/phone_notch.svg', 120, 28),
  asset('chat:chat_header', 'chat/chat_header.svg', 128, 64, plain),
  asset('chat:chat_bg_tile', 'chat/chat_bg_tile.svg', 96, 96, plain),
  asset('chat:bubble_left', 'chat/bubble_left.svg', 64, 48, plain),
  asset('chat:bubble_right', 'chat/bubble_right.svg', 64, 48, plain),
  asset('chat:bubble_card', 'chat/bubble_card.svg', 96, 96, plain),
  asset('chat:system_pill', 'chat/system_pill.svg', 96, 28, plain),
  ...FRIEND_IDS.flatMap((id) => AVATAR_FACES.map((f) => asset(`avatar:${id}:${f}`, `avatars/${id}_${f}.svg`, 64, 64))),
  ...THEME_BADGES.map((t) => asset(`theme:${t}`, `themes/${t}.svg`, 48, 48)),
  asset('fx:flame', 'fx/flame.svg', 32, 48),
  asset('fx:flame_small', 'fx/flame_small.svg', 20, 28),
  asset('fx:ice', 'fx/ice.svg', 32, 32),
  asset('fx:ice_shard', 'fx/ice_shard.svg', 16, 16),
  asset('fx:tide', 'fx/tide.svg', 256, 48),
  asset('fx:firework_burst', 'fx/firework_burst.svg', 128, 128),
  asset('fx:firework_star', 'fx/firework_star.svg', 24, 24),
  asset('fx:firework_dot', 'fx/firework_dot.svg', 12, 12),
  asset('fx:firework_trail', 'fx/firework_trail.svg', 8, 40),
  asset('fx:raincloud', 'fx/raincloud.svg', 128, 80),
  asset('fx:raindrop', 'fx/raindrop.svg', 10, 16),
  asset('fx:link_beam', 'fx/link_beam.svg', 128, 24),
  asset('fx:link_spark', 'fx/link_spark.svg', 32, 32),
  asset('fx:coin', 'fx/coin.svg', 32, 32),
  asset('fx:sparkle', 'fx/sparkle.svg', 16, 16),
  asset('ui:bill_card', 'ui/bill_card.svg', 320, 400),
  asset('ui:stamp_paid', 'ui/stamp_paid.svg', 160, 160),
  asset('ui:stamp_overdue', 'ui/stamp_overdue.svg', 220, 110),
  asset('ui:card_holding', 'ui/card_holding.svg', 64, 64, plain),
  asset('ui:panel_paper', 'ui/panel_paper.svg', 64, 64, plain),
  asset('ui:button_big', 'ui/button_big.svg', 96, 48, plain),
  asset('ui:button_buy', 'ui/button_buy.svg', 96, 48, plain),
  asset('ui:tag_pill', 'ui/tag_pill.svg', 40, 20, plain),
  asset('ui:paper_tile', 'ui/paper_tile.svg', 128, 128, plain),
  ...ROLES.map((r) => asset(`role:${r}`, `ui/role_${r}.svg`, 24, 24)),
  ...GLYPHS.map((g) => asset(glyphKey(g), `ui/gl_${g}.svg`, 48, 48)),
];

/** 股票小人的光栅化尺寸（世界坐标）：卡片里显示 50–120 */
const STOCK_RASTER = 112;
const FACES: readonly Face[] = ['calm', 'happy', 'limitup', 'worried', 'limitdown', 'delisted'];
/** 小人图：6 种表情 + 眨眼（与 calm 对齐，可选） */
type GuyFrame = Face | 'blink';
/** 道具图标的光栅化尺寸（世界坐标）：顶栏 24–32，奖励卡 76 */
const ITEM_RASTER = 80;
/** 标题页主视觉（可选，单独文件） */
export const KEYART_KEY = 'scene:title_keyart';

export function stockKey(id: string, face: GuyFrame): string {
  return `stock:${id}:${face}`;
}
export function avatarKey(friendId: string, face: AvatarFace = 'normal'): string {
  return `avatar:${friendId}:${face}`;
}
export function itemKey(id: string): string {
  return `item:${id}`;
}

function stockDef(id: string, face: GuyFrame): AssetDef {
  return asset(stockKey(id, face), `stocks/${id}/${face}.svg`, STOCK_RASTER, STOCK_RASTER, face === 'blink' ? { optional: true } : {});
}
function itemDef(id: string): AssetDef {
  return asset(itemKey(id), `items/${id}.svg`, ITEM_RASTER, ITEM_RASTER, { optional: true });
}
const KEYART_DEF = asset(KEYART_KEY, 'scene/title_keyart.svg', 1280, 720, { optional: true });

/**
 * 0.3.1「看得懂」：风口五种状态的小图标、收盘新闻图标、收盘小结的纸、新手提示的猫。交易画面用，可选（没到时画面用文字）。
 * 状态图标按公开的风口状态（Feel）取。
 */
export const STAGE_ICON: Record<'cold' | 'warming' | 'hot' | 'overheated' | 'cooling', string> = {
  cold: 'cold',
  warming: 'warm',
  hot: 'hot',
  overheated: 'overheat',
  cooling: 'cooling',
};
export function stageIconKey(feel: keyof typeof STAGE_ICON): string {
  return `ui:stage_${STAGE_ICON[feel]}`;
}
export const NEWS_KEY = 'ui:news';
export const CAT_HINT_KEY = 'avatar:cat_hint';
const FRIENDLY_DEFS: AssetDef[] = [
  ...Object.values(STAGE_ICON).map((st) => asset(`ui:stage_${st}`, `ui/stage_${st}.svg`, 32, 32, { optional: true })),
  asset(NEWS_KEY, 'ui/news.svg', 40, 40, { optional: true }),
  asset('ui:recap_paper', 'ui/recap_paper.svg', 96, 96, { optional: true, plain: true }),
  asset(CAT_HINT_KEY, 'avatars/cat_hint.svg', 96, 96, { optional: true }),
];

/** 说明书三页的插图（520×300，上方 0–226 是画，下方留给文字）。 */
export const GUIDE_PAGES = ['rotation', 'buy', 'sell'] as const;
export function guideKey(page: (typeof GUIDE_PAGES)[number]): string {
  return `guide:${page}`;
}

/**
 * 长线界面（人设、难度、成就、图鉴）的素材：在 meta 图集里，按需加载（ensureMetaArt）。
 * 没有图集时逐个取 SVG；取到之前画面显示「载入中」，不会出现烂图。
 */
export function personaKey(id: string, locked = false): string {
  return `persona:${id}${locked ? '_locked' : ''}`;
}
export function difficultyKey(level: number): string {
  return `diff:${level}`;
}
export function achFrameKey(tier: 'bronze' | 'silver' | 'gold' | 'locked'): string {
  return `ach:frame_${tier}`;
}
export function achIconKey(icon: string): string {
  return `ach:icon_${icon}`;
}
const ACH_ICONS = [...new Set(ACHIEVEMENTS.map((a) => a.icon))];
const META_DEFS: readonly AssetDef[] = [
  ...PERSONA_IDS.flatMap((id) => [asset(personaKey(id), `personas/${id}.svg`, 240, 300, { optional: true }), asset(personaKey(id, true), `personas/${id}_locked.svg`, 240, 300, { optional: true })]),
  ...Array.from({ length: MAX_DIFFICULTY - MIN_DIFFICULTY + 1 }, (_, i) => asset(difficultyKey(MIN_DIFFICULTY + i), `difficulty/${MIN_DIFFICULTY + i}.svg`, 96, 96, { optional: true })),
  ...(['bronze', 'silver', 'gold', 'locked'] as const).map((t) => asset(achFrameKey(t), `achievements/frame_${t}.svg`, 96, 96, { optional: true })),
  ...ACH_ICONS.map((ic) => asset(achIconKey(ic), `achievements/icon_${ic}.svg`, 64, 64, { optional: true })),
  asset('ui:codex_tab', 'ui/codex_tab.svg', 120, 48, { optional: true, plain: true }),
  asset('ui:codex_tab_active', 'ui/codex_tab_active.svg', 120, 48, { optional: true, plain: true }),
  asset('ui:codex_card', 'ui/codex_card.svg', 120, 160, { optional: true, plain: true }),
  asset('ui:codex_new', 'ui/codex_new.svg', 32, 32, { optional: true }),
  asset('ui:codex_lock', 'ui/codex_lock.svg', 32, 32, { optional: true }),
  asset('ui:progress_track', 'ui/progress_track.svg', 64, 20, { optional: true, plain: true }),
  ...GUIDE_PAGES.map((g) => asset(guideKey(g), `guide/${g}.svg`, 520, 300, { optional: true })),
  asset('ui:progress_fill', 'ui/progress_fill.svg', 64, 20, { optional: true, plain: true }),
];

/** 全部已知素材（按 key）。 */
const DEFS = new Map<string, AssetDef>();
for (const d of ASSETS) DEFS.set(d.key, d);
for (const s of STOCKS) for (const f of [...FACES, 'blink' as const]) DEFS.set(stockKey(s.id, f), stockDef(s.id, f));
for (const it of ITEMS) DEFS.set(itemKey(it.id), itemDef(it.id));
DEFS.set(KEYART_KEY, KEYART_DEF);
for (const d of FRIENDLY_DEFS) DEFS.set(d.key, d);
for (const d of META_DEFS) DEFS.set(d.key, d);

/** 图集帧名：素材路径去掉 v3 前缀与扩展名。 */
export function frameName(d: Pick<AssetDef, 'path'>): string {
  return d.path.replace(V3, '').replace(/\.svg$/, '');
}

// ---------------------------------------------------------------- 图集

interface FrameData {
  filename: string;
  frame: { x: number; y: number; w: number; h: number };
  rotated?: boolean;
  trimmed?: boolean;
  sourceSize?: { w: number; h: number };
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
}
interface AtlasPage {
  image: string;
  frames: FrameData[];
}
interface FrameInfo {
  /** 原始（未裁边）宽度，图集像素 */
  w: number;
  trimmed: boolean;
  rotated: boolean;
}

/** 'auto'：有图集且图集倍数不低于渲染倍数时用；'on' / 'off'：URL 参数 atlas=1 / atlas=0 强制。 */
export type AtlasMode = 'auto' | 'on' | 'off';

interface GroupState {
  /** 规范化后的页（决定使用时非空） */
  pages: AtlasPage[] | null;
  scale: number;
  /** 纹理已经加进纹理管理器 */
  ready: boolean;
  status: 'none' | 'used' | 'skipped' | 'invalid' | 'failed';
  /** 按需加载中（meta） */
  loading: Promise<boolean> | null;
}

const groups: Record<AtlasGroup, GroupState> = {
  game: { pages: null, scale: 0, ready: false, status: 'none', loading: null },
  meta: { pages: null, scale: 0, ready: false, status: 'none', loading: null },
};

const art = {
  /** 帧名 → 所在组与尺寸 */
  frames: new Map<string, FrameInfo & { group: AtlasGroup }>(),
  /** 可选素材组是否已交付（各组先探一张代表文件） */
  groups: { items: false, blink: false, friendly: false },
};

function dropGroup(g: AtlasGroup, status: GroupState['status']): void {
  groups[g].pages = null;
  groups[g].ready = false;
  groups[g].status = status;
  for (const [k, f] of art.frames) if (f.group === g) art.frames.delete(k);
}

/** 把 multiatlas / JSON Hash / JSON Array 统一成 multiatlas 的页列表；格式不对返回 null。 */
export function normalizeAtlas(raw: unknown): { pages: AtlasPage[]; scale: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { textures?: unknown; frames?: unknown; meta?: { image?: unknown; scale?: unknown } };
  let rawPages: { image?: unknown; frames?: unknown; scale?: unknown }[];
  if (Array.isArray(r.textures)) rawPages = r.textures as typeof rawPages;
  else if (r.frames && typeof r.meta?.image === 'string') rawPages = [{ image: r.meta.image, frames: r.frames, scale: r.meta.scale }];
  else return null;
  const pages: AtlasPage[] = [];
  let scale = Number(r.meta?.scale);
  for (const p of rawPages) {
    if (typeof p.image !== 'string' || !p.frames || typeof p.frames !== 'object') return null;
    const list: Record<string, unknown>[] = Array.isArray(p.frames)
      ? (p.frames as Record<string, unknown>[])
      : Object.entries(p.frames as Record<string, Record<string, unknown>>).map(([filename, f]) => ({ ...f, filename }));
    const frames: FrameData[] = [];
    for (const f of list) {
      const fr = f.frame as FrameData['frame'] | undefined;
      if (typeof f.filename !== 'string' || !fr || ![fr.x, fr.y, fr.w, fr.h].every((v) => typeof v === 'number')) continue;
      // 不带锚点（anchor / pivot）：换帧时由画面自己定原点；帧名去掉扩展名
      const { anchor: _a, pivot: _p, ...rest } = f as Record<string, unknown>;
      frames.push({ ...(rest as unknown as FrameData), filename: (f.filename as string).replace(/\.(svg|png|webp)$/, '') });
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = Number(p.scale);
    pages.push({ image: p.image, frames });
  }
  if (pages.length === 0) return null;
  return { pages, scale: Number.isFinite(scale) && scale > 0 ? scale : 2 };
}

/** 取一个 URL 的文本；文件不存在（404，或开发 / 预览服务器回退成的 index.html）时返回 null。 */
async function fetchText(url: string, want: 'svg' | 'json'): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null;
    const text = await res.text();
    if (want === 'svg' && !/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** 把 SVG 文本按 w×h（像素）光栅化成纹理；失败返回 false（不报错）。 */
function addSvgTexture(textures: Phaser.Textures.TextureManager, key: string, svg: string, w: number, h: number, cancelled: () => boolean = () => false): Promise<boolean> {
  return new Promise((resolve) => {
    if (textures.exists(key)) return resolve(true);
    let text = svg;
    try {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (root.nodeName !== 'svg') return resolve(false);
      if (!root.getAttribute('viewBox')) {
        const vw = parseFloat(root.getAttribute('width') ?? '');
        const vh = parseFloat(root.getAttribute('height') ?? '');
        if (vw > 0 && vh > 0) root.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
      }
      root.setAttribute('width', `${Math.round(w)}px`);
      root.setAttribute('height', `${Math.round(h)}px`);
      text = new XMLSerializer().serializeToString(root);
    } catch {
      return resolve(false);
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (cancelled()) return resolve(false);
      if (!textures.exists(key)) textures.addImage(key, img);
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

/** 已经试过的可选素材（缺的不再重复请求） */
const tried = new Set<string>();
/** 探测时已经取到的 SVG 文本（加载时不再请求第二次） */
const probed = new Map<string, string>();

/** 加载一张可选素材（fetch 确认存在后光栅化）。 */
async function loadOptional(textures: Phaser.Textures.TextureManager, d: AssetDef): Promise<boolean> {
  if (textures.exists(d.key)) return true;
  if (tried.has(d.key)) return false;
  tried.add(d.key);
  const svg = probed.get(d.path) ?? (await fetchText(d.path, 'svg'));
  probed.delete(d.path);
  return svg ? addSvgTexture(textures, d.key, svg, d.w * rasterScale(d), d.h * rasterScale(d)) : false;
}

/**
 * 图集里有没有这张素材（九宫格 / 平铺要求不裁边、不旋转）。ready 为 true 时只认纹理已就位的组
 * （meta 组加载完成前返回 null，画面先用单独的 SVG 或占位，不会出现烂图）。
 */
function inAtlas(d: AssetDef, ready = false): (FrameInfo & { group: AtlasGroup }) | null {
  const f = art.frames.get(frameName(d));
  if (!f) return null;
  const g = groups[f.group];
  if (!g.pages || (ready && !g.ready)) return null;
  if (d.plain && (f.trimmed || f.rotated)) return null;
  return f;
}

/** 启动前的准备：读两组图集入口，决定用不用；探测可选素材组是否已交付。 */
export async function prepareArt(mode: AtlasMode): Promise<void> {
  art.frames.clear();
  for (const g of ATLAS_GROUPS) dropGroup(g, 'none');
  if (mode !== 'off') {
    const texts = await Promise.all(ATLAS_GROUPS.map((g) => fetchText(`${ATLAS_DIR}${g}.json`, 'json')));
    ATLAS_GROUPS.forEach((g, i) => {
      const text = texts[i];
      if (text === null || text === undefined) return;
      let parsed: ReturnType<typeof normalizeAtlas> = null;
      try {
        parsed = normalizeAtlas(JSON.parse(text));
      } catch {
        parsed = null;
      }
      const st = groups[g];
      if (!parsed) {
        st.status = 'invalid';
        console.warn('图集格式无法识别，改用单独的 SVG：', `${ATLAS_DIR}${g}.json`);
      } else if (mode === 'on' || RENDER_SCALE <= parsed.scale) {
        // 渲染倍数高于图集倍数（如 4K 屏）时放大会发虚，改用按实际倍数光栅化的 SVG
        st.pages = parsed.pages;
        st.scale = parsed.scale;
        st.status = 'used';
        for (const p of parsed.pages) {
          for (const f of p.frames) {
            art.frames.set(f.filename, { group: g, w: f.sourceSize?.w ?? f.frame.w, trimmed: !!f.trimmed, rotated: !!f.rotated });
          }
        }
      } else {
        st.status = 'skipped';
      }
    });
  }
  // 可选素材组：图集里有就算已交付；否则各探一张代表文件（缺了整组不再逐个请求）
  const firstItem = ITEMS[0];
  const firstStock = STOCKS[0];
  const probe = async (d: AssetDef | undefined): Promise<boolean> => {
    if (!d) return false;
    if (inAtlas(d)) return true;
    const text = await fetchText(d.path, 'svg');
    if (text !== null) probed.set(d.path, text);
    return text !== null;
  };
  const [items, blink, friendly] = await Promise.all([
    probe(firstItem ? itemDef(firstItem.id) : undefined),
    probe(firstStock ? stockDef(firstStock.id, 'blink') : undefined),
    probe(FRIENDLY_DEFS[0]),
  ]);
  art.groups = { items, blink, friendly };
}

/** 图集状态（调试桥用）。 */
export function atlasStatus(): Record<AtlasGroup, { status: string; ready: boolean; pages: number; frames: number }> & { items: boolean; blink: boolean } {
  const one = (g: AtlasGroup): { status: string; ready: boolean; pages: number; frames: number } => ({
    status: groups[g].status,
    ready: groups[g].ready,
    pages: groups[g].pages?.length ?? 0,
    frames: [...art.frames.values()].filter((f) => f.group === g).length,
  });
  return { game: one('game'), meta: one('meta'), ...art.groups };
}

/**
 * 单独光栅化的 SVG 按几倍画：一般是 RENDER_SCALE；省内存的设备上整屏的场景背景（scene:*，1280×720）按 1 倍（0.5.9）。
 * 显示尺寸都按纹理的实际像素换算（artRef 的 px），画几倍都不影响布局。
 */
function rasterScale(d: AssetDef): number {
  return LOW_MEMORY && d.key.startsWith('scene:') ? 1 : RENDER_SCALE;
}

/** 登记要用 Phaser 加载器加载的素材：图集页、未被图集覆盖的必需素材（按 RENDER_SCALE 光栅化）。 */
function queueDef(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, d: AssetDef): boolean {
  // 只有首屏加载的 game 组能替代单独的 SVG；meta 组按需加载，这里不算
  const f = inAtlas(d);
  if (d.optional || f?.group === 'game' || textures.exists(d.key)) return false;
  load.svg(d.key, d.path, { width: d.w * rasterScale(d), height: d.h * rasterScale(d) });
  return true;
}

/** 本局用得到的股票：登场题材的全部股票（含 ST）。 */
export function stocksForThemes(themes: readonly ThemeId[]): string[] {
  return STOCKS.filter((s) => themes.includes(s.theme)).map((s) => s.id);
}

/** 启动加载：图集、固定素材、股票清单、开局题材的股票合成图。返回登记的文件数。 */
export function queueBoot(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, stockIds: readonly string[]): number {
  let n = 0;
  const game = groups.game;
  if (game.pages && !textures.exists('game')) {
    load.multiatlas('game', { textures: game.pages } as unknown as string, ATLAS_DIR);
    n += game.pages.length;
  }
  for (const d of ASSETS) if (!d.lazy && queueDef(load, textures, d)) n += 1;
  load.json('stock-manifest', `${V3}stocks/manifest.json`);
  return n + 1 + queueStockArt(load, textures, stockIds);
}

/**
 * 首屏之后在后台把雷雨天图层取好（不占启动请求；玩家点「新游戏」时通常已经就绪，交易场景就不用再显示载入）。
 * 失败的留给交易场景的 preload 再试。
 */
export function warmLazy(textures: Phaser.Textures.TextureManager): void {
  if (warming) return;
  warming = (async () => {
    for (const d of ASSETS) {
      if (warmStopped) return;
      if (!d.lazy || textures.exists(d.key) || inAtlas(d)?.group === 'game') continue;
      const svg = await fetchText(d.path, 'svg');
      if (svg && !warmStopped) await addSvgTexture(textures, d.key, svg, d.w * rasterScale(d), d.h * rasterScale(d), () => warmStopped);
    }
  })();
}

let warming: Promise<void> | null = null;
let warmStopped = false;

/**
 * 离开开始菜单前调用：等后台预取做完（最多 ms 毫秒）。超时就停止预取、不再往纹理管理器里加图，
 * 剩下的交给交易场景的 preload，避免同一张图被加两次。
 */
export async function settleLazy(ms: number): Promise<void> {
  if (!warming) return;
  await Promise.race([warming, new Promise<void>((r) => setTimeout(r, ms))]);
  warmStopped = true;
}

/** 交易场景要用、启动时没加载的素材（雷雨天图层）。返回登记的文件数。 */
export function queueLazy(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager): number {
  let n = 0;
  for (const d of ASSETS) if (d.lazy && queueDef(load, textures, d)) n += 1;
  return n;
}

/**
 * 登记还没加载的股票合成图（6 种表情），返回登记了几张。
 * 已在纹理管理器里（或图集里有）的跳过，所以换局时只补新登场的题材。
 */
export function queueStockArt(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) for (const f of FACES) if (queueDef(load, textures, stockDef(id, f))) n += 1;
  return n;
}

/**
 * 加载结束后调用：图集纹理就位返回 true。图集登记了却没加载成功（页图缺失、正在重新烘焙）时，
 * 放弃图集并返回 false，调用方再走一遍 queueBoot 改用单独的 SVG。
 */
export function finishBoot(textures: Phaser.Textures.TextureManager): boolean {
  const game = groups.game;
  game.ready = !!game.pages && textures.exists('game');
  if (game.pages && !game.ready) {
    console.warn('图集加载失败，改用单独的 SVG');
    dropGroup('game', 'failed');
    return false;
  }
  return true;
}

/**
 * 按需加载一组图集（meta：人设、难度、成就、图鉴）。重复调用返回同一个 Promise；
 * 没有这组、不用图集或加载失败时返回 false（frames 同时清掉，画面改用单独的 SVG）。
 * 页图用浏览器自己的 Image 加载，再整组加进纹理管理器，不经过场景的加载器（不会和场景的 preload 抢同一个 key）。
 */
export function ensureAtlas(textures: Phaser.Textures.TextureManager, g: AtlasGroup): Promise<boolean> {
  const st = groups[g];
  if (st.ready) return Promise.resolve(true);
  if (!st.pages) return Promise.resolve(false);
  if (st.loading) return st.loading;
  const pages = st.pages;
  st.loading = Promise.all(
    pages.map(
      (p) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = `${ATLAS_DIR}${p.image}`;
        }),
    ),
  ).then((imgs) => {
    if (imgs.some((x) => x === null) || st.pages !== pages) {
      console.warn(`图集 ${g} 加载失败，改用单独的 SVG`);
      dropGroup(g, 'failed');
      return false;
    }
    if (!textures.exists(g)) textures.addAtlasJSONArray(g, imgs as HTMLImageElement[], pages.map((p) => ({ frames: p.frames })) as never);
    st.ready = textures.exists(g);
    if (!st.ready) dropGroup(g, 'failed');
    return st.ready;
  });
  return st.loading;
}

/**
 * 长线界面用的素材就位：先等 meta 图集；没有图集（或加载失败）时逐个取 SVG。
 * 重复调用共享同一次加载。缺的素材画面自己回退（问号卡、两字徽章、纯色框）。
 */
let metaReady: Promise<void> | null = null;
export function ensureMetaArt(textures: Phaser.Textures.TextureManager): Promise<void> {
  metaReady ??= (async () => {
    if (await ensureAtlas(textures, 'meta')) {
      // 图集里缺的个别帧（比如以后新加、还没烘焙的）单独补
      const missing = META_DEFS.filter((d) => !inAtlas(d, true));
      await Promise.all(missing.map((d) => loadOptional(textures, d)));
      return;
    }
    await Promise.all(META_DEFS.map((d) => loadOptional(textures, d)));
  })();
  return metaReady;
}

/** meta 素材是否已经可以直接用（不用等）。 */
export function metaArtReady(textures: Phaser.Textures.TextureManager): boolean {
  return META_DEFS.every((d) => artRef(textures, d.key) !== null || tried.has(d.key));
}

/**
 * 可选素材（不在图集里、且这一组已交付时逐个 fetch）：道具图标、眨眼、标题主视觉。
 * 缺哪张就当没有，画面自己回退。返回实际发出的请求数。
 */
export async function loadOptionalArt(textures: Phaser.Textures.TextureManager, opts: { stocks?: readonly string[]; items?: boolean; keyart?: boolean; friendly?: boolean }): Promise<number> {
  const want: AssetDef[] = [];
  if (opts.friendly && art.groups.friendly) want.push(...FRIENDLY_DEFS);
  if (opts.items && art.groups.items) for (const it of ITEMS) want.push(itemDef(it.id));
  if (opts.stocks && art.groups.blink) for (const id of opts.stocks) want.push(stockDef(id, 'blink'));
  if (opts.keyart) want.push(KEYART_DEF);
  const todo = want.filter((d) => inAtlas(d)?.group !== 'game' && !inAtlas(d, true) && !textures.exists(d.key) && !tried.has(d.key));
  await Promise.all(todo.map((d) => loadOptional(textures, d)));
  return todo.length;
}

// ---------------------------------------------------------------- 取图

/** 一张素材在纹理管理器里的位置：纹理 key、帧名，以及每个世界像素对应几个纹理像素。 */
export interface ArtRef {
  tex: string;
  frame: string | undefined;
  px: number;
}

/** 取图：图集优先，其次单独的纹理；都没有返回 null。 */
export function artRef(textures: Phaser.Textures.TextureManager, key: string): ArtRef | null {
  const d = DEFS.get(key);
  if (d) {
    const f = inAtlas(d, true);
    if (f) return { tex: f.group, frame: frameName(d), px: f.w / d.w };
  }
  if (!textures.exists(key)) return null;
  if (!d) return { tex: key, frame: undefined, px: 1 };
  const src = textures.get(key).getSourceImage() as { width?: number };
  return { tex: key, frame: undefined, px: src.width ? src.width / d.w : RENDER_SCALE };
}

export function hasArt(textures: Phaser.Textures.TextureManager, key: string): boolean {
  return artRef(textures, key) !== null;
}

/** 股票清单里的锚点（128 画布像素），用来把涨跌幅弹在头顶。 */
interface StockAnchors {
  headTop: number;
  ground: number;
}

export function stockAnchors(cache: Phaser.Cache.CacheManager, id: string): StockAnchors {
  const m = cache.json.get('stock-manifest') as { stocks?: { id: string; anchors?: { headTop?: number[]; ground?: number[] } }[] } | undefined;
  const s = m?.stocks?.find((x) => x.id === id);
  return { headTop: s?.anchors?.headTop?.[1] ?? 10, ground: s?.anchors?.ground?.[1] ?? 116 };
}
