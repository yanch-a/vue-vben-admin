/**
 * ETL 全部任务顺序运行：筛选启用任务、日志打任务标签、汇总批次状态。
 * 采用顺序执行（与定时批次一致），避免连接池争用与「同工作区最多 3 路」上限。
 *
 * @author yanch
 */

export interface EtlBatchTaskRef {
  id: string;
  name: string;
  enabled?: boolean;
}

export type EtlBatchItemStatus =
  | 'CANCELLED'
  | 'FAILED'
  | 'PENDING'
  | 'RUNNING'
  | 'SKIPPED'
  | 'SUCCESS';

export interface EtlBatchItem {
  pipelineId: string;
  pipelineName: string;
  runId?: string;
  status: EtlBatchItemStatus;
  message?: string;
}

/** 按工作区定义顺序取启用任务；停用任务不进入批次。 */
export function listEnabledBatchTasks<T extends EtlBatchTaskRef>(tasks: T[]): T[] {
  return tasks.filter((task) => task.enabled !== false);
}

export function isTerminalRunStatus(status?: string) {
  return !status || !['PENDING', 'RUNNING', 'VALIDATING'].includes(status);
}

/** 给实时日志打上任务名，多任务混流时仍能分清归属。 */
export function tagBatchLogLine<T extends Record<string, unknown>>(
  line: T,
  task: Pick<EtlBatchTaskRef, 'id' | 'name'>,
  runId: string,
) {
  return {
    ...line,
    pipelineId: task.id,
    pipelineName: task.name,
    runId,
    batchKey: `${runId}:${String(line.id ?? '')}`,
  };
}

export function formatBatchLogPrefix(pipelineName?: string) {
  const name = String(pipelineName || '').trim();
  return name ? `[${name}]` : '';
}

export function summarizeBatch(items: EtlBatchItem[]) {
  const total = items.length;
  let success = 0;
  let failed = 0;
  let cancelled = 0;
  let skipped = 0;
  let running: EtlBatchItem | undefined;
  let done = 0;
  for (const item of items) {
    if (item.status === 'SUCCESS') {
      success += 1;
      done += 1;
    } else if (item.status === 'FAILED') {
      failed += 1;
      done += 1;
    } else if (item.status === 'CANCELLED') {
      cancelled += 1;
      done += 1;
    } else if (item.status === 'SKIPPED') {
      skipped += 1;
      done += 1;
    } else if (item.status === 'RUNNING' || item.status === 'PENDING') {
      if (!running) running = item;
    }
  }
  const finished = total === 0 || done >= total;
  let headline: string;
  if (!total) headline = '没有可运行的启用任务';
  else if (running)
    headline = `${done}/${total} · 当前：${running.pipelineName}`;
  else if (failed)
    headline = `${done}/${total} · 成功 ${success} · 失败 ${failed}`;
  else if (cancelled)
    headline = `${done}/${total} · 已取消`;
  else if (finished) headline = `${total}/${total} · 全部成功`;
  else headline = `${done}/${total}`;
  return {
    total,
    done,
    success,
    failed,
    cancelled,
    skipped,
    running,
    headline,
    finished,
  };
}

/**
 * 顺序跑完启用任务。某一任务失败或用户取消后，剩余任务标记为跳过，不再提交。
 * runOne 负责真正调后端；本函数只管游标与中断策略。
 */
export async function runBatchSequentially<T>(options: {
  tasks: EtlBatchTaskRef[];
  isCancelRequested: () => boolean;
  shouldContinue: () => boolean;
  runOne: (task: EtlBatchTaskRef, index: number) => Promise<T>;
  onItemStart?: (task: EtlBatchTaskRef, index: number) => void;
  onItemDone?: (
    task: EtlBatchTaskRef,
    index: number,
    result: { ok: false; error: unknown } | { ok: true; value: T },
  ) => void;
  onSkipRemaining?: (
    task: EtlBatchTaskRef,
    index: number,
    reason: 'cancel' | 'failed',
  ) => void;
}): Promise<{
  started: number;
  cancelled: boolean;
  failed: boolean;
  results: T[];
}> {
  const results: T[] = [];
  let cancelled = false;
  let failed = false;
  let started = 0;
  for (let index = 0; index < options.tasks.length; index += 1) {
    const task = options.tasks[index]!;
    if (!options.shouldContinue()) {
      cancelled = true;
      for (let rest = index; rest < options.tasks.length; rest += 1) {
        options.onSkipRemaining?.(options.tasks[rest]!, rest, 'cancel');
      }
      break;
    }
    if (options.isCancelRequested()) {
      cancelled = true;
      for (let rest = index; rest < options.tasks.length; rest += 1) {
        options.onSkipRemaining?.(options.tasks[rest]!, rest, 'cancel');
      }
      break;
    }
    options.onItemStart?.(task, index);
    started += 1;
    try {
      const value = await options.runOne(task, index);
      results.push(value);
      options.onItemDone?.(task, index, { ok: true, value });
    } catch (error) {
      failed = true;
      options.onItemDone?.(task, index, { ok: false, error });
      for (let rest = index + 1; rest < options.tasks.length; rest += 1) {
        options.onSkipRemaining?.(options.tasks[rest]!, rest, 'failed');
      }
      break;
    }
    if (options.isCancelRequested()) {
      cancelled = true;
      for (let rest = index + 1; rest < options.tasks.length; rest += 1) {
        options.onSkipRemaining?.(options.tasks[rest]!, rest, 'cancel');
      }
      break;
    }
  }
  return { started, cancelled, failed, results };
}

/** 确认框文案：全部启用任务 + 事务边界说明。 */
export function buildRunAllConfirmMessage(
  enabledCount: number,
  disabledCount: number,
) {
  const skip =
    disabledCount > 0 ? `（已跳过 ${disabledCount} 个停用任务）` : '';
  return (
    `将运行全部 ${enabledCount} 个启用任务${skip}。` +
    '每个写入步骤单独提交事务；某个任务失败或取消后，已成功提交的任务不会回滚，后续未跑的任务会跳过。'
  );
}
