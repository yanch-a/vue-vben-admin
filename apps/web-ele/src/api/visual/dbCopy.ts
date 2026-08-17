import { adminUrl } from '#/config';
import request from '#/utils/request';

/**
 * 跨主机复制数据库 API
 * @author yanch
 */

const dbCopyUrl = adminUrl + '/dbCopy/';

export interface DbCopyStartPayload {
  sourceDbConfigId: number | string;
  sourceInstance: string;
  targetDbConfigId: number | string;
  targetInstance: string;
  tableNames: string[];
  mode?: 'structure' | 'both';
  dropIfExists?: boolean;
  bulkInsert?: boolean;
  ignoreDefiner?: boolean;
  maxRows?: number;
  batchSize?: number;
  continueOnError?: boolean;
}

export interface DbCopyErrorVO {
  objectName?: string;
  phase?: string;
  message?: string;
  timeMillis?: number;
}

export interface DbCopyTaskVO {
  taskId: string;
  userId?: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  sourceDbConfigId?: number;
  sourceInstance?: string;
  targetDbConfigId?: number;
  targetInstance?: string;
  mode?: string;
  totalObjects: number;
  processedObjects: number;
  currentObject?: string;
  successCount?: number;
  failedCount?: number;
  createTime?: number;
  updateTime?: number;
  message?: string;
  cancelRequested?: boolean;
  errors?: DbCopyErrorVO[];
  progressPercent?: number;
}

/** 启动异步复制 */
export function startDbCopy(data: DbCopyStartPayload) {
  return request({
    url: dbCopyUrl + 'start',
    method: 'post',
    data,
  });
}

/** 当前用户任务列表 */
export function listDbCopyTasks() {
  return request({
    url: dbCopyUrl + 'tasks',
    method: 'get',
  });
}

/** 任务详情 */
export function getDbCopyTask(taskId: string) {
  return request({
    url: dbCopyUrl + 'task/' + encodeURIComponent(taskId),
    method: 'get',
  });
}

/** 取消任务 */
export function cancelDbCopyTask(taskId: string) {
  return request({
    url: dbCopyUrl + 'task/' + encodeURIComponent(taskId) + '/cancel',
    method: 'post',
  });
}
