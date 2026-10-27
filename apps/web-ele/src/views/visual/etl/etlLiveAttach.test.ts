/**
 * etlLiveAttach：旁观者挂接进行中运行与取消权限。
 */
import { describe, expect, it } from 'vitest';

import {
  canCancelEtlRun,
  isActiveEtlRunStatus,
  nextEtlLiveDiscoverTick,
  pickActiveEtlRun,
} from './etlLiveAttach';

describe('etlLiveAttach', () => {
  it('treats PENDING/RUNNING/VALIDATING as active', () => {
    expect(isActiveEtlRunStatus('PENDING')).toBe(true);
    expect(isActiveEtlRunStatus('RUNNING')).toBe(true);
    expect(isActiveEtlRunStatus('VALIDATING')).toBe(true);
    expect(isActiveEtlRunStatus('SUCCESS')).toBe(false);
    expect(isActiveEtlRunStatus('FAILED')).toBe(false);
    expect(isActiveEtlRunStatus('CANCELLED')).toBe(false);
  });

  it('prefers RUNNING over PENDING, then publish, then newest startedAt', () => {
    const picked = pickActiveEtlRun([
      {
        id: 'old-run',
        pipelineId: 'p1',
        pipelineName: '任务1',
        status: 'RUNNING',
        startedAt: 100,
      },
      {
        id: 'pending',
        pipelineId: 'p2',
        status: 'PENDING',
        startedAt: 999,
      },
      {
        id: 'newer-run',
        pipelineId: 'p3',
        status: 'RUNNING',
        startedAt: 200,
      },
      {
        id: 'done',
        pipelineId: 'p4',
        status: 'SUCCESS',
        startedAt: 500,
      },
    ]);
    expect(picked?.id).toBe('newer-run');
  });

  it('prefers publish preflight over other RUNNING runs', () => {
    const picked = pickActiveEtlRun([
      {
        id: 'task',
        pipelineId: 'p1',
        status: 'RUNNING',
        startedAt: 300,
      },
      {
        id: 'pub',
        pipelineId: '__publish__',
        pipelineName: '发布预检',
        status: 'RUNNING',
        startedAt: 100,
      },
    ]);
    expect(picked?.id).toBe('pub');
  });

  it('picks scheduled PENDING when it is the only active run', () => {
    const picked = pickActiveEtlRun([
      {
        id: 'sched',
        pipelineId: 'nightly',
        pipelineName: '夜间任务',
        status: 'PENDING',
        startedAt: 50,
      },
      { id: 'old', pipelineId: 'x', status: 'FAILED', startedAt: 90 },
    ]);
    expect(picked?.id).toBe('sched');
  });

  it('returns undefined when nothing is active', () => {
    expect(pickActiveEtlRun([{ id: 'a', status: 'SUCCESS' }])).toBeUndefined();
    expect(pickActiveEtlRun([])).toBeUndefined();
    expect(pickActiveEtlRun(undefined)).toBeUndefined();
  });

  it('allows cancel for workspace owner or run starter only', () => {
    expect(
      canCancelEtlRun({
        run: { userId: 2 },
        currentUserId: 9,
        isWorkspaceOwner: true,
      }),
    ).toBe(true);
    expect(
      canCancelEtlRun({
        run: { userId: 2 },
        currentUserId: 2,
        isWorkspaceOwner: false,
      }),
    ).toBe(true);
    expect(
      canCancelEtlRun({
        run: { userId: 2 },
        currentUserId: 9,
        isWorkspaceOwner: false,
      }),
    ).toBe(false);
    expect(
      canCancelEtlRun({
        run: { userId: 2 },
        currentUserId: null,
        isWorkspaceOwner: false,
      }),
    ).toBe(false);
  });

  it('discovers listRuns every N ticks while live-active, always when idle', () => {
    expect(
      nextEtlLiveDiscoverTick({ forceList: true, liveActive: true, discoverTick: 1 }),
    ).toEqual({ discover: true, nextTick: 0 });
    expect(
      nextEtlLiveDiscoverTick({ liveActive: false, discoverTick: 2 }),
    ).toEqual({ discover: true, nextTick: 0 });
    expect(
      nextEtlLiveDiscoverTick({ liveActive: true, discoverTick: 0, discoverEvery: 4 }),
    ).toEqual({ discover: false, nextTick: 1 });
    expect(
      nextEtlLiveDiscoverTick({ liveActive: true, discoverTick: 3, discoverEvery: 4 }),
    ).toEqual({ discover: true, nextTick: 0 });
  });
});
