/**
 * 共用的小图标和小插画：都是手写的 SVG（不用 emoji：没装 emoji 字体的设备会显示成方框；也不用图标库和外站图片）。
 * 单独一个文件，大厅首屏不用把钱包页一起加载。颜色跟着 styles.css 的主题变量走，描边用 currentColor 的地方随文字颜色变。
 */

/** 金币图标 */
export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="coin" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#ffc83d" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#e58f12" strokeWidth="2" />
    </svg>
  );
}

/** 两个人：好友、好友房、"今天 N 人玩过" */
export function PeopleIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3.2" fill="currentColor" />
      <circle cx="16.5" cy="9" r="2.6" fill="currentColor" opacity="0.6" />
      <path d="M2.8 19.5c0-3.6 2.8-6 6.2-6s6.2 2.4 6.2 6z" fill="currentColor" />
      <path d="M14.6 13.9c.6-.2 1.2-.3 1.9-.3 2.8 0 4.8 2 4.8 5.1h-5.1c-.1-1.9-.7-3.5-1.6-4.8z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/** 奖杯：排行 */
export function TrophyIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M7 6H4.6a2.6 2.6 0 0 0 2.9 4.4M17 6h2.4a2.6 2.6 0 0 1-2.9 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 3.5h10v5a5 5 0 0 1-10 0z" fill="currentColor" />
      <path d="M11 13h2v4h-2z" fill="currentColor" />
      <rect x="7.5" y="17" width="9" height="3.5" rx="1" fill="currentColor" />
    </svg>
  );
}

/** 盾牌加勾：管理 */
export function ShieldIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M12 2.5l7.5 3v5.6c0 4.5-3.1 8.5-7.5 10.4-4.4-1.9-7.5-5.9-7.5-10.4V5.5z" fill="currentColor" />
      <path d="M8.4 12.2l2.5 2.5 4.8-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 大厅的标志：一台小街机（屏幕里一个像素小怪、摇杆和两个按钮） */
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg className="logo-mark" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="30" height="42" rx="6" fill="#f07a3a" stroke="#3a2b33" strokeWidth="3" />
      <rect x="13" y="7" width="22" height="6" rx="2" fill="#ffd257" stroke="#3a2b33" strokeWidth="2" />
      <rect x="13" y="15.5" width="22" height="15" rx="2" fill="#2b2140" stroke="#3a2b33" strokeWidth="2" />
      <path
        d="M19 18h2v2h-2zM27 18h2v2h-2zM17 20h14v2H17zM17 22h4v2h-4zM23 22h2v2h-2zM27 22h4v2h-4zM17 24h14v2H17zM19 26h2v2h-2zM27 26h2v2h-2z"
        fill="#7be0a0"
      />
      <rect x="11" y="33" width="26" height="8" rx="2" fill="#ffe3c4" stroke="#3a2b33" strokeWidth="2" />
      <path d="M18 37.5v-4" stroke="#3a2b33" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="33" r="2.6" fill="#e0463a" stroke="#3a2b33" strokeWidth="1.5" />
      <circle cx="27" cy="37" r="1.9" fill="#3fa7ff" stroke="#3a2b33" strokeWidth="1.2" />
      <circle cx="32" cy="37" r="1.9" fill="#ffd257" stroke="#3a2b33" strokeWidth="1.2" />
    </svg>
  );
}

/** 空列表的小插画：一张打了个哈欠的游戏票 */
export function EmptyArt() {
  return (
    <svg className="empty__art" viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false">
      <ellipse cx="48" cy="58" rx="30" ry="4" fill="#3a2b33" opacity="0.12" />
      <path
        d="M16 12h64a4 4 0 0 1 4 4v8a6 6 0 0 0 0 12v8a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4v-8a6 6 0 0 0 0-12v-8a4 4 0 0 1 4-4z"
        fill="#fff3d6"
        stroke="#3a2b33"
        strokeWidth="3"
      />
      <path d="M62 14v32" stroke="#3a2b33" strokeWidth="2" strokeDasharray="3 4" />
      <path d="M28 26q3-3 6 0M42 26q3-3 6 0" fill="none" stroke="#3a2b33" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="38" cy="36" rx="3.5" ry="4" fill="#3a2b33" />
      <circle cx="26" cy="33" r="2.5" fill="#f07a3a" opacity="0.45" />
      <circle cx="50" cy="33" r="2.5" fill="#f07a3a" opacity="0.45" />
      <path d="M70 24l4 0-4 6h4" fill="none" stroke="#b24c14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M76 14l3 0-3 4h3" fill="none" stroke="#b24c14" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

/** 喇叭：页脚的声音开关；关着时画一道斜线 */
export function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** 钥匙：登录、找回密码 */
export function KeyIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="8" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12.5 12H21M18 12v3.5M21 12v2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** 一个人：账号 */
export function UserIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20.5c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor" />
    </svg>
  );
}

/** 锁：账号安全、隐私 */
export function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor" />
      <circle cx="12" cy="15.5" r="1.7" fill="#fff" />
    </svg>
  );
}
