/**
 * 生成 public/art-preview.html：纯静态页面 + CSS 动画（没有脚本）。
 * 依赖 stocks 组先生成的 manifest.json；其余素材按固定文件名引用。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AVATAR_EXPR, AVATAR_IDS, AVATAR_NAMES } from './avatars.ts';
import { ITEM_IDS, ITEM_KIND, ITEM_NAMES } from './items.ts';
import { PERSONA_IDS, PERSONA_NAMES } from './personas.ts';
import { ACHIEVEMENT_ICONS, CODEX_UI, DIFFICULTY_NAMES } from './progress.ts';
import { STAGE_NAMES, STAGES } from './friendly.ts';
import { EXPR_LABEL, EXPRESSIONS, type Expr } from './lib/face.ts';
import { THEME_COLORS } from './lib/svg.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const A = 'assets/art/v3/';

interface Layer {
  name: string;
  file: string;
  z: number;
}

interface StockM {
  id: string;
  name: string;
  theme: string;
  role: string;
  hero: boolean;
  composite: Record<Expr | 'blink', string>;
  layers: Layer[];
  anchors: Record<string, [number, number]>;
}

interface Manifest {
  canvas: number;
  roles: Record<string, { name: string }>;
  stocks: StockM[];
}

const HERO_NOTES: Record<string, { note: string; anim: string }> = {
  ai_leader: { note: '长着韭菜头发的芯片，龙头戴小皇冠', anim: 'hop' },
  fin_blue: { note: '趴在枕头上躺平的金色存钱猪，领带松了', anim: 'lazy' },
  con_blue: { note: '戴墨镜的辣条，白马打领带', anim: 'sway' },
  ne_meme: { note: '仓鼠跑轮，轮子单独一层在转', anim: 'run' },
  pig_leader: { note: 'Q 版二师兄，扛着小钉耙', anim: 'hop' },
  ai_meme: { note: '抖动的果冻原子，带色散残影', anim: 'jitter' },
};
const HERO_ORDER = ['ai_leader', 'fin_blue', 'con_blue', 'ne_meme', 'pig_leader', 'ai_meme'];

const pct = (v: number) => `${((v / 128) * 100).toFixed(2)}%`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 分层小人（平静表情 + 眨眼）：画面层做分层动画的示范 */
function rig(s: StockM, size: number, anim: string): string {
  const base = `${A}stocks/${s.id}/`;
  const [gx, gy] = s.anchors.ground!;
  const [ex, ey] = s.anchors.eyes!;
  const origin = `${pct(gx)} ${pct(gy)}`;
  const layers = [...s.layers].sort((a, b) => a.z - b.z);
  let inner = '';
  for (const l of layers) {
    if (l.name === 'shadow') continue;
    if (l.name === 'fx') continue;
    if (l.name === 'eyes') {
      inner += `<img class="eo" src="${base}parts/eyes_calm.svg" alt="" style="transform-origin:${pct(ex)} ${pct(ey)}"><img class="eb" src="${base}parts/eyes_blink.svg" alt="">`;
      continue;
    }
    if (l.name === 'mouth') {
      inner += `<img src="${base}parts/mouth_calm.svg" alt="">`;
      continue;
    }
    if (l.name === 'spin') {
      const [sx, sy] = s.anchors.spin!;
      inner += `<img class="spin" src="${base}${l.file}" alt="" style="transform-origin:${pct(sx)} ${pct(sy)}">`;
      continue;
    }
    inner += `<img src="${base}${l.file}" alt="">`;
  }
  return (
    `<div class="rig rig-${anim}" style="width:${size}px;height:${size}px">` +
    `<img class="shadow" src="${base}parts/shadow.svg" alt="" style="transform-origin:${origin}">` +
    `<div class="mover" style="transform-origin:${origin}"><div class="breath" style="transform-origin:${origin}">${inner}</div></div></div>`
  );
}

/** 表情轮播：6 张合成图依次显示 */
function cycler(s: StockM, size: number): string {
  return (
    `<div class="cycler" style="width:${size}px;height:${size}px">` +
    EXPRESSIONS.map((e, i) => `<img src="${A}stocks/${s.composite[e]}" alt="${EXPR_LABEL[e]}" style="animation-delay:${i * 1.6 - 9.6}s">`).join('') +
    `<div class="cycler-labels">${EXPRESSIONS.map((e, i) => `<span style="animation-delay:${i * 1.6 - 9.6}s">${EXPR_LABEL[e]}</span>`).join('')}</div></div>`
  );
}

function themeTag(theme: string): string {
  const t = THEME_COLORS[theme]!;
  return `<span class="tag" style="--c:${t.main}"><img src="${A}themes/${theme}.svg" alt="">${t.name}</span>`;
}

function holdingCard(s: StockM, e: Expr, today: string, hold: string, streak: number, extra = ''): string {
  const up = today.startsWith('+');
  const cls = e === 'limitup' ? 'card-up' : e === 'limitdown' ? 'card-down' : e === 'delisted' ? 'card-dead' : '';
  return (
    `<div class="hcard ${cls}">${extra}` +
    `<div class="hc-top"><img class="role" src="${A}ui/role_${s.role}.svg" alt="">${themeTag(s.theme)}${streak > 0 ? `<span class="streak">${streak}连板</span>` : ''}</div>` +
    `<img class="hc-stock" src="${A}stocks/${s.composite[e]}" width="96" height="96" alt="">` +
    `<div class="hc-name">${esc(s.name)}</div>` +
    `<div class="hc-nums"><span class="${up ? 'up' : 'down'}">${today}</span><span class="muted">持有 <b class="${hold.startsWith('+') ? 'up' : 'down'}">${hold}</b></span></div>` +
    `<div class="hc-sell">卖出</div></div>`
  );
}

function scene(): string {
  const S = `${A}scene/`;
  const img = (n: string, cls = '') => `<img class="${cls}" src="${S}${n}.svg" alt="">`;
  return `
<div class="wx">
  <input type="radio" name="wx" id="wx-auto" checked><input type="radio" name="wx" id="wx-bull"><input type="radio" name="wx" id="wx-flat"><input type="radio" name="wx" id="wx-bear">
  <div class="wx-labels"><label for="wx-auto">自动轮换</label><label for="wx-bull">牛 · 晴</label><label for="wx-flat">平 · 阴</label><label for="wx-bear">熊 · 雷雨</label></div>
  <div class="scene">
    ${img('sky_bull', 'L s-bull')}${img('sky_flat', 'L s-flat')}${img('sky_bear', 'L s-bear')}
    ${img('city', 'L city')}
    <div class="L s-bear"><img class="L" src="${S}haze_bear.svg" alt=""><div class="rainfall"><img src="${S}rain.svg" alt=""><img src="${S}rain.svg" alt=""></div><img class="bolt" src="${S}lightning.svg" alt=""><img class="bolt" src="${S}lightning_2.svg" alt="" style="animation-delay:-2.1s"><img class="bolt" src="${S}lightning_3.svg" alt="" style="animation-delay:-4.2s"><div class="flash"></div><div class="flash" style="animation-delay:-2.1s"></div><div class="flash" style="animation-delay:-4.2s"></div></div>
    ${img('wall', 'L')}${img('desk', 'L')}${img('steam', 'L steam')}
    ${img('cat', 'L cat')}${img('cat_tail', 'L tail')}${img('cat_zzz', 'L zzz')}
    ${img('ambient_bull', 'L s-bull')}${img('ambient_flat', 'L s-flat')}${img('ambient_bear', 'L s-bear')}
    ${img('lamp_light', 'L lamp')}${img('monitor_glow', 'L glow')}
  </div>
</div>`;
}

