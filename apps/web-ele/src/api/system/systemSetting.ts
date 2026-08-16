/**
 * 系统参数 / 品牌展示配置 API
 *
 * @author yanch
 */
import { requestClient } from '#/api/request';

const BASE = '/system/systemSetting';

export interface SystemSettingItem {
  id?: number;
  configCode: string;
  configName?: string;
  configValue?: string;
  configDes?: string;
  orderNum?: number;
  inputType?: string;
  type?: number;
}

/** type=1 系统对外配置列表（管理页编辑用） */
export function fetchSystemConfigApi() {
  return requestClient.get<SystemSettingItem[]>(`${BASE}/systemConfig`);
}

/** 保存系统对外配置 */
export function updateSystemConfigApi(data: SystemSettingItem[]) {
  return requestClient.post<void>(`${BASE}/updateConfig`, data);
}

/** 免登录品牌配置 Map（启动阶段也可用 fetch，见 store/branding） */
export function fetchBrandConfigApi() {
  return requestClient.get<Record<string, string>>(`${BASE}/brandConfig`);
}
