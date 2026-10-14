import { adminUrl } from '#/config';
import request from '#/utils/request';

/**
 * 整库导出/备份。提交后轮询任务，完成后下载 SQL 或 ZIP。
 * @author yanch
 */

const dbBackupUrl = adminUrl + '/dbBackup/';

export interface DbBackupTaskVO {
  taskId: string;
  userId?: number;
  status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'RUNNING' | 'SUCCESS';
  dbConfigId?: number;
  dbName?: string;
  instanceName?: string;
  engine?: 'JDBC' | 'NATIVE';
  phase?: 'PREPARING' | 'EXPORTING' | 'PACKING' | 'FINISHED';
  cancelRequested?: boolean;
  fileName?: string;
  fileSize?: number;
  zipped?: boolean;
  downloadReady?: boolean;
  total?: number;
  done?: number;
  currentTable?: string;
  message?: string;
  startedAt?: number;
  elapsedMs?: number;
  createTime?: number;
  updateTime?: number;
  errors?: string[];
  progressPercent?: number;
}

export function startDbBackup(data: {
  dbConfigId: number | string;
  instanceName: string;
  engine?: 'jdbc' | 'native';
  options?: Omit<Parameters<typeof import('./database').exportSqlDump>[0], 'dbConfigId' | 'engine'> & { fileName?: string };
}) {
  return request({
    url: dbBackupUrl + 'start',
    method: 'post',
    data,
    timeout: 0,
  });
}

export function listDbBackupTasks(showErrorMessage = true) {
  return request({
    url: dbBackupUrl + 'tasks',
    method: 'get',
    timeout: 0,
    showErrorMessage,
  });
}

export function getDbBackupTask(taskId: string, showErrorMessage = true) {
  return request({
    url: dbBackupUrl + 'task/' + encodeURIComponent(taskId),
    method: 'get',
    timeout: 0,
    showErrorMessage,
  });
}

export function cancelDbBackupTask(taskId: string) {
  return request({
    url: dbBackupUrl + 'task/' + encodeURIComponent(taskId) + '/cancel',
    method: 'post',
  });
}

export function downloadDbBackupFile(taskId: string) {
  return request({
    url: dbBackupUrl + 'task/' + encodeURIComponent(taskId) + '/download',
    method: 'get',
    responseType: 'blob',
    responseReturn: 'raw',
    timeout: 0,
  });
}
