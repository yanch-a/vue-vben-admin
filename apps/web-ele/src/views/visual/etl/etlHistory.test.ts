/**
 * ETL 撤销 / 重做历史测试。
 *
 * @author yanch
 */
import type { EtlWorkspaceDocument } from '#/api/visual/etl';

import { describe, expect, it } from 'vitest';

import { createEtlHistory, etlHistorySnapshot } from './etlHistory';
import { createFlexibleExamplePipeline } from './etlOperators';

function doc(count = 2): EtlWorkspaceDocument {
  return {
    formatVersion: '1.0',
    workspace: { id: 'w', name: 'w' },
    resources: {},
    pipelines: Array.from({ length: count }, (_, index) => createFlexibleExamplePipeline(`p${index}`)),
  } as EtlWorkspaceDocument;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('createEtlHistory', () => {
  it('提交、撤销、重做按顺序恢复文档', () => {
    const history = createEtlHistory();
    const value = doc();
    history.reset(value);
    expect(history.canUndo()).toBe(false);
    value.pipelines[0]!.name = 'A';
    expect(history.commit(value)).toBe(true);
    value.pipelines[0]!.name = 'B';
    history.commit(value);
    expect(history.undo()!.pipelines[0]!.name).toBe('A');
    expect(history.undo()!.pipelines[0]!.name).toBe(doc().pipelines[0]!.name);
    expect(history.undo()).toBeNull();
    expect(history.redo()!.pipelines[0]!.name).toBe('A');
    expect(history.redo()!.pipelines[0]!.name).toBe('B');
    expect(history.redo()).toBeNull();
  });

  it('内容没变不记录；撤销后的新修改截断重做分支', () => {
    const history = createEtlHistory();
    const value = doc();
    history.reset(value);
    expect(history.commit(clone(value))).toBe(false);
    value.pipelines[0]!.name = 'A';
    history.commit(value);
    value.pipelines[0]!.name = 'B';
    history.commit(value);
    const undone = history.undo()!;
    expect(history.canRedo()).toBe(true);
    undone.pipelines[1]!.name = 'C';
    history.commit(undone);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()!.pipelines[0]!.name).toBe('A');
    expect(history.size()).toEqual({ undo: 1, redo: 1 });
  });

  it('同一会话 key 合并成一步，换 key 或撤销后重新开始', () => {
    const history = createEtlHistory();
    const value = doc();
    history.reset(value);
    for (const name of ['a', 'ab', 'abc']) {
      value.pipelines[0]!.name = name;
      history.commit(value, 'drawer-1');
    }
    expect(history.size().undo).toBe(1);
    value.pipelines[0]!.name = 'x';
    history.commit(value, 'drawer-2');
    expect(history.size().undo).toBe(2);
    expect(history.undo()!.pipelines[0]!.name).toBe('abc');
    const restored = history.undo()!;
    expect(restored.pipelines[0]!.name).toBe(doc().pipelines[0]!.name);
    restored.pipelines[0]!.name = 'y';
    history.commit(restored, 'drawer-2');
    restored.pipelines[0]!.name = 'yz';
    history.commit(restored, 'drawer-2');
    expect(history.size()).toEqual({ undo: 1, redo: 0 });
  });

  it('最多保留 limit 步，最早的步骤被丢弃', () => {
    const history = createEtlHistory(5);
    const value = doc(1);
    history.reset(value);
    for (let i = 0; i < 12; i++) {
      value.pipelines[0]!.name = `n${i}`;
      history.commit(value);
    }
    expect(history.size().undo).toBe(5);
    let last: EtlWorkspaceDocument | null = null;
    while (history.canUndo()) last = history.undo();
    expect(last!.pipelines[0]!.name).toBe('n6');
  });

  it('reset 清空历史；没有起点时第一次提交只作为起点', () => {
    const history = createEtlHistory();
    const value = doc();
    expect(history.commit(value)).toBe(false);
    value.pipelines[0]!.name = 'A';
    history.commit(value);
    history.reset(value);
    expect(history.size()).toEqual({ undo: 0, redo: 0 });
  });

  it('撤销得到的是新对象，修改它不会影响历史', () => {
    const history = createEtlHistory();
    const value = doc();
    history.reset(value);
    value.pipelines[0]!.name = 'A';
    history.commit(value);
    const undone = history.undo()!;
    undone.pipelines[0]!.name = 'mutated';
    expect(history.redo()!.pipelines[0]!.name).toBe('A');
    expect(history.undo()!.pipelines[0]!.name).not.toBe('mutated');
  });
});

describe('etlHistorySnapshot', () => {
  it('没变的任务复用上一步的字符串（结构共享），任务顺序变化也能复用', () => {
    const value = doc(200);
    const first = etlHistorySnapshot(value);
    value.pipelines[3]!.name = 'changed';
    value.pipelines.reverse();
    const second = etlHistorySnapshot(value, first);
    const shared = second.pipelines.filter((item) => first.pipelines.includes(item)).length;
    expect(shared).toBe(199);
    expect(second.meta).toBe(first.meta);
  });
});