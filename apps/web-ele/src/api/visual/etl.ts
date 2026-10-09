/**
 * Lemon ETL 任务区 API 与协议类型。
 *
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const url = `${adminUrl}/etlWorkspace/`;

/** 定时计划中单个工作区步骤（前置或本工作区）。 */
export interface EtlScheduleStep {
  workspaceId: string | number;
  publishedVersion: number;
  pipelineIds: string[];
  workspaceName?: string;
  latestPublishedVersion?: number;
  pipelines?: Array<{ id: string; name: string; enabled: boolean }>;
  latestPipelines?: Array<{ id: string; name: string; enabled: boolean }>;
  /** 前置工作区已删除或无权访问时为 true，需移除后才能保存。 */
  missing?: boolean;
}

/** 工作区独立定时计划，绑定已发布版本而非编辑中的草稿。 */
export interface EtlScheduleConfig {
  enabled: boolean;
  revision: number;
  publishedVersion: number;
  pipelineIds: string[];
  /** 前置工作区，按序先于本工作区执行；空则仅跑本工作区。 */
  preSteps: EtlScheduleStep[];
  mode: 'ONCE' | 'DAILY' | 'WEEKLY' | 'INTERVAL' | 'CRON';
  timeZone: string;
  cronExpression?: string;
  timeOfDay?: string;
  weekDays: number[];
  intervalMinutes?: number;
  runAt?: number;
}

/** 服务端计划状态和下一次时间，数组以持久化 JSON 返回。 */
export interface EtlScheduleRow extends Omit<
  EtlScheduleConfig,
  'pipelineIds' | 'weekDays' | 'preSteps'
> {
  workspaceId: string | number;
  pipelineIdsJson: string;
  stepsJson?: string;
  weekDaysJson: string;
  nextFireAt?: number;
}

/** 一次定时触发批次，可从运行 ID 跳转原任务与节点日志。 */
export interface EtlScheduleFire {
  id: string;
  publishedVersion: number;
  status: string;
  message?: string;
  scheduledAt: number;
  runIdsJson: string;
  jobsJson?: string;
  currentRunId?: string;
  nextIndex: number;
}

export interface EtlSchedulePeerWorkspace {
  id: string | number;
  workspaceName: string;
  publishedVersion: number;
  latestPipelines: Array<{ id: string; name: string; enabled: boolean }>;
}

export interface EtlScheduleDetail {
  schedule?: EtlScheduleRow;
  publishedVersion: number;
  pipelines: Array<{ id: string; name: string; enabled: boolean }>;
  latestPipelines: Array<{ id: string; name: string; enabled: boolean }>;
  /** 已保存的前置步骤视图（含任务选项）。 */
  preSteps?: EtlScheduleStep[];
  /** 可选用的其他已发布工作区。 */
  peerWorkspaces?: EtlSchedulePeerWorkspace[];
  recentFires: EtlScheduleFire[];
}

/** 当前用户工作区的计划和已发布任务选项。 */
export function getEtlSchedule(id: string | number) {
  return request({
    url: `${url}${encodeURIComponent(id)}/schedule`,
    method: 'get',
  });
}

/** 直接读取运行详情，历史计划即使超出最近一百条也能查看节点日志。 */
export function getEtlRun(id: string) {
  return request({
    url: `${url}runs/${encodeURIComponent(id)}`,
    method: 'get',
  });
}

/** 保存后由后台调度，不需要浏览器保持打开。 */
export function saveEtlSchedule(id: string | number, data: EtlScheduleConfig) {
  return request({
    url: `${url}${encodeURIComponent(id)}/schedule`,
    method: 'post',
    data,
  });
}

/** 独立暂停，不重置已经过去的一次性规则。 */
export function pauseEtlSchedule(id: string | number, revision: number) {
  return request({
    url: `${url}${encodeURIComponent(id)}/schedule/pause`,
    method: 'post',
    data: { revision },
  });
}

/** 纯时间预览，不改变计划或触发同步。 */
export function previewEtlSchedule(data: EtlScheduleConfig) {
  return request({ url: `${url}schedule/preview`, method: 'post', data });
}

/** 工作区失败通知开关；渠道 Webhook 在用户级消息渠道中维护。 */
export interface EtlNotifyConfig {
  enabled: boolean;
  onFailure: boolean;
  /** 雪花 ID 用字符串，避免 JS 精度丢失。 */
  channelIds: Array<string | number>;
  revision: number;
}

export interface NotifyChannelRow {
  id: number | string;
  channelType: 'WECOM' | 'DINGTALK' | 'FEISHU' | string;
  channelName: string;
  enabled: boolean;
  webhookUrl: string;
  /** 机器人安全关键词；发送时若正文没有会自动补上 */
  keyword?: string;
  secretConfigured?: boolean;
}

export interface EtlNotifyDetail {
  notify?: {
    workspaceId: number | string;
    enabled: boolean;
    onFailure: boolean;
    channelIdsJson: string;
    revision: number;
  };
  channels: NotifyChannelRow[];
}

export function getEtlNotify(id: string | number) {
  return request({
    url: `${url}${encodeURIComponent(id)}/notify`,
    method: 'get',
  });
}

export function saveEtlNotify(id: string | number, data: EtlNotifyConfig) {
  return request({
    url: `${url}${encodeURIComponent(id)}/notify`,
    method: 'post',
    data,
  });
}

/** 在 EtlWorkspace:notify 权限下维护渠道，无需单独授予 NotifyChannel。 */
export interface EtlNotifyChannelSave {
  id?: number | string;
  channelType: 'WECOM' | 'DINGTALK' | 'FEISHU';
  channelName: string;
  enabled: boolean;
  webhookUrl: string;
  /** 空字符串表示清空；不传表示不修改 */
  keyword?: string;
  secretInput?: string;
  /** 清空已存加签密钥 */
  clearSecret?: boolean;
}

export function saveEtlNotifyChannel(data: EtlNotifyChannelSave) {
  return request({ url: `${url}notify/channels`, method: 'post', data });
}

export function deleteEtlNotifyChannel(channelId: string | number) {
  return request({
    url: `${url}notify/channels/${encodeURIComponent(channelId)}`,
    method: 'delete',
  });
}

export function testEtlNotifyChannel(channelId: string | number) {
  return request({
    url: `${url}notify/channels/${encodeURIComponent(channelId)}/test`,
    method: 'post',
    data: {},
  });
}

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
