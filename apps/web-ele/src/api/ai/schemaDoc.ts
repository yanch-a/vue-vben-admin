/**
 * 结构文档 + 智能体记忆 API。
 * 文档：/admin/aiSchemaDoc/* ；记忆：/admin/aiAgentMemory/* 。
 * generate/analyzeHistory 返回 taskId 字符串，必须用 extractSchemaDocTaskId，禁止把对象拼进 /task/。
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

/** 从 R / 嵌套 data 里取出 taskId，避免把对象拼进 URL 变成 [object Object] */
export function extractSchemaDocTaskId(res: any): string {
  let v: any = res;
  // 最多剥 4 层 { data: { data: ... } }，防循环引用死转
  for (let i = 0; i < 4; i++) {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      // String(整个响应对象) 会变成 "[object Object]"，绝不能当 taskId
      if (!s || s === 'undefined' || s === 'null' || s.includes('[object')) return '';
      return s;
    }
    if (typeof v === 'object') {
      if (v.taskId != null && typeof v.taskId !== 'object') return String(v.taskId);
      if (v.data !== undefined && v.data !== v) {
        v = v.data;
        continue;
      }
    }
    return '';
  }
  return '';
}

export function getAgentMemoryPair(params: { dbConfigId: number | string; instanceName: string }) {
  return request({
    url: adminUrl + '/aiAgentMemory/pair',
    method: 'get',
    params,
  });
}

export function digestAgentMemory(data: {
  dbConfigId: number | string;
  instanceName: string;
  modelId?: number | string;
}) {
  return request({
    url: adminUrl + '/aiAgentMemory/digest',
    method: 'post',
    data,
  });
}
