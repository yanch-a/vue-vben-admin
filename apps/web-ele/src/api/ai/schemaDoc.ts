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

export function schemaDocTask(taskId: string, showErrorMessage = true) {
  return request({
    url: url + 'task/' + taskId,
    method: 'get',
    showErrorMessage,
  });
}

/** 当前用户结构文档任务（进行中 + 缓存里近 7 天已完成） */
export function schemaDocTaskList(showErrorMessage = true) {
  return request({
    url: url + 'task/list',
    method: 'get',
    timeout: 30_000,
    showErrorMessage,
  });
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
    const fromScalar = asTaskId(v);
    if (fromScalar) return fromScalar;
    if (typeof v === 'object') {
      if (v.taskId != null && typeof v.taskId !== 'object') {
        const s = asTaskId(v.taskId);
        if (s) return s;
      }
      // R.ok(String) 重载会把 taskId 写进 msg、data 为空，这里兜底
      const fromMsg = asTaskId(v.msg);
      if (fromMsg) return fromMsg;
      if (v.data !== undefined && v.data !== v && v.data != null) {
        v = v.data;
        continue;
      }
    }
    return '';
  }
  return '';
}

/** 只接受像 UUID/无横线 hex 的任务号，避免把「操作成功」当 taskId */
function asTaskId(v: any): string {
  if (v == null || typeof v === 'object') return '';
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null' || s.includes('[object')) return '';
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(s)) return '';
  return s;
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
