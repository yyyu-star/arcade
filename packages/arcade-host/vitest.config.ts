import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 每个文件起自己的 workerd，文件之间并行没问题；一个文件里的用例按顺序跑（共用一个站点）
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
