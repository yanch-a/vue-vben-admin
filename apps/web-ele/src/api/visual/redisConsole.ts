import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/redisConsole/';

export function redisConnections() { return request({ url: url + 'connections', method: 'get' }); }
export function saveRedisConnection(data: Record<string, any>) { return request({ url: url + 'connection', method: 'post', data }); }
export function deleteRedisConnection(id: number | string) { return request({ url: url + 'connection/' + id, method: 'delete' }); }
export function testRedisConnection(id: number | string) { return request({ url: url + 'connection/' + id + '/test', method: 'get', timeout: 30_000 }); }
export function getRedisDatabases(id: number | string) { return request({ url: url + 'connection/' + id + '/databases', method: 'get', timeout: 30_000 }); }
export function getRedisInfo(id: number | string) { return request({ url: url + 'connection/' + id + '/info', method: 'get', timeout: 30_000 }); }
export function scanRedisKeys(id: number | string, database: number, pattern: string) {
  return request({ url: url + id + '/keys', method: 'get', params: { database, pattern, count: 500 } });
}
export function getRedisKey(id: number | string, database: number, key: string) {
  return request({ url: url + id + '/key', method: 'get', params: { database, key } });
}
export function saveRedisKey(id: number | string, database: number, data: Record<string, any>) {
  return request({ url: url + id + '/key', method: 'post', params: { database }, data });
}
export function deleteRedisKey(id: number | string, database: number, key: string) {
  return request({ url: url + id + '/key', method: 'delete', params: { database, key } });
}
export function updateRedisKeyMeta(id: number | string, database: number, key: string, data: Record<string, any>) {
  return request({ url: url + id + '/key/meta', method: 'put', params: { database, key }, data });
}
export function executeRedisCommand(id: number | string, database: number, command: string, allowDangerous = false) {
  return request({ url: url + id + '/command', method: 'post', params: { database }, data: { command, allowDangerous } });
}
