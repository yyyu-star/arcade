/**
 * 舞台和座位的位置（DESIGN.md 8.2）。舞台高固定 540 个设计单位，宽随屏幕在 860–1170 之间变（4:3 平板到 19.5:9 手机都铺满），
 * 再整体缩放到看得见的区域。座位按"离我第几个"排在椭圆桌边，我永远在正下方。
 */
export const STAGE_H = 540;
export const STAGE_MIN_W = 860;
export const STAGE_MAX_W = 1170;

export interface Pt {
  x: number;
  y: number;
}

/**
 * 竖屏（0.10.0）：手机竖着拿时舞台宽 540、高随屏幕在 810–1170 之间变。桌子是竖的椭圆，别人沿桌边一圈，
 * 我和操作区在下半屏（拇指够得着）；顶上两行是顶栏和"第几手、歇一手、嘲讽"。
 */
export const TALL_W = 540;
export const TALL_MIN_H = 810;
export const TALL_MAX_H = 1170;
/** 竖屏顶上留给顶栏和第二行按钮的高度，桌子从这里往下 */
const TALL_TOP = 150;
/** 竖屏底下留给操作区（加注面板展开时最高）的高度：我的名牌下沿要在它上面 */
const TALL_BOTTOM = 310;

/** 舞台的样子：宽、高、是不是竖屏 */
export interface Geo {
  w: number;
  h: number;
  tall: boolean;
}

/** 我的座位的点（名牌上沿往上一点，各部件按它摆，style.css 的 .seat.me） */
const meY = (g: Geo): number => (g.tall ? g.h - TALL_BOTTOM - 62 : ME_Y);

/** 桌子：椭圆的中心和半轴（设计单位） */
export function felt(g: Geo): { cx: number; cy: number; rx: number; ry: number } {
  if (!g.tall) return { cx: g.w / 2, cy: 250, rx: g.w / 2 - 120, ry: 168 };
  // 竖屏：下沿在我的底牌上面（底牌顶到点上方约 91）
  const bottom = meY(g) - 100;
  return { cx: g.w / 2, cy: (TALL_TOP + bottom) / 2, rx: 200, ry: (bottom - TALL_TOP) / 2 };
}

/**
 * 我的座位（0.1.1 重排）：底牌在上、名牌在下、头像在名牌左边，三样不叠；下注在底牌上方，再往上是池子和公共牌。
 * 座位的点是名牌上沿往上一点，各部件按它摆（style.css 的 .seat.me）
 */
const ME_Y = 470;

/** 横屏每种人数的座位位置：[x 占舞台宽的比例, y]，第 0 个是我 */
const SLOTS: Record<number, [number, number][]> = {
  2: [[0.5, ME_Y], [0.5, 66]],
  3: [[0.5, ME_Y], [0.24, 92], [0.76, 92]],
  4: [[0.5, ME_Y], [0.085, 250], [0.5, 66], [0.915, 250]],
  5: [[0.5, ME_Y], [0.085, 280], [0.27, 70], [0.73, 70], [0.915, 280]],
  6: [[0.5, ME_Y], [0.11, 360], [0.11, 128], [0.5, 66], [0.89, 128], [0.89, 360]],
  // 7–9 人（0.2.0）：左右各两个贴着桌边（再往下是操作区和左下角的按钮，放不下），其余排在顶上
  7: [[0.5, ME_Y], [0.08, 340], [0.12, 130], [0.36, 62], [0.64, 62], [0.88, 130], [0.92, 340]],
  8: [[0.5, ME_Y], [0.07, 330], [0.08, 175], [0.27, 66], [0.5, 60], [0.73, 66], [0.92, 175], [0.93, 330]],
  9: [[0.5, ME_Y], [0.07, 335], [0.07, 190], [0.2, 78], [0.39, 60], [0.61, 60], [0.8, 78], [0.93, 190], [0.93, 335]],
};

