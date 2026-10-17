/**
 * 界面图标：viewBox 0 0 64 64，透明底，单色线面结合，线宽 5、圆角端点。
 */
import { svg } from './common.ts';

export type IconName = 'play' | 'pass' | 'hint' | 'sort' | 'undo' | 'settings' | 'rules' | 'sound' | 'mute' | 'back' | 'stats' | 'home' | 'close' | 'check' | 'crown' | 'bomb' | 'cards' | 'robot' | 'speed' | 'restart'
  | 'cloudOff' | 'cloudCheck' | 'cloudSync' | 'cloudUp' | 'cloudMerge' | 'chat' | 'invite' | 'smile' | 'share';

/** 齿轮路径：8 齿 */
function gear(): string {
  const n = 8;
  let d = '';
  for (let i = 0; i < n * 4; i++) {
    const a = (i / (n * 4)) * Math.PI * 2 - Math.PI / (n * 4);
    const r = i % 4 === 1 || i % 4 === 2 ? 26 : 19;
    d += `${i === 0 ? 'M' : 'L'}${(32 + Math.cos(a) * r).toFixed(1)} ${(32 + Math.sin(a) * r).toFixed(1)}`;
  }
  return d + 'Z';
}

/** 云朵外形（云存档图标共用），里面留出画符号的地方 */
const INK_C = '#2a1608';
const INK = `stroke="${INK_C}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
const CLOUD = 'M17 50H47C54 50 59 45 59 38C59 31 54 26 47 26C45 17 39 11 31 11C22 11 15 18 15 27C9 28 5 33 5 39C5 45 10 50 17 50Z';

/** 每个图标的内容；s=描边属性，fl=填充色 */
function body(name: IconName, c: string): string {
  const s = `stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  const lite = `fill="${c}" fill-opacity=".22"`;
  switch (name) {
    case 'play':
      return `<rect x="10" y="22" width="26" height="34" rx="4" ${lite} ${s} transform="rotate(-10 23 39)"/>` +
        `<path d="M46 52V14M34 26L46 13L58 26" fill="none" ${s}/>`;
    case 'pass':
      return `<circle cx="32" cy="32" r="22" fill="none" ${s}/><path d="M17 47L47 17" ${s}/>`;
    case 'hint':
      return `<path d="M32 7C22 7 15 15 15 24C15 31 19 35 22 38C24 40 25 42 25 45H39C39 42 40 40 42 38C45 35 49 31 49 24C49 15 42 7 32 7Z" ${lite} ${s}/>` +
        `<path d="M25 52H39M28 58H36" fill="none" ${s}/><path d="M26 22Q27 16 32 15" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`;
    case 'sort':
      return `<rect x="8" y="22" width="13" height="20" rx="3" ${lite} ${s}/><rect x="25.5" y="16" width="13" height="26" rx="3" ${lite} ${s}/><rect x="43" y="8" width="13" height="34" rx="3" ${lite} ${s}/>` +
        `<path d="M8 54H54M46 47L54 54L46 61" fill="none" ${s}/>`;
    case 'undo':
      return `<path d="M16 24H38C46 24 52 30 52 38C52 46 46 52 38 52H22" fill="none" ${s}/><path d="M26 13L15 24L26 35" fill="none" ${s}/>`;
    case 'settings':
      return `<path d="${gear()}" ${lite} ${s}/><circle cx="32" cy="32" r="8" fill="none" ${s}/>`;
    case 'rules':
      return `<path d="M32 16C25 11 15 10 7 12V51C15 49 25 50 32 55C39 50 49 49 57 51V12C49 10 39 11 32 16Z" ${lite} ${s}/><path d="M32 16V55" ${s}/>` +
        `<path d="M15 22Q20 21 25 23M15 31Q20 30 25 32M39 23Q44 21 49 22M39 32Q44 30 49 31" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    case 'sound':
      return `<path d="M8 25H18L31 13V51L18 39H8Z" fill="${c}" ${s}/><path d="M40 24Q45 32 40 40M47 16Q58 32 47 48" fill="none" ${s}/>`;
    case 'mute':
      return `<path d="M8 25H18L31 13V51L18 39H8Z" fill="${c}" ${s}/><path d="M41 24L56 40M56 24L41 40" fill="none" ${s}/>`;
    case 'back':
      return `<path d="M28 13L9 32L28 51M11 32H55" fill="none" ${s}/>`;
    case 'stats':
      return `<path d="M18 9H46V24C46 32 40 38 32 38C24 38 18 32 18 24Z" ${lite} ${s}/>` +
        `<path d="M18 14H9C9 22 13 27 19 28M46 14H55C55 22 51 27 45 28M32 38V48M21 55H43M24 48H40" fill="none" ${s}/>`;
    case 'chat':
      return `<path d="M12 12H52C55 12 57 14 57 17V40C57 43 55 45 52 45H28L16 55V45H12C9 45 7 43 7 40V17C7 14 9 12 12 12Z" ${lite} ${s}/>` +
        `<circle cx="21" cy="29" r="3.5" fill="${c}"/><circle cx="32" cy="29" r="3.5" fill="${c}"/><circle cx="43" cy="29" r="3.5" fill="${c}"/>`;
    // 互动（0.11.0）：笑脸
    case 'smile':
      return `<circle cx="32" cy="32" r="24" ${lite} ${s}/><circle cx="23" cy="27" r="3.5" fill="${c}"/><circle cx="41" cy="27" r="3.5" fill="${c}"/>` +
        `<path d="M20 37Q32 49 44 37" fill="none" ${s}/>`;
    // 叫朋友来：一个人加一个加号
    case 'share':
      // 分享：三个点连两条线
      return `<path d="M22 32L42 18M22 32L42 46" fill="none" ${s}/><circle cx="18" cy="32" r="8" ${lite} ${s}/><circle cx="46" cy="16" r="8" ${lite} ${s}/><circle cx="46" cy="48" r="8" ${lite} ${s}/>`;
    case 'invite':
      return `<circle cx="24" cy="21" r="10" ${lite} ${s}/><path d="M7 54C7 43 14 36 24 36C34 36 41 43 41 54Z" ${lite} ${s}/>` +
        `<path d="M50 20V40M40 30H60" fill="none" ${s}/>`;
    case 'home':
      return `<path d="M14 28V55H50V28" ${lite} ${s}/><path d="M7 31L32 10L57 31" fill="none" ${s}/><path d="M27 55V41H37V55" fill="none" ${s}/>`;
    case 'close':
      return `<path d="M16 16L48 48M48 16L16 48" ${s}/>`;
    case 'check':
      return `<path d="M11 34L26 49L53 17" fill="none" ${s}/>`;
    case 'crown':
      return `<path d="M8 20L20 36L32 13L44 36L56 20L51 49H13Z" ${lite} ${s}/><path d="M13 56H51" ${s}/>` +
        `<circle cx="8" cy="18" r="3.5" fill="${c}"/><circle cx="32" cy="11" r="3.5" fill="${c}"/><circle cx="56" cy="18" r="3.5" fill="${c}"/>`;
    case 'bomb':
      return `<circle cx="27" cy="39" r="18" fill="${c}" ${s}/><path d="M37 25L42 20" ${s}/><path d="M42 20Q46 12 53 13" fill="none" ${s}/>` +
        `<path d="M55 4V8M55 18V22M46 13H50M60 13H64M49 7L51.5 9.5M58.5 16.5L61 19M61 7L58.5 9.5" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="M17 35Q19 29 25 27" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="4" stroke-linecap="round"/>`;
    case 'cards':
      return `<rect x="8" y="14" width="28" height="38" rx="4" fill="none" ${s} transform="rotate(-12 22 33)"/>` +
        `<rect x="26" y="12" width="28" height="38" rx="4" ${lite} ${s} transform="rotate(8 40 31)"/>` +
        `<path d="M40 24C44 29 47 31 47 34C47 37 43 38 41 35C41 38 42 40 44 41H36C38 40 39 38 39 35C37 38 33 37 33 34C33 31 36 29 40 24Z" fill="${c}" transform="rotate(8 40 31)"/>`;
    case 'robot':
      return `<rect x="12" y="20" width="40" height="32" rx="9" ${lite} ${s}/><path d="M32 20V11M12 31H6V41H12M52 31H58V41H52M25 44H39" fill="none" ${s}/>` +
        `<circle cx="32" cy="9" r="4" fill="${c}"/><circle cx="24" cy="34" r="4.5" fill="${c}"/><circle cx="40" cy="34" r="4.5" fill="${c}"/>`;
    case 'speed':
      return `<path d="M8 15L29 32L8 49Z" fill="${c}" ${s}/><path d="M33 15L54 32L33 49Z" fill="${c}" ${s}/>`;
    // 云存档：实心云朵 + 深色粗符号（图标整体会按状态染色，深色不受染色影响，手机上小也分得清）
    case 'cloudOff':
      return `<path d="${CLOUD}" fill="none" ${s} stroke-dasharray="7 6"/><path d="M12 58L52 8" ${s}/>`;
    case 'cloudCheck':
      return `<path d="${CLOUD}" fill="${c}" ${s}/><path d="M19 33L28 42L45 24" fill="none" ${INK}/>`;
    case 'cloudSync':
      return `<path d="${CLOUD}" fill="${c}" ${s}/><circle cx="20" cy="35" r="5" fill="${INK_C}"/><circle cx="32" cy="35" r="5" fill="${INK_C}"/><circle cx="44" cy="35" r="5" fill="${INK_C}"/>`;
    case 'cloudUp':
      return `<path d="${CLOUD}" fill="${c}" ${s}/><path d="M32 46V22M22 32L32 21L42 32" fill="none" ${INK}/>`;
    case 'cloudMerge':
      return `<path d="${CLOUD}" fill="${c}" ${s}/><path d="M20 20L32 32L44 20M32 32V46" fill="none" ${INK}/>`;
    case 'restart':
      return `<path d="M51 34C51 45 42 53 32 53C21 53 13 44 13 33C13 22 22 13 32 13C38 13 43 15 47 20" fill="none" ${s}/><path d="M49 8V21H36" fill="none" ${s}/>`;
  }
}

/** 图标，默认奶白 #fff7e6 */
export function iconSvg(name: IconName, color = '#fff7e6'): string {
  return svg(64, 64, body(name, color));
}
