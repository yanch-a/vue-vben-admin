/**
 * SQL 执行历史 API
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/sqlHistory/';

export function pageSqlHistory(params: Record<string, any>) {
  return request({ url: url + 'page', method: 'get', params });
}

export function deleteSqlHistory(id: number | string) {
  return request({ url: url + 'del/' + id, method: 'get' });
}

export function clearSqlHistory(params: { dbConfigId: number | string; instanceName?: string }) {
  return request({ url: url + 'clear', method: 'post', params });
}

export function sqlHistoryTables(params: { dbConfigId: number | string; instanceName?: string }) {
  return request({ url: url + 'tables', method: 'get', params });
}
