import { describe, it, expect } from 'vitest';
import {
  createScheduleForm,
  decodeSchedule,
  schedulePayload,
} from './scheduleModel';

/** 白名单、数组隔离、前置步骤和日期类型回归。@author yanch */
describe('workspace schedule form', () => {
  it('starts disabled and preserves selected task order without server state', () => {
    expect(createScheduleForm().enabled).toBe(false);
    expect(createScheduleForm().preSteps).toEqual([]);
    const row = {
      workspaceId: '1',
      enabled: true,
      revision: 3,
      publishedVersion: 2,
      pipelineIdsJson: '["b","a"]',
      mode: 'DAILY' as const,
      timeZone: 'Asia/Shanghai',
      timeOfDay: '02:00',
      weekDaysJson: '[1,7]',
      nextFireAt: 1000,
    };
    const form = decodeSchedule(row, [
      {
        workspaceId: '9',
        publishedVersion: 1,
        pipelineIds: ['pre'],
        workspaceName: '前置区',
      },
    ]);
    expect(form.pipelineIds).toEqual(['b', 'a']);
    expect(form.weekDays).toEqual([1, 7]);
    expect(form.preSteps).toEqual([
      {
        workspaceId: '9',
        publishedVersion: 1,
        pipelineIds: ['pre'],
        workspaceName: '前置区',
        latestPublishedVersion: undefined,
        pipelines: undefined,
        latestPipelines: undefined,
        missing: false,
      },
    ]);
    expect(schedulePayload(form)).not.toHaveProperty('workspaceId');
    expect(schedulePayload(form)).not.toHaveProperty('nextFireAt');
    const payload = schedulePayload(form);
    expect(payload.preSteps).toEqual([
      { workspaceId: '9', publishedVersion: 1, pipelineIds: ['pre'] },
    ]);
    payload.pipelineIds.push('c');
    payload.preSteps[0]!.pipelineIds.push('x');
    expect(form.pipelineIds).toEqual(['b', 'a']);
    expect(form.preSteps[0]!.pipelineIds).toEqual(['pre']);
  });
  it('normalizes picker timestamps and rejects corrupt arrays', () => {
    const form = createScheduleForm();
    form.runAt = '1791400000000' as unknown as number;
    expect(schedulePayload(form).runAt).toBe(1791400000000);
    expect(() =>
      decodeSchedule({
        ...form,
        workspaceId: '1',
        pipelineIdsJson: '{}',
        weekDaysJson: '[]',
      }),
    ).toThrow('定时状态数组无效');
  });
});
