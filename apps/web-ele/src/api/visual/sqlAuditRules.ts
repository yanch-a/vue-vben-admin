import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/sqlAuditRule/';

export interface SqlAuditRuleVO {
  code: string;
  name?: string;
  description?: string;
  /** ERROR | WARNING | OFF */
  severity?: string;
  enabled?: boolean;
  dialects?: string[];
  scoreWeight?: number;
  /** builtin | override */
  source?: string;
}

export interface SqlAuditRuleUpdatePayload {
  code: string;
  severity?: string;
  enabled?: boolean;
  description?: string;
  scoreWeight?: number;
}

export function listSqlAuditRules(showErrorMessage = true) {
  return request({
    url: url + 'list',
    method: 'get',
    showErrorMessage,
  });
}

export function updateSqlAuditRule(data: SqlAuditRuleUpdatePayload) {
  return request({
    url: url + 'override',
    method: 'put',
    data,
  });
}

export function updateSqlAuditRulePost(data: SqlAuditRuleUpdatePayload) {
  return request({
    url: url + 'override',
    method: 'post',
    data,
  });
}

export function batchUpdateSqlAuditRules(rules: SqlAuditRuleUpdatePayload[]) {
  return request({
    url: url + 'override/batch',
    method: 'post',
    data: { rules },
  });
}

export function resetSqlAuditRule(code: string) {
  return request({
    url: url + encodeURIComponent(code) + '/reset',
    method: 'post',
  });
}
