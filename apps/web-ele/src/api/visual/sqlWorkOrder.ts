import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = adminUrl + '/sqlWorkOrder/';

export interface SqlAuditHit {
  ruleCode?: string;
  severity?: string;
  message?: string;
}

export interface StatementAuditFinding {
  statementIndex: number;
  sqlPreview?: string;
  statementKind?: string;
  hits?: SqlAuditHit[];
  estimatedRows?: number | null;
  estimatedRowsStatus?: string;
  estimatedRowsNote?: string;
  status?: string;
}

/** 审计流水线单步 */
export interface SqlAuditStep {
  code?: string;
  title?: string;
  status?: string;
  detail?: string;
  durationMs?: number;
}

/** 规则覆盖统计 */
export interface SqlAuditCoverage {
  totalRules?: number;
  activeRules?: number;
  hitRules?: number;
  cleanRules?: number;
  skippedByDialect?: number;
  disabledRules?: number;
  hitRuleCodes?: string[];
  skippedRuleCodes?: string[];
}

/** AI 审计接口完整返回 */
export interface SqlAuditResult {
  order?: SqlWorkOrder;
  steps?: SqlAuditStep[];
  coverage?: SqlAuditCoverage;
  ruleReportMarkdown?: string;
  aiAdviceMarkdown?: string;
  question?: string;
  modelId?: number | string;
  modelName?: string;
  durationMs?: number;
  errorCount?: number;
  warningCount?: number;
  statementFindings?: StatementAuditFinding[];
  ruleHits?: SqlAuditHit[];
  /** RULES | AI_AUDIT */
  phase?: string;
  /** success | failed | skipped | pending */
  aiStatus?: string;
  aiError?: string;
}

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
  aiModelId?: number | string;
  aiAuditReport?: string;
  ruleHitsJson?: string;
  statementFindingsJson?: string;
  auditDetail?: string;
  forceSubmitted?: number;
  ignoreWarnings?: number;
  failFast?: number;
  scheduledExecuteAt?: string;
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

export function workOrderPage(
  params: Record<string, any>,
  showErrorMessage = true,
) {
  return request({
    url: url + 'page',
    method: 'get',
    params,
    showErrorMessage,
  });
}

export function workOrderDetail(
  id: number | string,
  showErrorMessage = true,
) {
  return request({
    url: url + id,
    method: 'get',
    showErrorMessage,
  });
}

export function saveWorkOrder(data: Record<string, any>) {
  return request({ url: url + 'save', method: 'post', data });
}

export function submitWorkOrder(
  id: number | string,
  data?: { forceSubmit?: boolean; forceReason?: string },
) {
  return request({ url: url + id + '/submit', method: 'post', data: data || {} });
}

/** 规则预审（快路径）：立即返回规则步骤与报告，不调大模型 */
export function auditWorkOrderRules(id: number | string) {
  return request({ url: url + id + '/audit/rules', method: 'post', timeout: 60_000 });
}

export function auditWorkOrder(id: number | string, data: Record<string, any>) {
  return request({ url: url + id + '/audit', method: 'post', data, timeout: 120_000 });
}

export function reviewWorkOrder(id: number | string, data: Record<string, any>) {
  return request({ url: url + id + '/review', method: 'post', data });
}

export function executeWorkOrder(
  id: number | string,
  allowIncompleteRollback: boolean,
  extra?: { ignoreWarnings?: boolean; failFast?: boolean },
) {
  return request({
    url: url + id + '/execute',
    method: 'post',
    data: { allowIncompleteRollback, ...(extra || {}) },
    timeout: 120_000,
  });
}

export function downloadWorkOrderRollback(id: number | string) {
  return request({ url: url + id + '/rollback', method: 'get', responseType: 'blob' });
}
