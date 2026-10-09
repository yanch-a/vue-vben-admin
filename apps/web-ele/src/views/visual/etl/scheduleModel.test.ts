import { describe, it, expect } from 'vitest';
import {
  createScheduleForm,
  decodeSchedule,
  schedulePayload,
} from './scheduleModel';

/** 白名单、数组隔离和日期类型回归。@author yanch */
describe('workspace schedule form', () => {
  it('starts disabled and preserves selected task order without server state', () => {
    expect(createScheduleForm().enabled).toBe(false);
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
    const form = decodeSchedule(row);
    expect(form.pipelineIds).toEqual(['b', 'a']);
    expect(form.weekDays).toEqual([1, 7]);
    expect(schedulePayload(form)).not.toHaveProperty('workspaceId');
    expect(schedulePayload(form)).not.toHaveProperty('nextFireAt');
    const payload = schedulePayload(form);
    payload.pipelineIds.push('c');
    expect(form.pipelineIds).toEqual(['b', 'a']);
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
