import { describe, expect, it } from 'vitest';
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  normalizeDisplayName,
  normalizePassword,
  normalizeUsername,
  RESERVED_PERSONAS,
} from '../worker/api/validate';
import { GAME_IDS } from '../src/games';

describe('用户名', () => {
  it('NFKC 后转小写，3–20 位小写字母、数字、下划线', () => {
    expect(normalizeUsername('Ａｌｉｃｅ_01')).toBe('alice_01');
    expect(checkUsername('alice_01')).toBe('ok');
    expect(checkUsername('ab')).toBe('invalid_username');
    expect(checkUsername('a'.repeat(21))).toBe('invalid_username');
    expect(checkUsername('alice-01')).toBe('invalid_username');
    expect(checkUsername('张三abc')).toBe('invalid_username');
  });

  it('保留名不能注册；games.ts 登记的游戏 id 都保留', () => {
    expect(checkUsername('admin')).toBe('invalid_username');
    for (const id of GAME_IDS) expect(checkUsername(id), id).toBe('invalid_username');
  });
});

describe('密码', () => {
  it('长度按码点数 8–128', () => {
    expect(checkPassword('Abcdef1!', 'bob')).toBe('ok');
    expect(checkPassword('Abcdef1', 'bob')).toBe('weak_password');
    expect(checkPassword('密码密码密码密码', 'bob')).toBe('ok');
    expect(checkPassword('x'.repeat(129), 'bob')).toBe('weak_password');
  });

  it('常见弱密码、和用户名相同的都拒绝（不分大小写）', () => {
    expect(checkPassword('woaini1314', 'bob')).toBe('weak_password');
    expect(checkPassword('PASSWORD', 'bob')).toBe('weak_password');
    expect(checkPassword('alice_2026', 'alice_2026')).toBe('weak_password');
  });

  it('NFKC：全角和半角是同一个密码；空格保留', () => {
    expect(normalizePassword('Ａｂｃ１２３４５')).toBe('Abc12345');
    expect(normalizePassword(' a b ')).toBe(' a b ');
  });
});

describe('昵称', () => {
  it('去首尾空白、合并连续空白，2–12 个字', () => {
    expect(normalizeDisplayName('  小  明  ')).toBe('小 明');
    expect(checkDisplayName('小明')).toBe('ok');
    expect(checkDisplayName('明')).toBe('invalid_display_name');
    expect(checkDisplayName('一二三四五六七八九十一二三')).toBe('invalid_display_name');
  });

  it('控制字符、零宽字符不许', () => {
    expect(checkDisplayName('小​明')).toBe('invalid_display_name');
    expect(checkDisplayName('小\u0007明')).toBe('invalid_display_name');
  });

  it('电脑人物名、加数字、加符号的都不许；含"电脑""官方"的也不许', () => {
    for (const n of ['老张', '小美2', '阿 强', '老王！', '张姐123', '电脑小王', '官方客服']) {
      expect(checkDisplayName(normalizeDisplayName(n))).toBe('reserved_display_name');
    }
    expect(checkDisplayName('小美丽')).toBe('ok');
  });

  it('电脑人物名繁简、大小写归一，去掉空白、符号、数字、拉丁字母后整名相等才拦（0.13.0）', () => {
    for (const n of ['老张a', '老张A', '老張', '老 张', '老张1', '老張B2', 'a老张', '阿強', 'x熊貓哥', '刹車王', '電腦', '管理員']) {
      expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('reserved_display_name');
    }
    for (const n of ['小美丽', '张三', '老李', '小王子', '我是老趙', 'Alice']) expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('ok');
  });

  it('德州扑克的 6 个电脑名字：原样、加数字、加空格符号都不许；只是包含它们的长名字照常可用', () => {
    for (const n of ['稳哥', '阿飙', '老好', '慢慢', '算盘', '江湖', '稳哥2', '阿 飙', '江湖！', '算盘007']) {
      expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('reserved_display_name');
    }
    for (const n of ['慢慢来', '江湖老王子', '小算盘']) expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('ok');
  });

  it('德州 0.2.0 新加的 4 个电脑名字（虎子、老鹰、叨叨、小白）也拦；只是包含它们的长名字照常可用', () => {
    for (const n of ['虎子', '老鹰', '叨叨', '小白', '小白1', '虎 子', '老鹰！']) {
      expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('reserved_display_name');
    }
    for (const n of ['小白兔', '虎子哥哥', '老鹰捉小鸡']) expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('ok');
  });

  it('弹里个弹的电脑名字（团团、企企、柴柴、兔兔、鼠鼠、橘子）也拦，繁体"團團"同样拦；团子照常能用', () => {
    for (const n of ['团团', '團團', '橘子', '鼠鼠2', '柴 柴']) {
      expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('reserved_display_name');
    }
    expect(checkDisplayName(normalizeDisplayName('团子'))).toBe('ok');
  });

  it('电脑名字按游戏分组：games.ts 登记的每个游戏都有一组（没有电脑就空数组），不多不少', () => {
    expect(Object.keys(RESERVED_PERSONAS).sort()).toEqual([...GAME_IDS].sort());
    for (const n of Object.values(RESERVED_PERSONAS).flat()) expect(checkDisplayName(normalizeDisplayName(n)), n).toBe('reserved_display_name');
  });

  it('骂人话不许', () => {
    expect(checkDisplayName('你是傻逼')).toBe('invalid_display_name');
    expect(checkDisplayName('F-U-C-K')).toBe('invalid_display_name');
  });
});
