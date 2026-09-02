import { adminUrl } from '#/config';
import request from '#/utils/request';

const licenseUrl = adminUrl + '/license/';

/** 授权状态 */
export function getLicenseStatus() {
  return request({
    url: licenseUrl + 'status',
    method: 'get',
  });
}

/** 机器码（仅购买绑机 License 时需要） */
export function getLicenseMachineId() {
  return request({
    url: licenseUrl + 'machineId',
    method: 'get',
  });
}

/** 导入 License JSON 文本 */
export function installLicense(content: string) {
  return request({
    url: licenseUrl + 'install',
    method: 'post',
    data: { content },
  });
}
