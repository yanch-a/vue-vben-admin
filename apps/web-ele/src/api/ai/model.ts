/**
 * AI 厂商 / 模型维护 API
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const pUrl = adminUrl + '/aiProvider/';
const mUrl = adminUrl + '/aiModel/';

export function listProviders() {
  return request({ url: pUrl + 'list', method: 'get' });
}

export function saveProvider(data: any) {
  return request({ url: pUrl + 'save', method: 'post', data });
}

export function deleteProvider(id: number | string) {
  return request({ url: pUrl + 'del/' + id, method: 'get' });
}

export function initBuiltinProviders() {
  return request({ url: pUrl + 'initBuiltin', method: 'post' });
}

export function testProvider(data: { providerId: number | string; modelCode?: string }) {
  return request({ url: pUrl + 'test', method: 'post', data });
}

export function fetchProviderModels(data: { providerId: number | string }) {
  return request({ url: pUrl + 'fetchModels', method: 'post', data });
}

export function listModels(providerId: number | string) {
  return request({ url: mUrl + 'list', method: 'get', params: { providerId } });
}

export function saveModel(data: any) {
  return request({ url: mUrl + 'save', method: 'post', data });
}

export function deleteModel(id: number | string) {
  return request({ url: mUrl + 'del/' + id, method: 'get' });
}

export function setDefaultModel(id: number | string) {
  return request({ url: mUrl + 'setDefault/' + id, method: 'post' });
}

export function batchSaveModels(data: { providerId: number | string; modelCodes: string[] }) {
  return request({ url: mUrl + 'batchSave', method: 'post', data });
}

export function listSelectableModels() {
  return request({ url: mUrl + 'selectable', method: 'get' });
}
