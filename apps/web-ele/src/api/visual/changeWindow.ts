import { adminUrl } from '#/config';
import request from '#/utils/request';

/**
 * 变更窗口配置（默认仅管理员）与连接窗口状态。
 * @author yanch
 */
const url = adminUrl + '/changeWindow/';

export interface ChangeWindowRow {
  id?: number | string;
  /** ENV / CONNECTION */
  scopeType: string;
  scopeKey?: string;
  env?: null | string;
  dbConfigId?: null | number | string;
  enabled?: number;
  timezone?: string;
  rulesJson?: string;
  freezesJson?: string;
  remark?: null | string;
  dbName?: string;
  currentOpen?: boolean;
  currentText?: string;
}

export function listChangeWindows() {
  return request({ url: url + 'list', method: 'get' });
}

export function saveChangeWindow(data: ChangeWindowRow) {
  return request({ url: url + 'save', method: 'post', data });
}

export function deleteChangeWindow(id: number | string) {
  return request({ url: url + 'del/' + id, method: 'get' });
}

export function previewChangeWindow(data: ChangeWindowRow) {
  return request({ url: url + 'preview', method: 'post', data });
}

/** SQL 编辑器：连接当前的变更窗口状态（静默失败，不弹错误） */
export function getChangeWindowStatus(dbConfigId: number | string) {
  return request({
    url: adminUrl + '/dataBaseOperate/changeWindowStatus/' + dbConfigId,
    method: 'get',
    showErrorMessage: false,
  });
}
