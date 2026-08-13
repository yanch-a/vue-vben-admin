import { getListData } from '#/api/helper';
import { requestClient } from '#/api/request';

const BASE = '/system/menuManagement';

export function getMenuTree(params?: Record<string, any>) {
  return requestClient.get(`${BASE}/getTree`, { params });
}

export function getMenuList(params?: Record<string, any>) {
  return getListData(`${BASE}/getList`, params);
}

export function getMenuById(menuId: number | string) {
  return requestClient.get(`${BASE}/${menuId}`);
}

export function saveMenu(data: Record<string, any>) {
  return requestClient.post(`${BASE}/doEdit`, data);
}

export function deleteMenu(id: number | string) {
  return requestClient.get(`${BASE}/del/${id}`);
}

export function updateMenu(data: Record<string, any>) {
  return requestClient.post(`${BASE}/doUpdate`, data);
}

export function getMemoryMenus() {
  return requestClient.get(`${BASE}/getMemoryMenus`);
}