function chatSample(m: Manifest): string {
  const st = (id: string) => m.stocks.find((s) => s.id === id)!;
  const msg = (who: string, expr: string, name: string, record: string, text: string) =>
    `<div class="msg"><img class="av" src="${A}avatars/${who}_${expr}.svg" alt=""><div><div class="who">${esc(name)} <span class="rec">说中 ${record}</span></div><div class="bubble bl">${esc(text)}</div></div></div>`;
  const rec = (who: string, name: string, s: StockM, reason: string) =>
    `<div class="msg"><img class="av" src="${A}avatars/${who}_smug.svg" alt=""><div><div class="who">${esc(name)} <span class="rec">推荐</span></div>` +
    `<div class="rcard"><div class="rc-head">今日推荐 · ${THEME_COLORS[s.theme]!.name}</div><div class="rc-body"><img src="${A}stocks/${s.composite.happy}" width="64" height="64" alt=""><div><div class="rc-name">${esc(s.name)}</div><div class="rc-reason">“${esc(reason)}”</div><div class="btn-buy">买入 <kbd>1</kbd></div></div></div></div></div></div>`;
  return `
<div class="phone">
  <img class="notch" src="${A}chat/phone_notch.svg" alt="">
  <div class="ch-head"><div class="ch-avs"><img src="${A}avatars/laowang_normal.svg" alt=""><img src="${A}avatars/xiaoli_normal.svg" alt=""><img src="${A}avatars/zhangjie_normal.svg" alt=""></div><div><div class="ch-title">韭菜互助群（6）</div><div class="ch-sub">开盘前 · 10 月第 3 天</div></div></div>
  <div class="ch-body">
    <div class="sys">群主 修改了群公告</div>
    ${msg('xiaoli', 'normal', '小李', '3/5', 'AI 今天必涨！冲！起飞！')}
    ${msg('laowang', 'normal', '老王', '4/5', '金融，横。')}
    ${msg('zhangjie', 'awkward', '张姐', '2/4', '妈妈群说板蓝根又要涨了，转给大家看看～')}
    ${rec('laozhao', '老赵', st('ai_meme'), '懂的都懂')}
    ${msg('qunzhu', 'smug', '群主', '1/6', '跟我上车！今晚直播课八折！')}
    <div class="msg me"><div class="bubble br">先看看再说……</div></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- 0.3.0 新素材

/** 待机眨眼：calm 与 blink 两张合成图叠放，CSS 每 3.2 秒切到 blink 约 160ms */
function blinker(s: StockM, size: number, delay = 0): string {
  return `<div class="blinker" style="width:${size}px;height:${size}px"><img src="${A}stocks/${s.composite.calm}" alt=""><img class="bl" src="${A}stocks/${s.composite.blink}" alt="" style="animation-delay:${delay}s"></div>`;
}

const NEW_STOCKS: Record<string, string> = {
  ai_blue: '一朵大白云坐在机柜上（算力云）',
  ai_follower2: '对话气泡，肚子上是带光标的输入框',
  ne_blue: '敦实的圆柱电池，正极帽 + 加号腰带',
  ne_follower2: '头顶插着纸风车的小豆子，风车单独一层会转',
  con_follower: '一碗红油螺蛳粉，碗边的小烟囱冒绿烟',
  con_follower2: '猫形的云，猫耳、胡须、云尾巴',
  ph_follower: '亮闪闪的光头冒出三根新头发，滴管在滴生发水',
  fin_follower: '戴学士帽的小团子，教鞭指着上涨曲线黑板',
  la_blue: '楼顶画着 H 停机坪、竖着风向袋的物业小楼',
  gm_blue: '像素风锯齿屋顶的老厂房，烟囱冒方块烟',
  gm_follower2: '带环形补光灯的直播麦克风，亮着直播红点',
  pig_blue: '长猪耳朵猪鼻子的冷柜，玻璃门挂霜',
  st_dream: '一张旧大饼，刷子在空中描一个更大的虚线饼',
  st_ghost: '信号全无的旧手机，角上结了蜘蛛网，头顶冒问号',
};

function newStocks(m: Manifest): string {
  return Object.entries(NEW_STOCKS)
    .map(([id, note], i) => {
      const s = m.stocks.find((x) => x.id === id)!;
      return `<div class="ns"><div class="ns-top">${blinker(s, 110, -i * 0.37)}<div><h3>${esc(s.name)}</h3><div class="sub">${id} · ${THEME_COLORS[s.theme]!.name} · ${m.roles[s.role]!.name}</div><div class="note">${esc(note)}</div></div></div>` +
        `<div class="exprs">${EXPRESSIONS.map((e) => `<figure><img src="${A}stocks/${s.composite[e]}" width="56" height="56" alt=""><figcaption>${EXPR_LABEL[e]}</figcaption></figure>`).join('')}</div></div>`;
    })
    .join('');
}

const KIND_LABEL: Record<string, string> = { tactic: '战法', tool: '工具', network: '人脉' };

function itemsGrid(): string {
  return ITEM_IDS.map((id) => `<figure class="item"><img src="${A}items/${id}.svg" width="64" height="64" alt=""><img src="${A}items/${id}.svg" width="40" height="40" alt=""><figcaption>${esc(ITEM_NAMES[id]!)}<small>${id} · ${KIND_LABEL[ITEM_KIND[id]!]}</small></figcaption></figure>`).join('');
}

function personasRow(): string {
  return PERSONA_IDS.map((id) => `<figure class="persona"><div class="pp"><img src="${A}personas/${id}.svg" width="200" height="250" alt=""><img src="${A}personas/${id}_locked.svg" width="200" height="250" alt=""></div><figcaption>${esc(PERSONA_NAMES[id]!)}<small>${id}（左：立绘；右：${id}_locked）</small></figcaption></figure>`).join('');
}

function difficultyRow(): string {
  return DIFFICULTY_NAMES.map((n, i) => `<figure class="diff"><img src="${A}difficulty/${i + 1}.svg" width="96" height="96" alt=""><img src="${A}difficulty/${i + 1}.svg" width="48" height="48" alt=""><figcaption>${i + 1} · ${n}</figcaption></figure>`).join('');
}

function achievementsBlock(): string {
  const tiers = ['bronze', 'silver', 'gold', 'locked'];
  const frames = tiers.map((t) => `<figure><img src="${A}achievements/frame_${t}.svg" width="96" height="96" alt=""><figcaption>frame_${t}</figcaption></figure>`).join('');
  const combo = (icon: string, t: string, size: number) =>
    `<div class="ach" style="width:${size}px;height:${size}px"><img src="${A}achievements/frame_${t}.svg" alt=""><img class="ic${t === 'locked' ? ' lk' : ''}" src="${A}achievements/icon_${icon}.svg" alt=""></div>`;
  const grid = ACHIEVEMENT_ICONS.map((ic, i) => `<figure>${combo(ic, tiers[i % 3]!, 96)}${combo(ic, tiers[i % 3]!, 56)}<figcaption>icon_${ic}</figcaption></figure>`).join('');
  const locked = ['skull', 'trophy', 'cat'].map((ic) => `<figure>${combo(ic, 'locked', 96)}<figcaption>未达成（图标压暗 + 降透明）</figcaption></figure>`).join('');
  return `<div class="achrow">${frames}</div><div class="achrow">${grid}${locked}</div>`;
}

function codexBlock(m: Manifest): string {
  const st = (id: string) => m.stocks.find((s) => s.id === id)!;
  const card = (s: StockM) =>
    `<div class="ccard"><div class="cc-head">${esc(s.name)}</div><img src="${A}stocks/${s.composite.happy}" width="88" height="88" alt=""><div class="cc-sub">${THEME_COLORS[s.theme]!.name} · ${m.roles[s.role]!.name}</div></div>`;
  const tabs = ['股票', '群友', '道具', '事件', '成就'].map((t, i) => `<div class="ctab${i === 0 ? ' on' : ''}">${t}</div>`).join('');
  const singles = Object.keys(CODEX_UI).map((k) => `<figure><img src="${A}ui/${k}.svg" alt="" style="max-width:120px"><figcaption>ui/${k}</figcaption></figure>`).join('');
  return `<div class="ctabs">${tabs}</div><div class="cgrid">${card(st('ai_blue'))}${card(st('con_follower2'))}<div class="ccard unknown"></div><div class="ccard unknown"></div>${card(st('st_ghost'))}<div class="ccard unknown"><img class="newb" src="${A}ui/codex_new.svg" alt=""></div></div>` +
    `<div class="cprog"><span>收集进度 23 / 40</span><div class="ptrack"><div class="pfill" style="width:57%"></div></div></div><div class="achrow">${singles}</div>`;
}

interface AtlasJson {
  textures: { image: string; size: { w: number; h: number }; frames: { filename: string; frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number }; sourceSize: { w: number; h: number } }[] }[];
  meta?: Record<string, unknown>;
}

function atlasBlock(): string {
  const groups = [['game', '对局用，首屏加载'], ['meta', '长线界面用，进对应界面再载']] as const;
  const loaded = groups
    .map(([g, note]) => {
      const p = `${ROOT}public/assets/art/v3/atlas/${g}.json`;
      return existsSync(p) ? { g, note, at: JSON.parse(readFileSync(p, 'utf8')) as AtlasJson } : null;
    })
    .filter((x): x is { g: 'game' | 'meta'; note: '对局用，首屏加载' | '长线界面用，进对应界面再载'; at: AtlasJson } => x !== null);
  if (loaded.length === 0) return '<p class="desc">还没有烘焙：node tools/art/bake.ts</p>';
  // 用 CSS 背景从图集页里取帧（按 2× 烘焙，显示时缩一半）
  const want = ['stocks/ai_blue/calm', 'stocks/ai_blue/blink', 'stocks/st_ghost/limitdown', 'items/longtou', 'items/rumor_mill', 'avatars/qunzhu_smug', 'difficulty/8', 'achievements/frame_gold', 'personas/mom', 'fx/flame'];
  let samples = '';
  for (const name of want) {
    for (const { g, at } of loaded) {
      const t = at.textures.find((x) => x.frames.some((f) => f.filename === name));
      if (!t) continue;
      const f = t.frames.find((x) => x.filename === name)!;
      const k = 0.5;
      samples +=
        `<figure><div class="afr" style="width:${f.sourceSize.w * k}px;height:${f.sourceSize.h * k}px"><div style="left:${f.spriteSourceSize.x * k}px;top:${f.spriteSourceSize.y * k}px;width:${f.frame.w * k}px;height:${f.frame.h * k}px;` +
        `background:url(${A}atlas/${t.image}) -${f.frame.x * k}px -${f.frame.y * k}px/${t.size.w * k}px ${t.size.h * k}px no-repeat"></div></div><figcaption>${g} · ${name}</figcaption></figure>`;
    }
  }
  const sets = loaded
    .map(({ g, note, at }) => {
      const total = at.textures.reduce((n, t) => n + t.frames.length, 0);
      const pages = at.textures.map((t) => `<figure><img src="${A}atlas/${t.image}" width="300" height="${Math.round((300 * t.size.h) / t.size.w)}" alt="" class="page"><figcaption>${t.image} · ${t.size.w}×${t.size.h} · ${t.frames.length} 帧</figcaption></figure>`).join('');
      return `<h3 style="margin:8px 0">${g}.json（${note}）· ${at.textures.length} 页 · ${total} 帧</h3><div class="achrow">${pages}</div>`;
    })
    .join('');
  return `<p class="desc">两套图集，2× 烘焙，WebP 近无损页图。frame 名 = 相对 v3/ 的路径去掉 .svg，分组规则见 atlas/README.md。下面一排是直接从图集页里按帧坐标取出来显示的。</p><div class="achrow">${samples}</div>${sets}`;
}

