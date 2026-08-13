import { getPageList } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/system/roleManagement';

export function getRolePage(params?: Record<string, any>) {
  return getPageList(`${BASE}/getList`, params);
}

export function getRoleById(id: number | string) {
  return requestClient.get(`${BASE}/${id}`);
}

export function saveRole(data: Record<string, any>) {
  if (data.roleId) {
    return requestClient.post(`${BASE}/doEdit`, data);
  }
  return requestClient.post(`${BASE}/add`, data);
}

export function deleteRole(ids: number | string) {
  return requestClient.get(`${BASE}/del/${ids}`);
}

export function getRoleModuleIds(params?: Record<string, any>) {
  return requestClient.get(`${BASE}/getRoleModuleIds`, { params });
}

export function getRoleOperations(params?: Record<string, any>) {
  return requestClient.post(`${BASE}/getOperations`, null, { params });
}

export function updateRolePerm(params?: Record<string, any>) {
  return requestClient.post(`${BASE}/updateRolePerm`, null, { params });
}

export function updateRoleOpera(params?: Record<string, any>) {
  return requestClient.post(`${BASE}/updateRoleOpera`, null, { params });
}
