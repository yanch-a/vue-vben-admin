import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/redisConsole/';

export function redisConnections() { return request({ url: url + 'connections', method: 'get' }); }
export function saveRedisConnection(data: Record<string, any>) { return request({ url: url + 'connection', method: 'post', data }); }
export function deleteRedisConnection(id: number | string) { return request({ url: url + 'connection/' + id, method: 'delete' }); }
export function testRedisConnection(id: number | string) { return request({ url: url + 'connection/' + id + '/test', method: 'get', timeout: 0 }); }
export function getRedisDatabases(id: number | string) { return request({ url: url + 'connection/' + id + '/databases', method: 'get', timeout: 0 }); }
export function getRedisInfo(id: number | string) { return request({ url: url + 'connection/' + id + '/info', method: 'get', timeout: 0 }); }
export function scanRedisKeys(id: number | string, database: number, pattern: string) {
  return request({ url: url + id + '/keys', method: 'get', params: { database, pattern, count: 500 }, timeout: 0, showErrorMessage: false });
}
/** 按原始键字节读取；乱码/二进制键不要用展示文本重算 Base64。 */
export function getRedisKey(id: number | string, database: number, keyBase64: string) {
  return request({
    url: url + id + '/key/query',
    method: 'post',
    params: { database },
    data: { keyBase64 },
    showErrorMessage: false,
  });
}
export function saveRedisKey(id: number | string, database: number, data: Record<string, any>) {
  return request({ url: url + id + '/key', method: 'post', params: { database }, data });
}
export function deleteRedisKey(id: number | string, database: number, keyBase64: string) {
  return request({
    url: url + id + '/key',
    method: 'delete',
    params: { database },
    data: { keyBase64 },
  });
}
export function deleteRedisDirectory(id: number | string, database: number, prefixBase64: string) {
  return request({ url: url + id + '/keys', method: 'delete', params: { database, prefixBase64 }, timeout: 0 });
}
export function updateRedisKeyMeta(id: number | string, database: number, keyBase64: string, data: Record<string, any>) {
  return request({ url: url + id + '/key/meta', method: 'put', params: { database, keyBase64 }, data });
}
/** 连接授权列表（仅所有者 / 管理员）。 */
export function listRedisGrants(id: number | string) { return request({ url: url + 'connection/' + id + '/grants', method: 'get' }); }
/** 按用户名 / 姓名 / 手机号或部门搜索可授权的会员。 */
export function searchRedisGrantCandidates(id: number | string, params: { groupId?: number | string; keyword?: string }) {
  return request({ url: url + 'connection/' + id + '/grantCandidates', method: 'get', params });
}
/** 全量替换连接授权；allowedDatabases 空数组 = 全部 DB。 */
export function replaceRedisGrants(id: number | string, grants: Array<{
  allowedDatabases?: number[];
  canUse?: number;
  canWrite?: number;
  memberUserId: number | string;
}>) {
  return request({ url: url + 'connection/' + id + '/grants', method: 'post', data: { grants } });
}
export function executeRedisCommand(id: number | string, database: number, command: string, allowDangerous = false) {
  return request({ url: url + id + '/command', method: 'post', params: { database }, data: { command, allowDangerous }, timeout: 0 });
}