function friendlyBlock(): string {
  const texts: [string, string, string][] = [
    ['rotation', '① 风口会轮流火', '没人理 → 开始火 → 正火 → 太火了 → 在降温，然后换下一个风口。'],
    ['buy', '② 开始火的时候买', '风口开始火时买它的股票：热度往上涨，股票跟着涨，账户也在涨。'],
    ['sell', '③ 太火了就卖，月底要还钱', '太火了就下车，降温会跌。每个月底要从账户里还一笔钱，还不上就游戏结束。'],
  ];
  const guides = texts
    .map(([id, t, d]) => `<figure class="guide"><img src="${A}guide/${id}.svg" width="520" height="300" alt=""><div class="gtext"><b>${esc(t)}</b><br>${esc(d)}</div><figcaption>guide/${id}.svg</figcaption></figure>`)
    .join('');
  const stages = STAGES.map((st) => `<figure><img src="${A}ui/stage_${st}.svg" width="64" height="64" alt=""><img src="${A}ui/stage_${st}.svg" width="32" height="32" alt="" style="margin:4px auto 0"><figcaption>${STAGE_NAMES[st]}<br>stage_${st}</figcaption></figure>`).join('');
  const recap =
    `<div class="recap"><div class="rp-title"><img src="${A}ui/news.svg" width="28" height="28" alt="">今日收盘小结</div>` +
    `<p>今天赚了 ¥5,890，主要靠 AI 风口（+¥4,200）。</p><p class="muted">韭菜芯片 +10%（涨停）：AI 风口热度 +15，它是带头大哥，涨得比别人猛。</p></div>`;
  const hint = `<div class="hint"><img src="${A}avatars/cat_hint.svg" width="64" height="64" alt=""><div class="bubble bl">AI 热度连涨三天，正在火，可以考虑上车。我也是猜的。</div></div>`;
  return `<div class="guides">${guides}</div><div class="achrow" style="margin-top:14px">${stages}<figure><img src="${A}ui/news.svg" width="40" height="40" alt=""><figcaption>收盘新闻<br>ui/news</figcaption></figure><figure><img src="${A}avatars/cat_hint.svg" width="96" height="96" alt=""><figcaption>新手提示猫<br>avatars/cat_hint</figcaption></figure></div><div class="row">${recap}${hint}</div>`;
}

function keyartBlock(): string {
  return `<div class="keyart"><img src="${A}scene/title_keyart.svg" alt=""><div class="safe"><span>Logo / 按钮安全区（x 380–1220，y 40–440）</span></div></div>`;
}

const CSS_031 = `
.guides{display:flex;flex-wrap:wrap;gap:14px}.guide{position:relative;margin:0;width:520px}.guide figcaption{font-size:11px;color:#9a8490}
.guide .gtext{position:absolute;left:24px;right:24px;top:234px;height:58px;font-size:13px;line-height:1.5}
.recap{width:360px;padding:16px 20px;border-style:solid;border-width:24px;border-image:url(${A}ui/recap_paper.svg) 24 fill / 24px stretch;margin:0}
.recap .rp-title{display:flex;gap:8px;align-items:center;font-weight:700;margin:-14px 0 6px}.recap p{margin:4px 0;font-size:13px}.recap .muted{color:#7a6470}
.hint{display:flex;gap:10px;align-items:center}.hint .bubble{max-width:280px}
`;