/**
 * 竖屏别人的座位：沿桌边一圈，从我左下方开始顺时针（和横屏同一个方向），到我右下方为止。
 * 角度 90° 是正下方（我）；别人最多从 145° 排到 395°，人少时往上收（2 人桌对面就在正上方）
 */
function ringPos(k: number, n: number, g: Geo): Pt {
  const f = felt(g);
  const span = Math.min(250, 60 * (n - 1));
  const from = 270 - span / 2;
  const deg = n === 1 ? 270 : from + (k * span) / (n - 1);
  const a = (deg * Math.PI) / 180;
  // 座位的点在桌边稍往里：头像压着桌边，名牌在桌外那一侧
  return { x: Math.round(f.cx + (f.rx + 8) * Math.cos(a)), y: Math.round(f.cy + (f.ry + 6) * Math.sin(a)) };
}

/** 第 seat 号座位在舞台上的位置（me 是我坐的座位，画在正下方） */
export function seatPos(seat: number, me: number, size: number, g: Geo): Pt {
  const k = (seat - me + size) % size;
  if (g.tall) return k === 0 ? { x: g.w / 2, y: meY(g) } : ringPos(k - 1, size - 1, g);
  const [fx, y] = SLOTS[size]![k]!;
  return { x: fx * g.w, y };
}

/** 顶上一排的座位：动作签、看对手的卡放在下面 */
export const isTop = (p: Pt, g: Geo): boolean => (g.tall ? p.y < felt(g).cy - felt(g).ry * 0.75 : p.y < 150);

/** 下注的筹码放在座位和桌子中心之间（我的在底牌正上方） */
export function betPos(p: Pt, g: Geo, mine: boolean): Pt {
  const f = felt(g);
  // 我的：底边在底牌上面一点（.bet.mine 按底边摆），往上长不碰底池
  if (mine) return { x: f.cx, y: p.y - 100 };
  // 竖屏桌子窄、座位挤：顶上的放在名牌正下方，两边的放在名牌朝桌心那一侧、底牌下面，不碰动作签、底牌和名牌（0.10.0 审阅）
  // 0.21.3（10-19 竖屏打磨）：上半边两侧的原来按座位往下 44，正好落在公共牌上；改成公共牌上方那一条，左右让开顶上座位的下注
  if (g.tall) {
    if (isTop(p, g)) return { x: p.x, y: p.y + 104 };
    const dir = p.x < f.cx ? 1 : -1;
    return p.y < f.cy ? { x: p.x + dir * 112, y: TALL_BOARD_Y(g) - 59 } : { x: p.x + dir * 124, y: p.y + 44 };
  }
  // 往桌心走 42%，但离座位 90–130 之间（0.18.2）：只按比例时顶上的座位离桌心近，筹码贴着名牌，两边的离得远，筹码跑到桌子中间，看着不齐
  const dx = f.cx - p.x;
  const dy = f.cy - p.y;
  const dist = Math.hypot(dx, dy);
  const d = Math.min(130, Math.max(90, dist * 0.42));
  return { x: p.x + (dx / dist) * d, y: p.y + (dy / dist) * d + 6 };
}

/** 庄家按钮：在下注的位置旁边偏一点 */
export function buttonPos(p: Pt, g: Geo, mine: boolean): Pt {
  // 竖屏别人的（0.21.3）：按下注摆会落到公共牌、别人的下注上；两侧的贴在头像朝外的上角（像角标：底牌在朝桌心那边，动作签在正上方），顶上的放名牌右下
  if (g.tall && !mine) return isTop(p, g) ? { x: p.x + 84, y: p.y + 62 } : { x: p.x - (p.x < felt(g).cx ? 1 : -1) * 32, y: p.y - 26 };
  const b = betPos(p, g, mine);
  // 别人的放在下注那摞筹码的左边（数字在右边），不压数字
  return mine ? { x: b.x - 96, y: b.y - 12 } : { x: b.x - 64, y: b.y };
}

