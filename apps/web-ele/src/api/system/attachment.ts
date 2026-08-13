import { getPageList } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/admin/attachmentManage';

export function getAttachmentPage(params?: Record<string, any>) {
  return getPageList(`${BASE}/getPage`, params);
}

export function getAttachmentList(params?: Record<string, any>) {
  return requestClient.get(`${BASE}/getList`, { params });
}

export function getAttachmentManageById(id: number | string) {
  return requestClient.get(`${BASE}/${id}`);
}

export function saveAttachment(data: Record<string, any>) {
  if (data.id) {
    return requestClient.post(`${BASE}/doEdit`, data);
  }
  return requestClient.post(`${BASE}/add`, data);
}

export function deleteAttachment(ids: number | string) {
  return requestClient.get(`${BASE}/del/${ids}`);
}

export function getAttachmentsByIds(ids: string) {
  return requestClient.get('/attachment/getAttachment', { params: { ids } });
}

export function getAttachmentsByBelongIds(ids: string) {
  return requestClient.get('/attachment/getByBelongIds', { params: { ids } });
}

export function uploadAttachmentUrl() {
  return `${import.meta.env.VITE_GLOB_API_URL}/attachment/upload`;
}
