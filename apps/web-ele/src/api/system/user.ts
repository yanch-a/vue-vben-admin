import { getPageList } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/system/userManagement';

export function getUserPage(params?: Record<string, any>) {
  return getPageList(`${BASE}/getList`, params);
}

export function searchUser(params?: Record<string, any>) {
  return requestClient.get(`${BASE}/search`, { params });
}

export function getUserById(userId: number | string) {
  return requestClient.get(`${BASE}/${userId || ''}`);
}

export function saveUser(data: Record<string, any>) {
  if (data.userId) {
    return requestClient.post(`${BASE}/doEdit`, data);
  }
  return requestClient.post(`${BASE}/add`, data);
}

export function deleteUser(userIds: number | string) {
  return requestClient.get(`${BASE}/doDelete/${userIds}`);
}

export function resetUserPwd(data: Record<string, any>) {
  return requestClient.post(`${BASE}/resetPwd`, data);
}

export function updatePassword(data: Record<string, any>) {
  return requestClient.post(`${BASE}/updatePassword`, data);
}
