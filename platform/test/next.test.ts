/** 登录页 next 参数只认本站的游戏目录和平台自己的几页（0.10.1，src/next.ts 的 safeNext） */
import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/next';

const O = 'https://game.example.com';

describe('safeNext', () => {
  it('认：游戏目录带房间码、平台自己的页面', () => {
    expect(safeNext('/games/texas/?room=123456', O)).toBe('/games/texas/?room=123456');
    expect(safeNext('/games/guandan/?online=1&room=654321#x', O)).toBe('/games/guandan/?online=1&room=654321#x');
    for (const p of ['/', '/friends', '/f/ABCD2345', '/me', '/me/stats', '/wallet', '/boards', '/privacy', '/admin']) expect(safeNext(p, O), p).toBe(p);
  });

  it('不认：外站、//、反斜杠、协议、空白控制字符、太长、登录页、别的路径', () => {
    const bad = [
      null,
      '',
      'games/texas/',
      '//evil.com/games/x',
      '/\\evil.com',
      '/\\/evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      ' /games/texas/',
      'https://evil.com/games/texas/',
      'javascript:alert(1)',
      '/login?next=/games/texas/',
      '/forgot',
      '/api/me',
      '/games/',
      '/games/texas/' + 'x'.repeat(200),
    ];
    for (const p of bad) expect(safeNext(p, O), JSON.stringify(p)).toBeNull();
  });

  it('解析后再查一遍：../ 绕到别的路径不认，绕回平台页面的照常', () => {
    expect(safeNext('/games/../api/me', O)).toBeNull();
    expect(safeNext('/games/../friends', O)).toBe('/friends');
  });
});
