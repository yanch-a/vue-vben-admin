import type { EtlScheduleConfig, EtlScheduleRow } from '#/api/visual/etl';

/** 新计划默认关闭；打开弹窗不构成授权定时写入。 @author yanch */
export function createScheduleForm(): EtlScheduleConfig {
  return {
    enabled: false,
    revision: 0,
    publishedVersion: 0,
    pipelineIds: [],
    mode: 'DAILY',
    timeZone: 'Asia/Shanghai',
    timeOfDay: '02:00',
    weekDays: [1, 2, 3, 4, 5],
    intervalMinutes: 60,
    cronExpression: '0 */5 * * * *',
  };
}

/** 持久化状态只取请求白名单字段，不能把工作区 ID、租约、审计字段回传当成可编辑配置。 @author yanch */
export function decodeSchedule(row: EtlScheduleRow): EtlScheduleConfig {
  const ids: unknown = JSON.parse(row.pipelineIdsJson || '[]');
  const days: unknown = JSON.parse(row.weekDaysJson || '[]');
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string') ||
    !Array.isArray(days) ||
    days.some((day) => !Number.isInteger(day))
  )
    throw new Error('定时状态数组无效，请重新配置');
  return {
    enabled: row.enabled,
    revision: row.revision,
    publishedVersion: row.publishedVersion,
    pipelineIds: [...ids],
    mode: row.mode,
    timeZone: row.timeZone,
    cronExpression: row.cronExpression || undefined,
    timeOfDay: row.timeOfDay || undefined,
    weekDays: [...days],
    intervalMinutes: row.intervalMinutes || undefined,
    runAt: row.runAt ? Number(row.runAt) : undefined,
  };
}

/** 日期组件可能输出毫秒字符串，发送时统一为绝对时间；不提交服务端状态字段。 @author yanch */
export function schedulePayload(form: EtlScheduleConfig): EtlScheduleConfig {
  return {
    enabled: !!form.enabled,
    revision: form.revision,
    publishedVersion: form.publishedVersion,
    pipelineIds: [...form.pipelineIds],
    mode: form.mode,
    timeZone: form.timeZone,
    cronExpression: form.cronExpression,
    timeOfDay: form.timeOfDay,
    weekDays: [...form.weekDays],
    intervalMinutes: form.intervalMinutes,
    runAt: form.runAt == null ? undefined : Number(form.runAt),
  };
}
