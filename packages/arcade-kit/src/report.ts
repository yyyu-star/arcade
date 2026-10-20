/**
 * 浏览器错误上报（0.22.0）：把页面里没人接住的报错发给平台，线上出问题时不用靠玩家描述。
 * 只发排查要用的几项（报错文字、调用栈、页面路径、游戏和版本），不带账号、昵称、cookie 和地址里的参数：
 * 平台本来就认得 cookie 对应的人，报错内容里不需要再有任何能认出人的东西。
 */

export interface ReportOptions {
  /** 游戏 id，和 Worker 名一致 */
  game: string;
  /** 游戏当前版本 */
  version: string;
  /** 平台接口，默认 `/api/client-error`（同域） */
  endpoint?: string;
}

/** 一页最多报几条：一个循环里的报错不能把平台打满 */
const MAX_PER_PAGE = 5;
const MSG_MAX = 200;
const STACK_MAX = 1000;
/** 去重只看开头：后面常带变化的数字或 id，同一个错会被当成不同的 */
const SIGN_LEN = 80;

/** 挂上全局报错监听，返回卸载函数；没有 window（服务端渲染、测试）时什么也不做 */
export function reportErrors(opts: ReportOptions): () => void {
  if (typeof window === 'undefined') return () => {};
  const endpoint = opts.endpoint ?? '/api/client-error';
  const seen = new Set<string>();
  let sent = 0;

  const report = (msg: string, stack: string): void => {
    // 跨域脚本的报错浏览器只给 "Script error."，没有信息量；扩展注入的脚本出错也不是我们的问题
    if (msg === 'Script error.' || /(chrome|moz)-extension:\/\//.test(stack)) return;
    const sign = msg.slice(0, SIGN_LEN);
    if (seen.has(sign) || sent >= MAX_PER_PAGE) return;
    seen.add(sign);
    sent++;
    const body = JSON.stringify({
      game: opts.game,
      ver: opts.version,
      msg,
      stack,
      // 只取路径：query 和 hash 里可能有房间码、邀请码
      path: location.pathname,
    });
    // 失败一律吞掉：上报本身不能再制造报错，也不重试
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      } else {
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => {});
      }
    } catch {
      /* 吞掉 */
    }
  };

  const onError = (e: ErrorEvent): void => {
    const err: unknown = e.error;
    const msg = err instanceof Error ? err.message : (e.message ?? String(err));
    report(String(msg).slice(0, MSG_MAX), (err instanceof Error ? err.stack ?? '' : '').slice(0, STACK_MAX));
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const r: unknown = e.reason;
    const msg = r instanceof Error ? r.message : String(r);
    report(msg.slice(0, MSG_MAX), (r instanceof Error ? r.stack ?? '' : '').slice(0, STACK_MAX));
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
