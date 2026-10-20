// 测试站点的兜底 Worker：静态资源没有的路径落到这里
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/via-assets') return env.ASSETS.fetch(new Request(new URL('/about', url), request));
    return new Response(`worker ${url.pathname}`, { headers: { 'x-from': 'worker' } });
  },
};
