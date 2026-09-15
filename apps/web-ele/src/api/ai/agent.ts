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

export type AgentScene = 'sql' | 'chart' | 'schema_doc' | 'free';

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
  };
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

export function listConversations(params: { dbConfigId?: number | string; scene?: string }) {
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
