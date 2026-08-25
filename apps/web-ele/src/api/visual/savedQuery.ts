/**
 * SQL 编辑器「已保存查询」API
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const savedQueryUrl = adminUrl + '/savedQuery/';
const savedQueryGroupUrl = adminUrl + '/savedQueryGroup/';

/** 当前用户在指定连接+库下的查询列表（对象树） */
export function listSavedQueries(params: {
  dbConfigId: number | string;
  instanceName: string;
}) {
  return request({
    url: savedQueryUrl + 'listMine',
    method: 'get',
    params,
  });
}

/** 管理页：全部查询（可选过滤） */
export function listAllSavedQueries(params?: {
  dbConfigId?: number | string;
  instanceName?: string;
}) {
  return request({
    url: savedQueryUrl + 'listAllMine',
    method: 'get',
    params,
  });
}

/** 关键字搜索名称/描述/SQL */
export function searchSavedQueries(params: {
  keyword: string;
  dbConfigId?: number | string;
}) {
  return request({
    url: savedQueryUrl + 'searchMine',
    method: 'get',
    params,
  });
}

/** 管理树：分组 + 查询 */
export function treeSavedQueries() {
  return request({
    url: savedQueryUrl + 'treeMine',
    method: 'get',
  });
}

export function getSavedQueryById(id: number | string) {
  return request({
    url: savedQueryUrl + id,
    method: 'get',
  });
}

export function addSavedQuery(data: {
  queryName: string;
  sqlText: string;
  dbConfigId: number | string;
  instanceName: string;
  groupId?: number | string | null;
  description?: string;
  orderNum?: number;
}) {
  return request({
    url: savedQueryUrl + 'add',
    method: 'post',
    data,
  });
}

export function editSavedQuery(data: {
  id: number | string;
  queryName?: string;
  sqlText?: string;
  dbConfigId?: number | string;
  instanceName?: string;
  /** 传 0 表示移出分组 */
  groupId?: number | string | null;
  description?: string;
  orderNum?: number;
}) {
  return request({
    url: savedQueryUrl + 'doEdit',
    method: 'post',
    data,
  });
}

export function deleteSavedQuery(id: number | string) {
  return request({
    url: savedQueryUrl + 'del/' + id,
    method: 'get',
  });
}

/** ---------- 分组 ---------- */

export function listSavedQueryGroups() {
  return request({
    url: savedQueryGroupUrl + 'listMine',
    method: 'get',
  });
}

export function addSavedQueryGroup(data: {
  groupName: string;
  parentId?: number | string | null;
  description?: string;
  orderNum?: number;
}) {
  return request({
    url: savedQueryGroupUrl + 'add',
    method: 'post',
    data,
  });
}

export function editSavedQueryGroup(data: {
  id: number | string;
  groupName?: string;
  /** 传 0 表示移到根 */
  parentId?: number | string | null;
  description?: string;
  orderNum?: number;
}) {
  return request({
    url: savedQueryGroupUrl + 'doEdit',
    method: 'post',
    data,
  });
}

export function deleteSavedQueryGroup(id: number | string) {
  return request({
    url: savedQueryGroupUrl + 'del/' + id,
    method: 'get',
  });
}
