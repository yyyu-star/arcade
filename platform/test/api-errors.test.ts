/**
 * 浏览器端接口封装（src/api.ts）遇到出错时给玩家看的话：登录、注册、找回这些表单都用 errorText 显示。
 * 429 不管回的是我们的 JSON 还是网关自己的页面，都说"太频繁"、写清多久后再试；别的非 2xx 和断网也都有一句话。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, errorText } from '../src/api';

function serve(res: () => Response) {
  vi.stubGlobal('fetch', async () => res());
}

async function loginError(): Promise<string> {
  try {
    await api.login('someone', 'password-123');
  } catch (e) {
    return errorText(e);
  }
  throw new Error('应该失败');
}

describe('出错提示', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('平台自己的 429：用服务端的说法，带上多久后再试', async () => {
    serve(() => Response.json({ error: 'rate_limited', message: '操作太频繁了，歇一会儿再试', retryAfter: 505 }, { status: 429 }));
    expect(await loginError()).toBe('操作太频繁了，歇一会儿再试（9 分钟后）');
  });

  it('网关的 429（不是 JSON）：说太频繁，不说连不上；Retry-After 是秒数或日期都认，看不懂就不写多久', async () => {
    serve(() => new Response('<html>rate limited</html>', { status: 429, headers: { 'retry-after': '30' } }));
    expect(await loginError()).toBe('试得太频繁了，稍等一会儿再来（30 秒后）');
    serve(() => new Response('<html>rate limited</html>', { status: 429, headers: { 'retry-after': new Date(Date.now() + 125_000).toUTCString() } }));
    expect(await loginError()).toMatch(/^试得太频繁了，稍等一会儿再来（(2|3) 分钟后）$/);
    serve(() => new Response('', { status: 429, headers: { 'retry-after': 'soon' } }));
    expect(await loginError()).toBe('试得太频繁了，稍等一会儿再来');
  });

  it('5xx、网关出错页、断网：都有一句话', async () => {
    serve(() => Response.json({ error: 'internal', message: '服务器出错了，过一会儿再试' }, { status: 500 }));
    expect(await loginError()).toBe('服务器出错了，过一会儿再试');
    serve(() => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await loginError()).toBe('连不上服务器，过一会儿再试');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await loginError()).toBe('网络不通，检查一下再试');
  });
});