const CSS_NEW = `
.keyart{position:relative;max-width:1200px}.keyart img{width:100%;height:auto;border-radius:12px;border:3px solid #3a2634}
.keyart .safe{position:absolute;left:23.75%;top:4.44%;width:52.5%;height:44.44%;border:3px dashed rgba(58,38,52,.55);border-radius:14px;display:flex;align-items:flex-start;justify-content:center}
.keyart .safe span{background:rgba(255,250,240,.85);font-size:12px;padding:2px 8px;border-radius:8px;margin-top:6px}
.blinker{position:relative}.blinker img{position:absolute;inset:0;width:100%;height:100%}
.blinker .bl{opacity:0;animation:blink 3.2s steps(1) infinite}
@keyframes blink{0%{opacity:0}92%{opacity:1}97%{opacity:0}}
.news{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.ns{background:#fffaf0;border:2.5px solid #3a2634;border-radius:16px;padding:10px 12px}
.ns-top{display:flex;gap:10px;align-items:center}.ns h3{margin:0;font-size:16px}.ns .sub{font-size:11px;color:#9a8490}.ns .note{font-size:12px;margin-top:4px}
.ns .exprs{display:flex;gap:2px;margin-top:6px}.ns figure,.exprs figure{margin:0;text-align:center;font-size:10px;color:#9a8490}
.blinkgrid{display:flex;flex-wrap:wrap;gap:6px}.blinkgrid figure{margin:0;text-align:center;font-size:10px;color:#9a8490;width:72px}
.items{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.item{margin:0;display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;background:#fffaf0;border:2px solid #e8d8bf;border-radius:12px;padding:8px}
.item figcaption{width:100%;font-size:13px;font-weight:600}.item small,.persona small{display:block;font-weight:400;font-size:11px;color:#9a8490}
.items.dark .item{background:#3a2634;border-color:#5a4a6a;color:#fff4e2}
.personas{display:flex;flex-wrap:wrap;gap:14px}.persona{margin:0;background:#fffaf0;border:2.5px solid #3a2634;border-radius:16px;padding:8px}
.persona .pp{display:flex;gap:4px;background:linear-gradient(#ffe8c8,#fff4e2);border-radius:12px}.persona figcaption{font-weight:600;font-size:14px;padding:4px}
.diffs{display:flex;flex-wrap:wrap;gap:12px}.diff{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:13px;font-weight:600}
.achrow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:12px}.achrow figure{margin:0;text-align:center;font-size:11px;color:#7a6470}
.ach{position:relative;display:inline-block;margin:0 4px}.ach img{position:absolute;inset:0;width:100%;height:100%}
.ach .ic{inset:16.67%;width:66.67%;height:66.67%}.ach .lk{filter:brightness(.35) saturate(.2);opacity:.6}
.ctabs{display:flex;gap:2px;margin-bottom:-3px}.ctab{width:96px;height:40px;background:url(${A}ui/codex_tab.svg) 0 0/100% 100%;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px}
.ctab.on{background-image:url(${A}ui/codex_tab_active.svg)}
.cgrid{display:flex;flex-wrap:wrap;gap:12px;background:#f3e6d0;border:3px solid #3a2634;border-radius:0 16px 16px 16px;padding:14px}
.ccard{position:relative;width:120px;height:160px;border-style:solid;border-width:24px;border-image:url(${A}ui/codex_card.svg) 24 fill / 24px stretch;display:flex;flex-direction:column;align-items:center;margin:0}
.ccard .cc-head{position:absolute;top:-18px;font-size:12px;font-weight:700;white-space:nowrap}.ccard img{margin-top:4px}.ccard .cc-sub{font-size:11px;color:#7a6470}
.ccard.unknown{border:0;background:#4a3d58}.ccard .newb{position:absolute;right:-6px;top:-6px;width:32px;height:32px}
.cprog{display:flex;gap:10px;align-items:center;margin:12px 0;font-size:13px}.ptrack{position:relative;width:320px;height:20px;border-style:solid;border-width:0 12px;border-image:url(${A}ui/progress_track.svg) 0 12 fill / 0 12px stretch}
.pfill{position:absolute;left:-12px;top:0;height:20px;border-style:solid;border-width:0 12px;border-image:url(${A}ui/progress_fill.svg) 0 12 fill / 0 12px stretch}
.afr{position:relative;background:repeating-conic-gradient(#eadfcc 0 25%,#fffaf0 0 50%) 0 0/16px 16px;border:1px solid #d9c4a2}.afr div{position:absolute}
.page{background:repeating-conic-gradient(#3a2f47 0 25%,#2a2233 0 50%) 0 0/16px 16px;border:2px solid #3a2634;height:auto}
`;

