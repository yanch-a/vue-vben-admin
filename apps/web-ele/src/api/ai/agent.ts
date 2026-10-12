/**
 * 数据库 AI 智能体 API
 * - stream/cancel → AgentController
 * - 会话列表/消息 → AiConversationController
 * - feedbackSchemaDoc → SchemaDocController.feedback（跑成功 AI SQL 后补 JOIN）
 * - saveChart → AiChartController
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';
import { sseFetch, type SseHandlers } from '#/utils/sseStream';

const url = adminUrl + '/aiAgent/';
const convUrl = adminUrl + '/aiConversation/';
const schemaUrl = adminUrl + '/aiSchemaDoc/';
const chartUrl = adminUrl + '/aiChart/';

export type AgentScene = 'sql' | 'chart' | 'schema_doc' | 'etl' | 'free';

export interface AgentChatRequest {
  conversationId?: number | string;
  dbConfigId: number | string;
  instanceName: string;
  modelId: number | string;
  /** 是否允许当前对话将真实样例行发送给模型；未传时后端继承数据库配置。 */
  allowSampleData?: boolean;
  scene: AgentScene;
  message: string;
  context?: {
    selectedSql?: string;
    editorSql?: string;
    lastError?: string;
    resultColumns?: string[];
    /** visual=配置查询（勾选），sql=SQL 编辑器 */
    workMode?: 'visual' | 'sql' | string;
    groupId?: number | string;
    canvasGroupIds?: Array<number | string>;
    selectedFields?: Array<{
      fieldId?: number | string;
      table?: string;
      column?: string;
      displayName?: string;
    }>;
    draftItems?: any[];
    /** ETL 场景传递当前完整草稿；使用字符串避免客户端 JSON 被请求库再次改写。 */
    etlWorkspace?: string;
    skillIds?: string[];
    /** 用户在输入框用 @ 显式引用的表名，后端优先注入这些表的结构文档 */
    mentionedTables?: string[];
  };
}

/** propose_sql 服务端校验结果，AiSqlCard 据此显示徽标 */
export interface ProposedSqlValidation {
  /** passed=已验证通过 estimated=写操作已估算影响行数 failed=校验未通过 skipped=未校验 */
  status: 'estimated' | 'failed' | 'passed' | 'skipped';
  /** run_sql=本轮真实执行过 explain=EXPLAIN 干跑 */
  method?: 'explain' | 'run_sql';
  /** 校验失败原因或跳过原因 */
  message?: string;
  reason?: string;
  /** 优化器估算行数（只读为结果行数，写操作为影响行数） */
  estimatedRows?: number;
}

/** 获取服务端允许按需加载的技能目录，不接收任意文件路径。 */
export function listAgentSkills(scene: string) {
  return request({ url: url + 'skills', method: 'get', params: { scene } });
}

/** 流式对话；返回 abort 函数 */
export function streamAgentChat(req: AgentChatRequest, handlers: SseHandlers) {
  const ac = new AbortController();
  sseFetch(url + 'chat/stream', req, handlers, ac.signal);
  return () => ac.abort();
}

export function cancelAgentRun(runId: string) {
  return request({ url: url + 'cancel', method: 'post', data: { runId } });
}

export function listConversations(params: {
  dbConfigId?: number | string;
  scene?: string;
}) {
  return request({ url: convUrl + 'list', method: 'get', params });
}

export function listConversationMessages(id: number | string) {
  return request({ url: convUrl + id + '/messages', method: 'get' });
}

export function deleteConversation(id: number | string) {
  return request({ url: convUrl + 'del/' + id, method: 'get' });
}

export function feedbackSchemaDoc(data: {
  dbConfigId: number | string;
  instanceName: string;
  sql: string;
}) {
  return request({ url: schemaUrl + 'feedback', method: 'post', data });
}

export function saveChart(data: {
  title: string;
  sqlText: string;
  chartSpec: string;
  dbConfigId: number | string;
  instanceName?: string;
  conversationId?: number | string;
}) {
  return request({ url: chartUrl + 'save', method: 'post', data });
}
