import { adminUrl } from '#/config';
import request from '#/utils/request';

/**
 * 上传 SQL 文件并后台执行
 * @author yanch
 */

const sqlScriptUrl = adminUrl + '/sqlScript/';

export interface SqlScriptTaskVO {
  taskId: string;
  userId?: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  dbConfigId?: number;
  instanceName?: string;
  fileName?: string;
  engine?: 'MANAGED' | 'NATIVE';
  startedAt?: number;
  elapsedMs?: number;
  total: number;
  done: number;
  successCount?: number;
  failedCount?: number;
  currentSql?: string;
  message?: string;
  continueOnError?: boolean;
  createTime?: number;
  updateTime?: number;
  errors?: string[];
  errorTotal?: number;
  progressPercent?: number;
}

export function startSqlScript(form: FormData) {
  return request({
    url: sqlScriptUrl + 'start',
    method: 'post',
    data: form,
    timeout: 0,
  });
}

export function listSqlScriptTasks() {
  return request({
    url: sqlScriptUrl + 'tasks',
    method: 'get',
    timeout: 30_000,
  });
}

export function getSqlScriptTask(taskId: string) {
  return request({
    url: sqlScriptUrl + 'task/' + encodeURIComponent(taskId),
    method: 'get',
    timeout: 30_000,
  });
}

export function cancelSqlScriptTask(taskId: string) {
  return request({
    url: sqlScriptUrl + 'task/' + encodeURIComponent(taskId) + '/cancel',
    method: 'post',
  });
}
