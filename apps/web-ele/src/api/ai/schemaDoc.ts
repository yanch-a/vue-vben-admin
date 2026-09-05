/**
 * Schema 结构文档 API
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/aiSchemaDoc/';

export function schemaDocTree(params: { dbConfigId: number | string; instanceName: string }) {
  return request({ url: url + 'tree', method: 'get', params });
}

export function getSchemaDoc(id: number | string) {
  return request({ url: url + 'doc/' + id, method: 'get' });
}

export function saveSchemaDoc(data: { id: number | string; contentMd: string }) {
  return request({ url: url + 'doc/save', method: 'post', data });
}

export function unlockSchemaDoc(id: number | string) {
  return request({ url: url + 'doc/unlock/' + id, method: 'post' });
}

export function schemaDocHistory(id: number | string) {
  return request({ url: url + 'doc/' + id + '/history', method: 'get' });
}

export function rollbackSchemaDoc(data: { docId: number | string; version: number }) {
  return request({ url: url + 'doc/rollback', method: 'post', data });
}

export function initSchemaDoc(data: { dbConfigId: number | string; instanceName: string }) {
  return request({ url: url + 'init', method: 'post', data });
}

export function generateSchemaDoc(data: {
  dbConfigId: number | string;
  instanceName: string;
  modelId: number | string;
  mode: 'FULL' | 'INCREMENTAL' | 'TABLES';
  tables?: string[];
}) {
  return request({ url: url + 'generate', method: 'post', data });
}

export function analyzeHistory(data: {
  dbConfigId: number | string;
  instanceName: string;
  modelId?: number | string;
  historyIds?: Array<number | string>;
}) {
  return request({ url: url + 'analyzeHistory', method: 'post', data });
}

export function schemaDocTask(taskId: string) {
  return request({ url: url + 'task/' + taskId, method: 'get' });
}

export function schemaDocTaskList() {
  return request({ url: url + 'task/list', method: 'get' });
}

export function cancelSchemaDocTask(taskId: string) {
  return request({ url: url + 'task/cancel/' + taskId, method: 'post' });
}

export function schemaDocDrift(params: { dbConfigId: number | string; instanceName: string }) {
  return request({ url: url + 'drift', method: 'get', params });
}

export function exportSchemaDoc(params: { dbConfigId: number | string; instanceName: string }) {
  return request({
    url: url + 'export',
    method: 'get',
    params,
    responseType: 'blob',
  });
}
