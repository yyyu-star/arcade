/** 钱包错误给玩家看的话（平台 15.10）：单机的 RPC、好友房、/api 三处说法不同（0.3.5） */
import { describe, expect, it } from 'vitest';
import { walletError } from '../src/net/wallet.ts';

describe('钱包错误的说法', () => {
  it('busy：单机说娱乐局照常玩；好友房里没有娱乐模式，不提；看钱包、领补给（/api）说先只能看、不能改', () => {
    expect(walletError('busy')).toContain('娱乐模式照常玩');
    expect(walletError('busy', undefined, 'room')).not.toContain('娱乐');
    expect(walletError('busy', undefined, 'api')).toBe('服务器今天有点忙，先只能看、不能改，明早恢复');
  });

  it('limit：好友房里不提娱乐模式，"桌上的照常结回"留着', () => {
    expect(walletError('limit', undefined, 'room')).toBe('今天开局太多了，明早 0 点恢复；桌上的照常结回');
    expect(walletError('limit')).toContain('娱乐模式照常玩');
  });
});
