/**
 * 可视化查询「结果文件」API：保存到服务器、分享、协同同步、操作记录
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/queryResultFile/';

/** 保存查询结果为服务器文件 */
export function saveQueryResultFile(data: {
  configId?: number | string;
  title?: string;
  limit?: number;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}) {
  return request({
    url: url + 'save',
    method: 'post',
    data,
  });
}

/**
 * 分享结果：默认 READ；可传 WRITE 与过期时间
 * 返回 { meta, columns, rows, shareUrl, canWrite }
 */
export function shareQueryResultFile(data: {
  resultFileId?: number | string;
  configId?: number | string;
  title?: string;
  limit?: number;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  /** READ | WRITE，默认 READ */
  shareMode?: string;
  /** yyyy-MM-dd HH:mm:ss 或毫秒时间戳 */
  shareExpireTime?: string | number | null;
}) {
  return request({
    url: url + 'share',
    method: 'post',
    data,
  });
}

/** 撤销分享（仅所有者） */
export function revokeQueryResultShare(resultFileId: number | string) {
  return request({
    url: url + 'revokeShare/' + resultFileId,
    method: 'post',
  });
}

/** 按分享码加载（需登录） */
export function getQueryResultByShareCode(shareCode: string) {
  return request({
    url: url + 'byShareCode/' + encodeURIComponent(shareCode),
    method: 'get',
  });
}

/** 同步表格内容 + 可选记录 Univer 命令 */
export function syncQueryResultContent(data: {
  resultFileId: number | string;
  contentVersion?: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  commandId?: string;
  commandName?: string;
  commandPayload?: string;
}) {
  return request({
    url: url + 'syncContent',
    method: 'post',
    data,
  });
}

/** 操作记录 */
export function listQueryResultOpLogs(resultFileId: number | string, limit?: number) {
  return request({
    url: url + 'opLogs/' + resultFileId,
    method: 'get',
    params: { limit },
  });
}

/** 我的结果文件列表 */
export function listMyQueryResultFiles() {
  return request({
    url: url + 'listMine',
    method: 'get',
  });
}

/** 某查询配置下最近一次保存的结果（无则 data 为空） */
export function getLatestQueryResultByConfig(configId: number | string) {
  return request({
    url: url + 'latestByConfig/' + configId,
    method: 'get',
  });
}

/** 所有者按 ID 加载结果内容 */
export function getQueryResultContent(resultFileId: number | string) {
  return request({
    url: url + 'content/' + resultFileId,
    method: 'get',
  });
}

/**
 * 导出结果 Excel（blob）
 * 优先传 columns/rows 导出当前视图；也可只传 shareCode / resultFileId
 */
export function exportQueryResultExcel(data: {
  shareCode?: string;
  resultFileId?: number | string;
  title?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
}) {
  return request({
    url: url + 'exportExcel',
    method: 'post',
    responseType: 'blob',
    data,
  });
}