function css(m: Manifest): string {
  void m;
  return `
*{box-sizing:border-box}
body{margin:0;background:#2a2233;color:#3a2634;font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif;
  background-image:radial-gradient(#3a2f47 1.5px,transparent 1.6px);background-size:22px 22px}
header{padding:28px 40px 8px;color:#fff4e2}
header h1{margin:0 0 6px;font-size:28px;letter-spacing:1px}
header p{margin:0;color:#d9c6e8;font-size:14px}
nav{display:flex;gap:8px;flex-wrap:wrap;padding:10px 40px 0}
nav a{color:#ffd36b;font-size:13px;text-decoration:none;border:1.5px solid #5a4a6a;border-radius:20px;padding:3px 10px}
section{margin:22px 40px;padding:20px 24px 24px;background:#fff4e2;border:3px solid #3a2634;border-radius:22px;box-shadow:0 6px 0 #1b1522}
section h2{margin:0 0 4px;font-size:20px}
section .desc{margin:0 0 16px;color:#7a6470;font-size:13px}
.row{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
img{display:block}

/* ---------- 小屋场景 ---------- */
.wx input{display:none}
.wx-labels{display:flex;gap:8px;margin-bottom:10px}
.wx-labels label{cursor:pointer;padding:5px 14px;border-radius:16px;border:2.5px solid #3a2634;background:#fffaf0;font-size:13px;user-select:none}
#wx-auto:checked~.wx-labels label[for=wx-auto],#wx-bull:checked~.wx-labels label[for=wx-bull],#wx-flat:checked~.wx-labels label[for=wx-flat],#wx-bear:checked~.wx-labels label[for=wx-bear]{background:#ffd36b}
.scene{position:relative;width:100%;max-width:1280px;aspect-ratio:16/9;overflow:hidden;border-radius:14px;border:3px solid #3a2634}
.scene .L{position:absolute;inset:0;width:100%;height:100%}
.scene .s-bull,.scene .s-flat,.scene .s-bear{opacity:0;transition:opacity .8s}
#wx-bull:checked~.scene .s-bull,#wx-flat:checked~.scene .s-flat,#wx-bear:checked~.scene .s-bear{opacity:1}
#wx-auto:checked~.scene .s-bull{animation:wx1 18s infinite}
#wx-auto:checked~.scene .s-flat{animation:wx2 18s infinite}
#wx-auto:checked~.scene .s-bear{animation:wx3 18s infinite}
@keyframes wx1{0%,28%{opacity:1}36%,92%{opacity:0}100%{opacity:1}}
@keyframes wx2{0%,28%{opacity:0}36%,61%{opacity:1}69%,100%{opacity:0}}
@keyframes wx3{0%,61%{opacity:0}69%,92%{opacity:1}100%{opacity:0}}
.city{animation:drift 30s ease-in-out infinite alternate}
@keyframes drift{from{transform:translateX(-1.2%)}to{transform:translateX(1.2%)}}
.rainfall{position:absolute;left:0;top:-100%;width:100%;height:200%;animation:rain .7s linear infinite}
.rainfall img{width:100%;height:50%}
@keyframes rain{from{transform:translate(1%,0)}to{transform:translate(0,50%)}}
.bolt{position:absolute;inset:0;width:100%;height:100%;opacity:0;animation:bolt 6.3s infinite}
.flash{position:absolute;left:32.8%;top:7.8%;width:34.4%;height:38.9%;background:#fff;opacity:0;animation:flash 6.3s infinite}
@keyframes bolt{0%,86%{opacity:0}87%{opacity:.95}88.5%{opacity:.1}90%{opacity:.85}93%,100%{opacity:0}}
@keyframes flash{0%,86%{opacity:0}87%{opacity:.3}88.5%{opacity:0}90%{opacity:.2}93%,100%{opacity:0}}
.steam{animation:steam 3s ease-in-out infinite}
@keyframes steam{0%{transform:translateY(1%);opacity:0}30%{opacity:1}100%{transform:translateY(-3%);opacity:0}}
.cat{transform-origin:77% 81%;animation:catb 3.6s ease-in-out infinite}
@keyframes catb{0%,100%{transform:scale(1,1)}50%{transform:scale(1.006,1.025)}}
.tail{transform-origin:83.3% 77.2%;animation:tail 2.6s ease-in-out infinite}
@keyframes tail{0%,100%{transform:rotate(0)}50%{transform:rotate(-3deg)}}
.zzz{animation:zzz 3.6s ease-in-out infinite}
@keyframes zzz{0%{transform:translate(0,1%);opacity:0}25%{opacity:1}100%{transform:translate(-.6%,-3%);opacity:0}}
.glow{animation:glow 2.2s ease-in-out infinite alternate}
@keyframes glow{from{opacity:.75}to{opacity:1}}
.lamp{animation:glow 5s ease-in-out infinite alternate}

/* ---------- 小人 ---------- */
.heroes{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px}
.hero{background:#fffaf0;border:2.5px solid #3a2634;border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.hero-top{display:flex;gap:10px;align-items:center}
.hero h3{margin:0;font-size:18px}
.hero .note{font-size:12px;color:#7a6470}
.hero .exprs{display:flex;gap:2px}.hero .exprs img{width:58px;height:58px}
.hero .exprs figure{margin:0;text-align:center;font-size:11px;color:#7a6470}
.stage{background:radial-gradient(circle at 50% 70%,#fff1d6,#f6dfbd);border-radius:14px;border:2px dashed #e8cfa8}
.rig{position:relative}
.rig img,.rig .mover,.rig .breath{position:absolute;inset:0;width:100%;height:100%}
.rig .breath{animation:breath 3s ease-in-out infinite}
@keyframes breath{0%,100%{transform:scale(1,1)}50%{transform:scale(1.018,1.04)}}
/* 眨眼用 visibility 切换（不触发合成层，软件渲染下也稳定） */
.rig .eo{animation:blinkO 4.2s infinite}
.rig .eb{visibility:hidden;animation:blinkB 4.2s infinite}
@keyframes blinkO{0%,90%{visibility:visible}91%,95%{visibility:hidden}96%,100%{visibility:visible}}
@keyframes blinkB{0%,90%{visibility:hidden}91%,95%{visibility:visible}96%,100%{visibility:hidden}}
.rig-hop .mover{animation:hop 2.6s infinite}
.rig-hop .shadow{animation:shadowHop 2.6s infinite}
@keyframes hop{0%,62%,100%{transform:translateY(0) scale(1,1)}68%{transform:translateY(0) scale(1.08,.92)}78%{transform:translateY(-12%) scale(.96,1.05)}88%{transform:translateY(0) scale(1.06,.94)}94%{transform:translateY(0) scale(.99,1.01)}}
@keyframes shadowHop{0%,62%,100%{transform:scale(1)}68%{transform:scale(1.08,1)}78%{transform:scale(.7,.8);opacity:.6}88%{transform:scale(1.06,1)}}
.rig-lazy .breath{animation:breath 4.8s ease-in-out infinite}
.rig-sway .mover{animation:sway 2.4s ease-in-out infinite}
@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.rig-run .spin{animation:spin 1.1s linear infinite}
.rig-run .mover{animation:trot .28s ease-in-out infinite alternate}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes trot{from{transform:translateY(0)}to{transform:translateY(-1.5%)}}
.rig-run .mover .spin{animation:spin 1.1s linear infinite}
.rig-jitter .mover{animation:jitter .32s steps(1) infinite}
@keyframes jitter{0%{transform:translate(0,0)}25%{transform:translate(1.2%,-.6%)}50%{transform:translate(-1%,.8%)}75%{transform:translate(.6%,1%)}}
.cycler{position:relative}
.cycler img{position:absolute;inset:0;width:100%;height:100%;opacity:0;animation:cyc 9.6s infinite}
@keyframes cyc{0%,16.6%{opacity:1}16.7%,100%{opacity:0}}
.cycler-labels span{position:absolute;left:0;right:0;bottom:-18px;text-align:center;font-size:12px;opacity:0;animation:cyc 9.6s infinite;color:#3a2634;font-weight:600}

table.roster{border-collapse:separate;border-spacing:4px 6px}
.roster th{font-size:12px;color:#7a6470;font-weight:600}
.roster td.name{font-size:13px;padding-right:6px;white-space:nowrap}
.roster td.name small{display:block;color:#9a8490;font-size:11px}
.roster td.cell{background:#fffaf0;border-radius:12px;border:1.5px solid #ead9bf}
.roster td.cell img{width:96px;height:96px}
.roster .meta{display:flex;gap:4px;align-items:center;margin-top:3px}
.roster .meta img{width:20px;height:20px}
.cols2{display:grid;grid-template-columns:repeat(auto-fill,minmax(720px,1fr));gap:6px 24px}

/* ---------- 持仓卡 ---------- */
.hcard{position:relative;width:156px;padding:4px 10px 12px;border-style:solid;border-width:18px;border-image:url(${A}ui/card_holding.svg) 18 fill / 18px stretch;margin:-8px}
.hcard>*{position:relative}
.hcard::before,.panel::before,.rcard::before{content:"";position:absolute;inset:-4px;border-radius:10px;background:url(${A}ui/paper_tile.svg);pointer-events:none}
.panel,.rcard{position:relative}
.hc-top{display:flex;gap:4px;align-items:center;margin:-8px -6px 0;flex-wrap:wrap}
.hc-top .role{width:20px;height:20px}
.tag{display:inline-flex;align-items:center;gap:2px;font-size:11px;padding:1px 7px 1px 2px;border-radius:10px;background:var(--c);color:#fff;border:2px solid #3a2634;font-weight:700;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.tag img{width:16px;height:16px}
.streak{font-size:11px;font-weight:800;color:#fff;background:#ff5d5d;border:2px solid #3a2634;border-radius:8px;padding:0 5px}
.hc-stock{margin:2px auto 0}
.hc-name{text-align:center;font-weight:800;font-size:15px;margin-top:-2px}
.hc-nums{display:flex;flex-direction:column;align-items:center;font-size:12px;margin-top:0}
.hc-nums>span:first-child{font-size:18px;font-weight:900;line-height:1.2}
.up{color:#e8352e}.down{color:#1f9d55}.muted{color:#8a7480}
.hc-sell{margin-top:6px;text-align:center;font-size:12px;font-weight:700;border:2px solid #3a2634;border-radius:10px;background:#fff;padding:2px 0}
.card-up .hc-stock{animation:cardHop 1.2s infinite}
@keyframes cardHop{0%,50%,100%{transform:translateY(0)}25%{transform:translateY(-10px)}}
.card-down .hc-stock{animation:shake .5s infinite}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
.card-dead{filter:saturate(.3)}
.card-fx{position:absolute;left:50%;top:-6px;width:80px;margin-left:-40px;pointer-events:none;z-index:2}
.card-fx.fw{animation:burst 1.6s ease-out infinite}
.card-fx.rc{width:70px;margin-left:-35px;top:-22px;animation:bob 2s ease-in-out infinite}
@keyframes burst{0%{transform:scale(.2);opacity:1}70%{opacity:1}100%{transform:scale(1.15);opacity:0}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}
.cards{display:flex;gap:26px;flex-wrap:wrap;padding:14px 10px;background:#f1dcbc;border-radius:14px}

/* ---------- 群聊 ---------- */
.phone{position:relative;width:360px;height:700px;border-style:solid;border-width:48px;border-image:url(${A}chat/phone_frame.svg) 48 fill / 48px stretch;padding:0}
.phone>*{position:relative}
.notch{position:absolute!important;left:50%;top:-24px;margin-left:-60px;width:120px}
.ch-head{margin:-30px -34px 0;padding:22px 16px 12px;display:flex;gap:10px;align-items:center;border-style:solid;border-width:30px 30px 10px;border-image:url(${A}chat/chat_header.svg) 34 36 12 fill / 30px 30px 10px stretch;padding:0 4px 6px}
.ch-avs{display:flex}
.ch-avs img{width:26px;height:26px;margin-right:-8px}
.ch-title{font-weight:800;font-size:15px;margin-left:8px}
.ch-sub{font-size:11px;color:#8a6a40;margin-left:8px}
.ch-body{margin:0 -30px;padding:8px 10px;height:560px;overflow:hidden;background:url(${A}chat/chat_bg_tile.svg)}
.sys{margin:4px auto 8px;width:max-content;font-size:11px;color:#8a7480;padding:4px 12px;border-style:solid;border-width:0 14px;border-image:url(${A}chat/system_pill.svg) 0 14 fill / 0 14px stretch}
.msg{display:flex;gap:6px;margin-bottom:8px;align-items:flex-start}
.msg .av{width:40px;height:40px;flex:none}
.who{font-size:11px;color:#7a6470;margin:0 0 1px 6px}
.rec{background:#ffd36b;color:#3a2634;border-radius:8px;padding:0 5px;font-weight:700;border:1.5px solid #3a2634}
.bubble{display:inline-block;max-width:210px;font-size:13px;line-height:1.4;padding:4px 6px 2px 10px;border-style:solid;border-width:12px 12px 10px 14px;border-image-source:url(${A}chat/bubble_left.svg);border-image-slice:22 16 16 20 fill;border-image-width:22px 16px 16px 20px}
.bubble.br{border-image-source:url(${A}chat/bubble_right.svg);border-image-slice:22 20 16 16 fill;border-image-width:22px 20px 16px 16px;border-width:12px 14px 10px 12px;padding:4px 10px 2px 6px}
.msg.me{justify-content:flex-end}
.rcard{width:220px;border-style:solid;border-width:24px;border-image:url(${A}chat/bubble_card.svg) 24 fill / 24px stretch;padding:0;margin-top:2px}
.rc-head{margin:-20px -14px 0 26px;font-size:11px;font-weight:800;color:#fff;height:16px;line-height:14px}
.rc-body{display:flex;gap:6px;align-items:center;margin:6px -12px -12px}
.rc-name{font-weight:800;font-size:14px}
.rc-reason{font-size:12px;color:#7a6470;margin:2px 0 4px}
.btn-buy{display:inline-block;color:#fff;font-weight:800;font-size:12px;padding:0 6px;border-style:solid;border-width:8px 16px 10px;border-image:url(${A}ui/button_buy.svg) 16 24 fill / 8px 16px 10px stretch;text-shadow:0 1px 0 rgba(0,0,0,.25)}
kbd{font-size:10px;background:rgba(255,255,255,.3);border-radius:4px;padding:0 3px}

/* ---------- 头像 / 徽记 / 热度 ---------- */
.avatars{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.avbox{background:#fffaf0;border-radius:14px;border:1.5px solid #ead9bf;padding:8px}
.avbox .nm{font-size:13px;font-weight:700;margin-bottom:4px}
.avbox .three{display:flex;gap:4px}
.avbox figure{margin:0;text-align:center;font-size:11px;color:#7a6470}
.avbox figure img{width:80px;height:80px}
.badges{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;text-align:center;font-size:13px;font-weight:700}
.badges img{width:72px;height:72px;margin:0 auto 4px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1.5px solid #3a2634;vertical-align:-1px;margin-right:3px}
.heat{display:flex;flex-direction:column;gap:12px;margin-top:18px;max-width:560px}
.hrow{display:flex;gap:10px;align-items:center}
.hrow img.b{width:40px;height:40px}
.hbar{position:relative;flex:1;height:22px;border:2.5px solid #3a2634;border-radius:12px;background:#f1e0c6;overflow:visible}
.hfill{position:absolute;left:0;top:0;bottom:0;border-radius:9px}
.hflame{position:absolute;top:-22px;width:22px;animation:flick .5s ease-in-out infinite alternate;transform-origin:50% 100%}
@keyframes flick{from{transform:scale(1,1) rotate(-3deg)}to{transform:scale(1.1,1.2) rotate(3deg)}}
.hice{position:absolute;top:-6px;width:20px;animation:twinkle 1.6s ease-in-out infinite}
@keyframes twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.8) rotate(20deg);opacity:.7}}
.htide{position:absolute;inset:0;border-radius:9px;background:url(${A}fx/tide.svg) repeat-x 0 0/96px 100%;opacity:.8;animation:tide 2.4s linear infinite}
@keyframes tide{to{background-position:96px 0}}
.hlabel{width:48px;font-size:12px;font-weight:800}

/* ---------- 特效 ---------- */
.fxgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.fxbox{position:relative;height:190px;background:#3a2f47;border-radius:14px;overflow:hidden;border:2.5px solid #3a2634}
.fxbox .cap{position:absolute;left:10px;bottom:8px;color:#f3e6cf;font-size:12px}
.fxbox .c{position:absolute;left:50%;top:44%;translate:-50% -50%}
.flame-big{width:64px;animation:flick .45s ease-in-out infinite alternate;transform-origin:50% 100%}
.ice-big{width:64px;animation:twinkle 2s ease-in-out infinite}
.fw-big{width:150px;animation:burst 1.8s ease-out infinite}
.fw-star{position:absolute;width:20px;animation:fall 1.8s ease-in infinite}
@keyframes fall{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(var(--dx),70px) rotate(180deg);opacity:0}}
.cloud-big{width:140px;animation:bob 2.4s ease-in-out infinite}
.drop{position:absolute;width:10px;top:96px;animation:drop 1s linear infinite}
@keyframes drop{from{transform:translateY(0);opacity:1}to{transform:translateY(70px);opacity:0}}
.link{position:absolute;left:50%;top:40%;width:86%;translate:-50% -50%;display:flex;align-items:center}
.link .mini{width:64px;height:64px;flex:none}
.beam{position:relative;flex:1;height:24px;border-style:solid;border-width:0 16px;border-image:url(${A}fx/link_beam.svg) 0 16 fill / 0 16px stretch;animation:glow .5s ease-in-out infinite alternate}
.spark{position:absolute;top:-4px;width:32px;animation:travel 1.2s ease-in infinite}
@keyframes travel{from{left:-16px}to{left:calc(100% - 16px)}}
.coin-spin{width:56px;animation:coinspin 1.4s linear infinite}
@keyframes coinspin{0%{transform:scaleX(1)}25%{transform:scaleX(.08)}50%{transform:scaleX(-1)}75%{transform:scaleX(.08)}100%{transform:scaleX(1)}}
.coin-up{position:absolute;width:26px;bottom:20px;animation:coinup 1.6s ease-out infinite}
@keyframes coinup{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(var(--dx),-120px) rotate(200deg);opacity:0}}
.sparkle{position:absolute;width:16px;animation:twinkle 1.2s ease-in-out infinite}

/* ---------- 账单 ---------- */
.bills{display:flex;gap:40px;flex-wrap:wrap;align-items:flex-start}
.bill{position:relative;width:320px;height:400px}
.bill .t{position:absolute;font-weight:800}
.bill .h{left:84px;top:24px;font-size:20px;color:#3a2634}
.bill .h small{display:block;font-size:12px;font-weight:600;color:#6b3a3a}
.bill .it{left:32px;right:32px;font-size:15px;display:flex;justify-content:space-between;font-weight:600;color:#5a4650}
.bill .tot{left:40px;right:40px;top:294px;font-size:24px;display:flex;justify-content:space-between}
.stamp{position:absolute;display:flex;align-items:center;justify-content:center;animation:slam 3.2s infinite}
.stamp img{position:absolute;inset:0;width:100%;height:100%}
.stamp span{position:relative;font-family:"Noto Serif CJK SC","Songti SC",serif;font-weight:900;letter-spacing:2px}
.stamp.paid{width:160px;height:160px;right:-26px;top:150px;--r:-14deg}
.stamp.paid span{font-size:34px;color:#e23b2e;opacity:.9}
.stamp.over{width:220px;height:110px;right:-34px;top:180px;--r:10deg}
.stamp.over span{font-size:40px;color:#4b3a7a;opacity:.9;letter-spacing:12px}
@keyframes slam{0%,20%{transform:scale(2.4) rotate(var(--r));opacity:0}30%{transform:scale(.92) rotate(var(--r));opacity:1}36%,92%{transform:scale(1) rotate(var(--r));opacity:1}100%{opacity:0;transform:scale(1) rotate(var(--r))}}
.ui-row{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:16px}
.ui-row figure{margin:0;text-align:center;font-size:11px;color:#7a6470}
.bigbtn{display:inline-block;color:#fff;font-size:26px;font-weight:900;letter-spacing:6px;padding:0 30px;border-style:solid;border-width:12px 24px 14px;border-image:url(${A}ui/button_big.svg) 16 24 fill / 12px 24px 14px stretch;text-shadow:0 2px 0 rgba(0,0,0,.25)}
.panel{width:220px;height:90px;border-style:solid;border-width:20px;border-image:url(${A}ui/panel_paper.svg) 20 fill / 20px stretch;font-size:12px;color:#7a6470}
footer{color:#b9a6c8;font-size:12px;padding:10px 40px 40px}
${CSS_NEW}${CSS_031}`;
}

