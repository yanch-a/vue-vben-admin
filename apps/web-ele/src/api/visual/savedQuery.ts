/**
 * SQL 编辑器「已保存查询」API
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const savedQueryUrl = adminUrl + '/savedQuery/';

/** 当前用户在指定连接+库下的查询列表 */
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
