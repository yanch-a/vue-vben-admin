/**
 * SQL 编辑器工作现场：按当前用户把已打开连接和查询存到服务器。
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const baseUrl = adminUrl + '/vqClientSession/';

export interface ClientSessionListItem {
  id: number | string;
  aliasName: string;
  clientLabel?: string;
  connectionCount?: number;
  tabCount?: number;
  updateTime?: string;
}

export function listClientSessions() {
  return request({
    url: baseUrl + 'listMine',
    method: 'get',
  });
}

export function getClientSession(id: number | string) {
  return request({
    url: baseUrl + 'detail/' + id,
    method: 'get',
  });
}

export function addClientSession(data: {
  aliasName: string;
  clientLabel?: string;
  snapshot: unknown;
}) {
  return request({
    url: baseUrl + 'add',
    method: 'post',
    data,
  });
}

export function updateClientSession(data: {
  id: number | string;
  aliasName: string;
  clientLabel?: string;
  snapshot: unknown;
}) {
  return request({
    url: baseUrl + 'doEdit',
    method: 'post',
    data,
  });
}

export function deleteClientSession(id: number | string) {
  return request({
    url: baseUrl + 'del/' + id,
    method: 'get',
  });
}
