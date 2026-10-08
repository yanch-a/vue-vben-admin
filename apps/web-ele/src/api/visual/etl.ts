/**
 * Lemon ETL 任务区 API 与协议类型。
 *
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = `${adminUrl}/etlWorkspace/`;

export interface EtlResource {
  kind: 'database' | string;
  bindingRef: string;
  displayName?: string;
  dbConfigId?: number | string;
  databaseTypeHint?: string;
  instance?: string;
  schema?: string;
  family?: string;
  dbType?: string;
  canWriteData?: boolean;
  /** Kettle 候选只含无凭据的库名提示，不是已授权绑定。 */
  instanceHint?: string;
}

export interface EtlNode {
  id: string;
  name?: string;
  type: string;
  typeVersion: number;
  resourceRef?: string;
  enabled?: boolean;
  config: Record<string, any>;
}

export interface EtlEdge {
  /** 由参数/输入引用生成的连线，引用改变时可自动移除。 */
  generated?: boolean;
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
  enabled?: boolean;
}

export interface EtlPipeline {
  id: string;
  name: string;
  enabled: boolean;
  databaseContextRef?: string;
  dependsOn: string[];
  nodes: EtlNode[];
  edges: EtlEdge[];
  execution?: Record<string, any>;
  ui?: Record<string, any>;
}

export interface EtlWorkspaceDocument {
  formatVersion: '1.0';
  workspace: { id: string; name: string; description?: string };
  resources: Record<string, EtlResource>;
  variables: Record<string, any>;
  pipelines: EtlPipeline[];
  extensions?: Record<string, any>;
}

export interface EtlWorkspaceRow {
  id: number | string;
  userId?: number | string;
  workspaceName: string;
  description?: string;
  draftJson?: string;
  revision: number;
  publishedVersion: number;
  status: 'DRAFT' | 'PUBLISHED';
  createTime?: string;
  updateTime?: string;
}

export interface EtlValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  pipelineCount: number;
  nodeCount: number;
}

export interface KettleImportResult {
  sourceType: 'KTR' | 'KJB';
  workspaceJson: string;
  convertedCount: number;
  partialCount: number;
  unsupportedCount: number;
  warnings: string[];
  connections: Array<{
    resourceRef: string;
    name: string;
    databaseType: string;
    instanceHint: string;
  }>;
  tasks: Array<{
    id: string;
    name: string;
    nodeCount: number;
    status: 'READY' | 'REVIEW' | 'DISABLED';
    issues: string[];
  }>;
}

/** 查询当前用户的任务区，列表不携带大 JSON。 */
export function listEtlWorkspaces() {
  return request({ url: `${url}list`, method: 'get' });
}

/** 获取任务区完整草稿。 */
export function getEtlWorkspace(id: number | string) {
  return request({ url: `${url}${encodeURIComponent(id)}`, method: 'get' });
}

/** 新建任务区。 */
export function createEtlWorkspace(data: {
  workspaceName: string;
  description?: string;
  draftJson?: string;
}) {
  return request({ url: `${url}create`, method: 'post', data });
}

/** 工作区只使用权限过滤后的轻量连接目录。 */
export function listEtlSources() {
  return request({ url: `${url}sources`, method: 'get' });
}
/** 返回扁平实例列表，已经按当前用户的实例授权过滤。 */
export function listEtlInstances(id: number | string) {
  return request({
    url: `${url}sources/${encodeURIComponent(id)}/instances`,
    method: 'get',
    timeout: 0,
  });
}
/** 返回指定实例的授权对象目录，包含真实 schema 与 qualifiedName。 */
export function listEtlTables(id: number | string, instance: string) {
  return request({
    url: `${url}sources/${encodeURIComponent(id)}/tables`,
    method: 'get',
    params: { instance },
    timeout: 0,
  });
}
/** 查询步骤预览，只读执行必要上游，不运行写入节点。 */
export function previewEtlStep(
  json: string,
  pipelineId: string,
  nodeId: string,
) {
  return request({
    url: `${url}preview`,
    method: 'post',
    data: { json, pipelineId, nodeId },
    timeout: 0,
  });
}
/** 执行已保存的 SQL 工作流。 */
export function executeEtlWorkflow(
  id: number | string,
  pipelineId: string,
  revision: number,
) {
  return request({
    url: `${url}${encodeURIComponent(id)}/pipelines/${encodeURIComponent(pipelineId)}/execute`,
    method: 'post',
    data: { revision },
    timeout: 0,
  });
}
/** 最近的工作区运行记录。 */
export function listEtlRuns(id: number | string) {
  return request({
    url: `${url}${encodeURIComponent(id)}/runs`,
    method: 'get',
    showErrorMessage: false,
  });
}

/** 分页获取任务/节点事件，长任务不一次下载全部日志。 */
export function listEtlRunLogs(id: string, page: number, nodeId?: string) {
  return request({
    url: `${url}runs/${encodeURIComponent(id)}/logs`,
    method: 'get',
    params: { page, size: 50, nodeId },
    showErrorMessage: false,
  });
}
/** 请求取消执行。 */
export function cancelEtlRun(id: string) {
  return request({
    url: `${url}runs/${encodeURIComponent(id)}/cancel`,
    method: 'post',
  });
}

export interface EtlConnectionOption {
  id: string;
  name: string;
  dbType: string;
  family: string;
  instanceKind: string;
  canWriteData: boolean;
}

export interface EtlRun {
  id: string;
  pipelineId: string;
  pipelineName: string;
  revision: number;
  status: string;
  stepsJson: string;
  message: string;
  startedAt: number;
  finishedAt?: number;
  cancelRequested: boolean;
}

/** 使用 revision 乐观锁保存草稿。 */
export function saveEtlWorkspace(data: {
  id: number | string;
  workspaceName: string;
  description?: string;
  draftJson: string;
  revision: number;
}) {
  return request({ url: `${url}save`, method: 'post', data });
}

/** 对页面、JSON 或 AI 产生的候选配置执行相同的服务端校验。 */
export function validateEtlWorkspace(json: string) {
  return request({ url: `${url}validate`, method: 'post', data: { json } });
}

/** 发布不可变版本。 */
export function publishEtlWorkspace(id: number | string) {
  return request({
    url: `${url}${encodeURIComponent(id)}/publish`,
    method: 'post',
  });
}

/** 从服务端已保存的 revision 运行一个 Pipeline，页面不直接提交数据库复制参数。 */
export function runEtlPipeline(
  id: number | string,
  pipelineId: string,
  revision: number,
) {
  return request({
    url: `${url}${encodeURIComponent(id)}/pipelines/${encodeURIComponent(pipelineId)}/run`,
    method: 'post',
    data: { revision },
    timeout: 0,
  });
}

/** 逻辑删除任务区。 */
export function deleteEtlWorkspace(id: number | string) {
  return request({ url: `${url}${encodeURIComponent(id)}`, method: 'delete' });
}

/** 上传单个 Kettle 文件并返回候选 JSON，不自动保存。 */
export function importKettleFile(file: File) {
  const data = new FormData();
  data.append('file', file);
  return request({
    url: `${url}import/kettle`,
    method: 'post',
    data,
    timeout: 0,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
