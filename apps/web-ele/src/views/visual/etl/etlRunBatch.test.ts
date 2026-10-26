import { describe, expect, it, vi } from 'vitest';

import {
  buildRunAllConfirmMessage,
  formatBatchLogPrefix,
  isTerminalRunStatus,
  listEnabledBatchTasks,
  runBatchSequentially,
  summarizeBatch,
  tagBatchLogLine,
} from './etlRunBatch';

describe('ETL 全部运行编排', () => {
  it('按定义顺序只取启用任务', () => {
    const tasks = listEnabledBatchTasks([
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: false },
      { id: 'c', name: 'C' },
    ]);
    expect(tasks.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('识别运行终态', () => {
    expect(isTerminalRunStatus('PENDING')).toBe(false);
    expect(isTerminalRunStatus('RUNNING')).toBe(false);
    expect(isTerminalRunStatus('VALIDATING')).toBe(false);
    expect(isTerminalRunStatus('SUCCESS')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('CANCELLED')).toBe(true);
  });

  it('日志带任务前缀与稳定 batchKey', () => {
    const tagged = tagBatchLogLine(
      { id: 'log1', message: 'ok' },
      { id: 'p1', name: '同步客户' },
      'run9',
    );
    expect(tagged.pipelineName).toBe('同步客户');
    expect(tagged.batchKey).toBe('run9:log1');
    expect(formatBatchLogPrefix('同步客户')).toBe('[同步客户]');
    expect(formatBatchLogPrefix('')).toBe('');
  });

  it('汇总批次进度文案', () => {
    const summary = summarizeBatch([
      {
        pipelineId: 'a',
        pipelineName: 'A',
        status: 'SUCCESS',
      },
      {
        pipelineId: 'b',
        pipelineName: 'B',
        status: 'RUNNING',
      },
      {
        pipelineId: 'c',
        pipelineName: 'C',
        status: 'PENDING',
      },
    ]);
    expect(summary.done).toBe(1);
    expect(summary.running?.pipelineId).toBe('b');
    expect(summary.headline).toContain('当前：B');
  });

  it('顺序执行；失败后跳过剩余', async () => {
    const skipped: string[] = [];
    const runOne = vi
      .fn()
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('boom'));
    const result = await runBatchSequentially({
      tasks: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      isCancelRequested: () => false,
      shouldContinue: () => true,
      runOne,
      onSkipRemaining: (task, _index, reason) => {
        skipped.push(`${task.id}:${reason}`);
      },
    });
    expect(result.started).toBe(2);
    expect(result.failed).toBe(true);
    expect(result.results).toEqual(['ok']);
    expect(skipped).toEqual(['c:failed']);
    expect(runOne).toHaveBeenCalledTimes(2);
  });

  it('取消后不再启动后续任务', async () => {
    let cancel = false;
    const skipped: string[] = [];
    const result = await runBatchSequentially({
      tasks: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      isCancelRequested: () => cancel,
      shouldContinue: () => true,
      runOne: async () => {
        cancel = true;
        return 'ok';
      },
      onSkipRemaining: (task, _index, reason) => {
        skipped.push(`${task.id}:${reason}`);
      },
    });
    expect(result.started).toBe(1);
    expect(result.cancelled).toBe(true);
    expect(skipped).toEqual(['b:cancel']);
  });

  it('确认文案说明全部启用与事务边界', () => {
    const text = buildRunAllConfirmMessage(3, 2);
    expect(text).toContain('全部 3 个启用任务');
    expect(text).toContain('跳过 2 个停用');
    expect(text).toContain('单独提交事务');
    expect(text).toContain('不会回滚');
  });
});
