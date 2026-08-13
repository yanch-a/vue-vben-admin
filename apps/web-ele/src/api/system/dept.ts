import { getListData } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/system/department';

export function getDeptList(params?: Record<string, any>) {
  return getListData(`${BASE}/getList`, params);
}

export function getDeptTree(params?: Record<string, any>) {
  return requestClient.get(`${BASE}/getTree`, { params });
}

export function getDeptById(id: number | string) {
  return requestClient.get(`${BASE}/${id}`);
}

export function saveDept(data: Record<string, any>) {
  return requestClient.post(`${BASE}/doEdit`, data);
}

export function deleteDept(id: number | string) {
  return requestClient.get(`${BASE}/del/${id}`);
}
