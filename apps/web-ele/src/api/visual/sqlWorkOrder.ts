import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/sqlWorkOrder/';

export interface SqlWorkOrder {
  id: number | string;
  title: string;
  dbConfigId: number | string;
  instanceName: string;
  dbType: string;
  scriptText?: string;
  scriptHash?: string;
  status: string;
  currentVersion: number;
  riskLevel?: string;
  riskScore?: number;
  aiAuditReport?: string;
  submitterName?: string;
  reviewerName?: string;
  reviewComment?: string;
  rollbackComplete?: number;
  executionMessage?: string;
  createTime?: string;
  updateTime?: string;
}

export function workOrderCapabilities() {
  return request({ url: url + 'capabilities', method: 'get' });
}

export function workOrderPage(params: Record<string, any>) {
  return request({ url: url + 'page', method: 'get', params });
}

export function workOrderDetail(id: number | string) {
  return request({ url: url + id, method: 'get' });
}

export function saveWorkOrder(data: Record<string, any>) {
  return request({ url: url + 'save', method: 'post', data });
}

export function submitWorkOrder(id: number | string) {
  return request({ url: url + id + '/submit', method: 'post' });
}

export function auditWorkOrder(id: number | string, data: Record<string, any>) {
  return request({ url: url + id + '/audit', method: 'post', data, timeout: 120_000 });
}

export function reviewWorkOrder(id: number | string, data: Record<string, any>) {
  return request({ url: url + id + '/review', method: 'post', data });
}

export function executeWorkOrder(id: number | string, allowIncompleteRollback: boolean) {
  return request({
    url: url + id + '/execute',
    method: 'post',
    data: { allowIncompleteRollback },
    timeout: 120_000,
  });
}

export function downloadWorkOrderRollback(id: number | string) {
  return request({ url: url + id + '/rollback', method: 'get', responseType: 'blob' });
}