/**
 * 荷官（0.18.3）能站的地方：桌子顶边上离顶上的座位左右都够远的点，按先后试（中间、右边 32% 处、左边 32% 处）。
 * 横屏才有；7–9 人桌顶上坐满了，一个都没有。点在桌边上，荷官按它摆、牌从它上面一点发出来。
 * 还要不碰顶栏（左边"在哪一桌"的字、右边的按钮，长短随玩法变），那一步在 table.ts 按实际位置挑
 */
export function dealerSpots(g: Geo, size: number): Pt[] {
  if (g.tall) return [];
  const f = felt(g);
  const seats = Array.from({ length: size }, (_, k) => seatPos(k, 0, size, g)).filter((p) => p.y < 200);
  // 0.66 / 0.34 是离顶上座位刚好够远的最后一档：顶栏右边按钮多了（0.19.3 单机也有聊天开关）68% 处会碰到，往里挪一点
  return [0.5, 0.68, 0.32, 0.66, 0.34]
    .map((fx) => g.w * fx)
    .filter((x) => seats.every((p) => Math.abs(p.x - x) >= DEALER_ROOM))
    .map((x) => {
      const t = (x - f.cx) / f.rx;
      return { x, y: f.cy - f.ry * Math.sqrt(1 - t * t) };
    });
}
/** 荷官左右各要让出多宽（头像 60、名牌 108、旁边的底牌和动作签都算上） */
const DEALER_ROOM = 150;

/**
 * 竖屏公共牌那一行的中心（0.21.3）：比桌心低一点，上面让出一条放上半边两侧座位的下注。
 * 竖屏的公共牌也缩小了（style.css 的 .stage.tall .card.board，50 宽、间距 54）：原来 5 张两头压到左右座位的名牌（10-19 截图）
 */
const TALL_BOARD_Y = (g: Geo): number => felt(g).cy + 16;
/** 公共牌：5 张的中心（竖屏桌子窄，挨得近一点） */
export const boardPos = (g: Geo, i: number): Pt =>
  g.tall ? { x: g.w / 2 + (i - 2) * 54, y: TALL_BOARD_Y(g) } : { x: g.w / 2 + (i - 2) * 66, y: felt(g).cy - 18 };
/** 池子在公共牌下面（0.1.1：原来在上面，和顶上座位的下注、庄家按钮挤在一起） */
export const potPos = (g: Geo): Pt => ({ x: g.w / 2, y: g.tall ? TALL_BOARD_Y(g) + 70 : felt(g).cy + 54 });
/** 一手的结果条：公共牌和池子下面（0.1.1：放在上面会盖住顶上座位的庄家按钮），按上边摆；0.18.2 往上挪 12，两行的结果不压我的底牌 */
export const resultPos = (g: Geo): Pt => ({ x: g.w / 2, y: g.tall ? TALL_BOARD_Y(g) + 80 : felt(g).cy + 64 });
/** 牌堆：发牌从这里出，弃的牌、收的牌飞回这里。在桌子正中（公共牌的位置） */
export const deckPos = (g: Geo): Pt => (g.tall ? { x: g.w / 2, y: TALL_BOARD_Y(g) } : { x: g.w / 2, y: felt(g).cy - 18 });

/**
 * 按看得见的区域算舞台：高比宽大 1.5 倍以上（手机竖着拿）用竖屏舞台，否则横屏（平板竖着也用横屏，上下留边）
 */
export function fit(availW: number, availH: number): Geo & { scale: number } {
  if (availH / availW >= 1.5) {
    let scale = availW / TALL_W;
    let h = availH / scale;
    if (h < TALL_MIN_H) {
      scale = availH / TALL_MIN_H;
      h = TALL_MIN_H;
    }
    return { w: TALL_W, h: Math.min(TALL_MAX_H, h), tall: true, scale };
  }
  let scale = availH / STAGE_H;
  let w = availW / scale;
  if (w < STAGE_MIN_W) {
    scale = availW / STAGE_MIN_W;
    w = STAGE_MIN_W;
  }
  return { w: Math.min(STAGE_MAX_W, w), h: STAGE_H, tall: false, scale };
}
