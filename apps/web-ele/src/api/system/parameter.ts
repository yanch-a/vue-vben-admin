import { getPageList } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/system/parameterManage';

export function getParameterPage(params?: Record<string, any>) {
  return getPageList(`${BASE}/getPage`, params);
}

export function getParameterById(id: number | string) {
  return requestClient.get(`${BASE}/${id}`);
}

export function saveParameter(data: Record<string, any>) {
  if (data.id) {
    return requestClient.post(`${BASE}/doEdit`, data);
  }
  return requestClient.post(`${BASE}/add`, data);
}

export function deleteParameter(ids: number | string) {
  return requestClient.get(`${BASE}/del/${ids}`);
}

export function updateParameterByCode(data: Record<string, any>) {
  return requestClient.post(`${BASE}/updateByCode`, data);
}
