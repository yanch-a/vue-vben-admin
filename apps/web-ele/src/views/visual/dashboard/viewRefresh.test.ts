/** 大屏查看页自动刷新间隔优先级测试。@author yanch */
import { describe, expect, it } from 'vitest';

import { resolveViewRefreshSeconds } from './viewRefresh';

describe('resolveViewRefreshSeconds', () => {
  it('实时模式未配置时默认关闭', () => {
    expect(resolveViewRefreshSeconds({ refreshMode: 'LIVE' })).toBe(0);
  });

  it('快照模式跟随后台快照间隔，缺省 300 秒', () => {
    expect(resolveViewRefreshSeconds({ refreshMode: 'INTERVAL_SNAPSHOT', snapshotIntervalSeconds: 120 })).toBe(120);
    expect(resolveViewRefreshSeconds({ refreshMode: 'INTERVAL_SNAPSHOT' })).toBe(300);
  });

  it('大屏配置优先于模式默认值，0 表示关闭', () => {
    expect(resolveViewRefreshSeconds({ refreshMode: 'LIVE', viewRefreshSeconds: 60 })).toBe(60);
    expect(resolveViewRefreshSeconds({ refreshMode: 'INTERVAL_SNAPSHOT', viewRefreshSeconds: 0 })).toBe(0);
  });

  it('URL 参数优先级最高，并夹在 10 秒到 1 天之间', () => {
    expect(resolveViewRefreshSeconds({ queryOverride: '30', viewRefreshSeconds: 60 })).toBe(30);
    expect(resolveViewRefreshSeconds({ queryOverride: 'off', viewRefreshSeconds: 60 })).toBe(0);
    expect(resolveViewRefreshSeconds({ queryOverride: '3' })).toBe(10);
    expect(resolveViewRefreshSeconds({ queryOverride: '999999' })).toBe(86_400);
    expect(resolveViewRefreshSeconds({ queryOverride: 'abc', viewRefreshSeconds: 45 })).toBe(45);
  });
});
