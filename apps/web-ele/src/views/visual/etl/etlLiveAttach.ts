/**
 * 进入工作区时挂接进行中运行的选取与取消权限，供旁观者实时日志使用。
 *
 * 覆盖：单任务运行、全部运行、发布预检（pipelineId=__publish__）、定时触发产生的 EtlRun。
 *
 * @author yanch
 */

import { isTerminalRunStatus } from './etlRunBatch';

/** 运行/查询一致：未结束的常见状态 */
export const ETL_ACTIVE_RUN_STATUSES = ['PENDING', 'RUNNING', 'VALIDATING'] as const;

export type EtlActiveRunStatus = (typeof ETL_ACTIVE_RUN_STATUSES)[number];

export interface EtlAttachableRun {
  id: string;
  pipelineId?: string;
  pipelineName?: string;
  status?: string;
  startedAt?: number;
  userId?: number | string;
}

export function isActiveEtlRunStatus(status?: string): boolean {
  return !isTerminalRunStatus(status);
}

/**
 * 从工作区运行列表挑一条旁观者应挂上的进行中运行。
 *
 * 优先级（同工作区并发 ≤ 3 路，定时只占一路；底部实时日志单一）：
 * 1. RUNNING / VALIDATING 高于 PENDING（真正干活优先）
 * 2. 发布预检 __publish__ 高于普通任务（发布更短也更需要看见进度）
 * 3. startedAt 最新的优先（定时触发、全部运行当前那一条更贴近）
 * 4. id 字典序兜底，保证平局稳定
 */
export function pickActiveEtlRun<T extends EtlAttachableRun>(
  runs: T[] | null | undefined,
): T | undefined {
  const active = (runs || []).filter((run) => isActiveEtlRunStatus(run?.status));
  if (!active.length) return undefined;
  const rank = (run: EtlAttachableRun) => {
    const status = String(run.status || '');
    const runningRank = status === 'PENDING' ? 0 : 1;
    const publishRank = run.pipelineId === '__publish__' ? 1 : 0;
    const started = Number(run.startedAt) || 0;
    return { runningRank, publishRank, started, id: String(run.id || '') };
  };
  return [...active].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    if (left.runningRank !== right.runningRank) return right.runningRank - left.runningRank;
    if (left.publishRank !== right.publishRank) return right.publishRank - left.publishRank;
    if (left.started !== right.started) return right.started - left.started;
    return right.id.localeCompare(left.id);
  })[0];
}

/**
 * 对齐 EtlWorkflowService.cancel 口径：
 * 工作区所有者或该次运行发起人可取消；只读/协作编辑旁观者只能看日志。
 */
export function canCancelEtlRun(options: {
  run?: Pick<EtlAttachableRun, 'userId'> | null;
  currentUserId?: number | string | null;
  isWorkspaceOwner?: boolean;
}): boolean {
  if (options.isWorkspaceOwner) return true;
  const runUser = options.run?.userId;
  const me = options.currentUserId;
  if (runUser == null || me == null || me === '') return false;
  return String(runUser) === String(me);
}

/** 旁观者轮询：已挂上活跃运行时不必每次 listRuns，隔 N 次再发现更高优先级/定时新跑。 */
export const ETL_LIVE_DISCOVER_EVERY = 4;

/**
 * 是否在本轮实时轮询里打 listRuns。
 * force / 当前没有活跃挂载 → 必须发现；否则累加 tick，满 discoverEvery 再拉列表。
 */
export function nextEtlLiveDiscoverTick(options: {
  forceList?: boolean;
  liveActive: boolean;
  discoverTick: number;
  discoverEvery?: number;
}): { discover: boolean; nextTick: number } {
  const every = Math.max(1, options.discoverEvery ?? ETL_LIVE_DISCOVER_EVERY);
  if (options.forceList || !options.liveActive) {
    return { discover: true, nextTick: 0 };
  }
  const tick = Math.max(0, options.discoverTick) + 1;
  if (tick >= every) return { discover: true, nextTick: 0 };
  return { discover: false, nextTick: tick };
}
