import { describe, expect, it } from 'vitest';

import { createEtlHistory } from './etlHistory';
import { createEtlWorkspaceSessionCache, ETL_SESSION_LIMIT, trimEtlSessionPreviews } from './etlWorkspaceSession';

interface State { doc: string; remoteRevision: number }

describe('工作区会话缓存', () => {
  it('按工作区 ID 保存，字符串 / 数字 ID 视为同一个', () => {
    const cache = createEtlWorkspaceSessionCache<State>();
    cache.set(1, { doc: 'a', remoteRevision: 3 });
    cache.set('2', { doc: 'b', remoteRevision: 1 });
    expect(cache.get('1')?.doc).toBe('a');
    expect(cache.has(2)).toBe(true);
  });

  it('revision 未变时完整复用，变了只返回状态供恢复界面位置', () => {
    const cache = createEtlWorkspaceSessionCache<State>();
    cache.set(1, { doc: 'dirty', remoteRevision: 3 });
    expect(cache.take(1, 3)).toEqual({ full: true, state: { doc: 'dirty', remoteRevision: 3 } });
    expect(cache.has(1)).toBe(false);
    cache.set(1, { doc: 'dirty', remoteRevision: 3 });
    expect(cache.take('1', 4)?.full).toBe(false);
    expect(cache.take(9, 0)).toBeUndefined();
  });

  it('超过上限淘汰最久未使用的工作区', () => {
    const cache = createEtlWorkspaceSessionCache<State>(2);
    cache.set(1, { doc: 'a', remoteRevision: 0 });
    cache.set(2, { doc: 'b', remoteRevision: 0 });
    cache.set(1, { doc: 'a2', remoteRevision: 0 });
    cache.set(3, { doc: 'c', remoteRevision: 0 });
    expect(cache.keys()).toEqual(['1', '3']);
    cache.delete(1);
    cache.clear();
    expect(cache.keys()).toEqual([]);
  });

  it('默认最多缓存 10 个工作区', () => {
    expect(ETL_SESSION_LIMIT).toBe(10);
    const cache = createEtlWorkspaceSessionCache<State>();
    for (let i = 0; i < 12; i++) cache.set(i, { doc: String(i), remoteRevision: 0 });
    expect(cache.keys()).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });

  it('大预览结果不进缓存，小结果保留', () => {
    const small = { columns: ['a'], rows: [{ a: 1 }] };
    const big = { columns: ['a', 'b'], rows: Array.from({ length: 3000 }, () => ({})) };
    const trimmed = trimEtlSessionPreviews({ big, small });
    expect(Object.keys(trimmed)).toEqual(['small']);
    expect(trimmed.small).toBe(small);
  });

  it('撤销历史裁剪到最近 N 步，仍能撤销最近的修改', () => {
    const history = createEtlHistory();
    const doc = (n: number) => ({ pipelines: [{ id: 'p', name: String(n), nodes: [] }] }) as any;
    history.reset(doc(0));
    for (let i = 1; i <= 30; i++) history.commit(doc(i));
    history.undo();
    history.trim(20);
    expect(history.size()).toEqual({ undo: 20, redo: 1 });
    expect(history.undo()?.pipelines[0]?.name).toBe('28');
  });
});
