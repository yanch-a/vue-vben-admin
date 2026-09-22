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
  /** PG schema / Oracle owner；达梦等一级已是模式时可省略 */
  targetSchema?: string;
  /** 可选：限定源侧名称空间 */
  sourceSchema?: string;
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
  copiedRows?: number;
  currentTableRows?: number;
  truncated?: boolean;
  cancelRequested?: boolean;
  errors?: DbCopyErrorVO[];
  /** 错误总数；列表接口可能只带最近若干条 errors */
  errorTotal?: number;
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

/** 当前用户任务列表；后台轮询可关闭全局错误消息。 */
export function listDbCopyTasks(showErrorMessage = true) {
  return request({
    url: dbCopyUrl + 'tasks',
    method: 'get',
    // 复制进行中列表可能较大，避免默认 10s 超时把连接掐断
    timeout: 30_000,
    showErrorMessage,
  });
}

/** 任务详情；后台轮询可关闭全局错误消息。 */
export function getDbCopyTask(taskId: string, showErrorMessage = true) {
  return request({
    url: dbCopyUrl + 'task/' + encodeURIComponent(taskId),
    method: 'get',
    timeout: 30_000,
    showErrorMessage,
  });
}

/** 取消任务 */
export function cancelDbCopyTask(taskId: string) {
  return request({
    url: dbCopyUrl + 'task/' + encodeURIComponent(taskId) + '/cancel',
    method: 'post',
  });
}