export function build(): number {
  const m = JSON.parse(readFileSync(`${ROOT}public/assets/art/v3/stocks/manifest.json`, 'utf8')) as Manifest;
  const byId = (id: string) => m.stocks.find((s) => s.id === id)!;

  // 精做 6 只
  let heroes = '';
  for (const id of HERO_ORDER) {
    const s = byId(id);
    const h = HERO_NOTES[id]!;
    heroes +=
      `<div class="hero"><div class="hero-top"><div class="stage">${rig(s, 150, h.anim)}</div><div>${cycler(s, 96)}</div></div>` +
      `<div><h3>${esc(s.name)} <span style="font-size:12px;color:#9a8490">${s.id}</span></h3><div class="note">${esc(h.note)}</div></div>` +
      `<div class="exprs">${EXPRESSIONS.map((e) => `<figure><img src="${A}stocks/${s.composite[e]}" width="64" height="64" alt=""><figcaption>${EXPR_LABEL[e]}</figcaption></figure>`).join('')}</div></div>`;
  }

  // 全部 26 只
  const rows = (list: StockM[]) =>
    `<table class="roster"><tr><th></th>${EXPRESSIONS.map((e) => `<th>${EXPR_LABEL[e]}</th>`).join('')}<th>眨眼</th></tr>` +
    list
      .map(
        (s) =>
          `<tr><td class="name">${esc(s.name)}${s.hero ? ' ★' : ''}<small>${s.id}</small><div class="meta"><img src="${A}themes/${s.theme}.svg" alt=""><img src="${A}ui/role_${s.role}.svg" alt=""><small>${m.roles[s.role]!.name}</small></div></td>` +
          EXPRESSIONS.map((e) => `<td class="cell"><img src="${A}stocks/${s.composite[e]}" alt=""></td>`).join('') +
          `<td class="cell"><img src="${A}stocks/${s.composite.blink}" alt=""></td></tr>`,
      )
      .join('') +
    `</table>`;
  const half = Math.ceil(m.stocks.length / 2);

  // 持仓卡
  const cards =
    holdingCard(byId('ai_leader'), 'limitup', '+10.00%', '+33.1%', 3, `<img class="card-fx fw" src="${A}fx/firework_burst.svg" alt="">`) +
    holdingCard(byId('con_blue'), 'happy', '+3.42%', '+8.6%', 0) +
    holdingCard(byId('fin_blue'), 'calm', '+0.31%', '+1.2%', 0) +
    holdingCard(byId('ne_meme'), 'worried', '-2.87%', '-4.0%', 0) +
    holdingCard(byId('ai_meme'), 'limitdown', '-10.00%', '-18.5%', 0, `<img class="card-fx rc" src="${A}fx/raincloud.svg" alt="">`) +
    holdingCard(byId('st_bye'), 'delisted', '-90.00%', '-92.3%', 0);

  // 头像
  const exprName: Record<string, string> = { normal: '正常', smug: '得意', awkward: '尴尬' };
  const avatars = AVATAR_IDS.map(
    (id) =>
      `<div class="avbox"><div class="nm">${esc(AVATAR_NAMES[id]!)} <span style="font-size:11px;color:#9a8490;font-weight:400">${id}</span></div><div class="three">` +
      AVATAR_EXPR.map((e) => `<figure><img src="${A}avatars/${id}_${e}.svg" alt=""><figcaption>${exprName[e]}</figcaption></figure>`).join('') +
      `</div></div>`,
  ).join('');

  const badges = Object.entries(THEME_COLORS)
    .map(([id, t]) => `<div><img src="${A}themes/${id}.svg" alt="">${t.name}<br><span style="font-size:11px;color:#9a8490;font-weight:400"><span class="sw" style="background:${t.main}"></span>${t.main}</span></div>`)
    .join('');

  const heat = (theme: string, w: number, label: string, mode: 'fire' | 'ice' | 'none') => {
    const c = THEME_COLORS[theme]!.main;
    let deco = '';
    if (mode === 'fire') deco = [0, 1, 2].map((i) => `<img class="hflame" src="${A}fx/flame_small.svg" alt="" style="left:calc(${w}% - ${30 - i * 12}px);animation-delay:${-i * 0.17}s">`).join('');
    if (mode === 'ice') deco = `<div class="htide"></div>` + [0, 1, 2].map((i) => `<img class="hice" src="${A}fx/ice_shard.svg" alt="" style="left:${10 + i * 28}%;animation-delay:${-i * 0.5}s">`).join('');
    return `<div class="hrow"><img class="b" src="${A}themes/${theme}.svg" alt=""><div class="hbar"><div class="hfill" style="width:${w}%;background:${c}"></div>${deco}</div><div class="hlabel">${label}</div></div>`;
  };

  const fwStars = [-60, -30, 20, 50, 70]
    .map((dx, i) => `<img class="fw-star" src="${A}fx/firework_star.svg" alt="" style="left:calc(50% + ${dx}px);top:40%;--dx:${dx / 3}px;animation-delay:${-i * 0.3}s">`)
    .join('');
  const drops = [28, 45, 60, 75].map((x, i) => `<img class="drop" src="${A}fx/raindrop.svg" alt="" style="left:${x}%;animation-delay:${-i * 0.27}s">`).join('');
  const coinsUp = [-50, -20, 10, 40, 60].map((dx, i) => `<img class="coin-up" src="${A}fx/coin.svg" alt="" style="left:calc(50% - 13px);--dx:${dx}px;animation-delay:${-i * 0.32}s">`).join('');
  const sparkles = [[20, 20], [76, 30], [30, 70], [80, 72]].map(([x, y], i) => `<img class="sparkle" src="${A}fx/sparkle.svg" alt="" style="left:${x}%;top:${y}%;animation-delay:${-i * 0.3}s">`).join('');

  const bill = (stamp: 'paid' | 'over') =>
    `<div class="bill"><img src="${A}ui/bill_card.svg" width="320" height="400" alt="">` +
    `<div class="t h">十月 · 月供账单<small>还款日 10 月 31 日</small></div>` +
    `<div class="t it" style="top:106px"><span>房贷月供</span><span>¥3,200</span></div>` +
    `<div class="t it" style="top:150px"><span>信用卡</span><span>¥860</span></div>` +
    `<div class="t it" style="top:194px"><span>花呗</span><span>¥420</span></div>` +
    `<div class="t tot"><span>合计</span><span>¥4,480</span></div>` +
    (stamp === 'paid'
      ? `<div class="stamp paid"><img src="${A}ui/stamp_paid.svg" alt=""><span>已还清</span></div>`
      : `<div class="stamp over"><img src="${A}ui/stamp_overdue.svg" alt=""><span>逾期</span></div>`) +
    `</div>`;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>《开盘》0.3.0 美术样张</title>
<style>${css(m)}</style></head>
<body>
<header><h1>《开盘》0.3.0 美术样张</h1><p>Q 版股票小人 + 温暖的炒股小屋。全部为程序生成的原创 SVG（tools/art/），页面只用 CSS 动画。素材目录：public/assets/art/v3/</p></header>
<nav><a href="#friendly">0.3.1 看得懂</a><a href="#keyart">标题主视觉</a><a href="#new14">新增 14 只</a><a href="#blink">眨眼</a><a href="#items">道具图标</a><a href="#personas">人设立绘</a><a href="#difficulty">难度徽记</a><a href="#achievements">成就</a><a href="#codex">图鉴界面</a><a href="#atlas">图集</a><a href="#scene">小屋场景</a><a href="#heroes">精做 6 只</a><a href="#cards">持仓卡</a><a href="#chat">群聊</a><a href="#roster">全部股票</a><a href="#avatars">群友头像</a><a href="#themes">题材徽记</a><a href="#fx">特效</a><a href="#bill">账单与印章</a></nav>

<section id="friendly"><h2>0.3.1 看得懂 · 说明书插图、风口状态、收盘小结、新手提示猫</h2><p class="desc">guide/*.svg 520×300：上方 0–226 是画，下方留一条纸面写字（这里用网页文字演示）。stage_*.svg 32×32，颜色从冷到热、降温回到冷色；news.svg 40×40；recap_paper.svg 九宫格 24（不带颗粒）；cat_hint.svg 是小屋里那只橘猫醒着的样子。</p>${friendlyBlock()}</section>

<section id="keyart"><h2>标题页主视觉 · scene/title_keyart.svg</h2><p class="desc">1600×900：小屋 + 两侧股票小人 + 左上右上的群聊气泡；虚线框是留给 Logo 和按钮的中上部空白（只有天空和柔光）。主体集中在中间 1400 宽内，裁窄时先丢贴角的气泡。不进图集，单独加载。</p>${keyartBlock()}</section>

<section id="new14"><h2>0.3.0 新增 14 只</h2><p class="desc">和原有 26 只同一套部件与目录结构（stocks/&lt;id&gt;/、parts/、manifest.json）。白马股稳重对称打领带，跟风股整体缩小一号（0.86）举小旗，ST 用褪色旧灰配色贴创可贴。左侧大图是待机眨眼（calm↔blink）。</p><div class="news">${newStocks(m)}</div></section>

<section id="blink"><h2>眨眼 · 全部 ${m.stocks.length} 只</h2><p class="desc">stocks/&lt;id&gt;/blink.svg 与 calm.svg 同画布、完全对齐，只把眼睛换成闭眼（墨镜款换成镜片反光）。这里每 3.2 秒切一次 blink。</p><div class="blinkgrid">${m.stocks.map((s, i) => `<figure>${blinker(s, 72, -i * 0.29)}${esc(s.name)}</figure>`).join('')}</div></section>

<section id="items"><h2>道具图标 · 24 个</h2><p class="desc">items/&lt;itemId&gt;.svg，64×64。底板颜色按类别：战法暖桃、工具天蓝、人脉淡紫；每格左边 64px、右边 40px。</p><div class="items">${itemsGrid()}</div><p class="desc" style="margin-top:12px">深色底：</p><div class="items dark">${itemsGrid()}</div></section>

<section id="personas"><h2>人设立绘</h2><p class="desc">personas/&lt;id&gt;.svg（240×300 半身，透明底）与 &lt;id&gt;_locked.svg（剪影 + 问号）。</p><div class="personas">${personasRow()}</div></section>

<section id="difficulty"><h2>难度徽记 · 市场环境 1–8</h2><p class="desc">difficulty/&lt;n&gt;.svg，96×96。外形由圆章 → 盾 → 带铆钉的盾 → 带尖角的盾，颜色由青绿到暗红，6 级起加警示斜纹，8 级带火焰；底部圆牌是数字（路径绘制）。每格 96px 与 48px。</p><div class="diffs">${difficultyRow()}</div></section>

<section id="achievements"><h2>成就框与图标</h2><p class="desc">achievements/frame_*.svg 96×96；icon_*.svg 64×64 透明底，居中叠在框上（偏移 16,16，即图标占框的 2/3）。未达成用 frame_locked，图标由画面层压暗或不画。</p>${achievementsBlock()}</section>

<section id="codex"><h2>图鉴界面元素</h2><p class="desc">页签（未选 / 选中）、图鉴卡（九宫格 24）、未解锁问号卡、新解锁角标、小锁、收集进度条（九宫格 12）、横屏提示。</p>${codexBlock(m)}</section>

<section id="atlas"><h2>图集 · atlas/</h2>${atlasBlock()}</section>

<section id="scene"><h2>小屋场景 · 天色三态</h2><p class="desc">1280×720 分层：天色（牛晴 / 平阴 / 熊雷雨）→ 城市 → 雷雨暗雾 / 雨 / 闪电（3 个位置轮流）→ 墙（窗洞镂空）→ 书桌 → 热气 → 猫（身体 / 尾巴 / Zzz 分层）→ 氛围光 → 台灯光 → 显示器光。默认自动轮换，也可以点选。</p>${scene()}</section>

<section id="heroes"><h2>精做 6 只 · 待机动作</h2><p class="desc">左边是分层部件拼起来的待机动画（呼吸、眨眼、弹跳；仓鼠轮单独旋转，量子波动发抖，辣条摇摆，存钱猪慢呼吸）；右边是 6 种表情的合成图轮播。</p><div class="heroes">${heroes}</div></section>

<section id="cards"><h2>持仓卡样例 · 96px 小人</h2><p class="desc">卡框是 ui/card_holding.svg 九宫格。涨停弹跳 + 烟花，跌停发抖 + 雨云，退市变灰。</p><div class="cards">${cards}</div></section>

<section id="chat"><h2>群聊样例</h2><p class="desc">手机外框、标题栏、气泡、推荐卡片、系统提示都用九宫格拉伸（CSS border-image 演示）。头像左侧是群友，右侧暖黄气泡是自己。</p><div class="row">${chatSample(m)}
<div style="flex:1;min-width:300px"><h3 style="margin:0 0 8px">开盘按钮 / 面板 / 标签</h3><div class="ui-row"><div class="bigbtn">开盘</div><div class="btn-buy" style="font-size:15px">买入 <kbd>2</kbd></div></div>
<div class="ui-row"><div class="panel">纸面板 panel_paper.svg（九宫格 20px），用于左栏题材看板与弹窗。</div>${['leader', 'follower', 'bluechip', 'meme', 'st'].map((r) => `<figure><img src="${A}ui/role_${r}.svg" width="32" height="32" alt=""><figcaption>${m.roles[r]!.name}</figcaption></figure>`).join('')}</div>
<div class="heat">${heat('ai', 86, '火热', 'fire')}${heat('pig', 62, '升温', 'fire')}${heat('finance', 34, '冷门', 'none')}${heat('gaming', 48, '降温', 'ice')}</div></div></div></section>

<section id="roster"><h2>全部 ${m.stocks.length} 只 × 6 种表情 + 眨眼（96px）</h2><p class="desc">★ 为精做；其余每只一个名字梗剪影（tools/art/stocks.ts 的 RECIPES），身体用题材色，角色配饰自动加。表情从左到右：平静 / 开心 / 涨停 / 发愁 / 跌停 / 退市。</p><div class="cols2"><div>${rows(m.stocks.slice(0, half))}</div><div>${rows(m.stocks.slice(half))}</div></div></section>

<section id="avatars"><h2>群友头像</h2><p class="desc">8 位群友 × 正常 / 得意 / 尴尬。96×96 圆形，聊天里缩到 40px 也能认。</p><div class="avatars">${avatars}</div></section>

<section id="themes"><h2>题材徽记</h2><p class="desc">64×64 彩色贴纸章，底色即题材主色。</p><div class="badges">${badges}</div></section>

<section id="fx"><h2>特效贴图</h2><p class="desc">火苗、冰晶、烟花、雨云、连线光效、金币。深色底方便看清透明边缘。</p><div class="fxgrid">
<div class="fxbox"><img class="c flame-big" src="${A}fx/flame.svg" alt=""><div class="cap">flame / flame_small（热度升温）</div></div>
<div class="fxbox"><img class="c ice-big" src="${A}fx/ice.svg" alt="">${sparkles}<div class="cap">ice / ice_shard（退潮结冰）</div></div>
<div class="fxbox"><img class="c fw-big" src="${A}fx/firework_burst.svg" alt="">${fwStars}<div class="cap">firework_*（涨停烟花）</div></div>
<div class="fxbox"><img class="c cloud-big" src="${A}fx/raincloud.svg" alt="" style="top:34%">${drops}<div class="cap">raincloud / raindrop（跌停雨云）</div></div>
<div class="fxbox" style="grid-column:span 2"><div class="link"><img class="mini" src="${A}stocks/ai_leader/limitup.svg" alt=""><div class="beam"><img class="spark" src="${A}fx/link_spark.svg" alt=""></div><img class="mini" src="${A}stocks/ai_follower/happy.svg" alt=""></div><div class="cap">link_beam（三段拉伸）+ link_spark（龙头带动跟风）</div></div>
<div class="fxbox"><img class="c coin-spin" src="${A}fx/coin.svg" alt="">${coinsUp}<div class="cap">coin（金币）</div></div>
<div class="fxbox"><div class="c" style="width:200px;height:48px;background:url(${A}fx/tide.svg) repeat-x 0 0/128px 48px;animation:tide 2.4s linear infinite"></div><div class="cap">tide（退潮潮水，横向平铺）</div></div>
</div></section>

<section id="bill"><h2>账单卡与印章</h2><p class="desc">账单与印章的 SVG 里都没有文字，文字由画面层叠加（这里用网页文字演示）。印章有轻微抖边和缺墨。</p><div class="bills">${bill('paid')}${bill('over')}
<div style="display:flex;flex-direction:column;gap:12px"><img src="${A}ui/stamp_paid.svg" width="160" height="160" alt=""><img src="${A}ui/stamp_overdue.svg" width="220" height="110" alt=""></div></div></section>

<footer>生成：node tools/art/build.ts（全部）或 node tools/art/build.ts preview（只重建本页）。规范见 public/assets/art/README.md 的“v3 美术”一节。</footer>
</body></html>
`;
  const out = `${ROOT}public/art-preview.html`;
  if (!existsSync(out) || readFileSync(out, 'utf8') !== html) writeFileSync(out, html);
  return 1;
}
