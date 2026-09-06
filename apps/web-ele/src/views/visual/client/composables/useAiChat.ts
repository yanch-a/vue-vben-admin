/**
 * AI 会话状态机，消费 POST /admin/aiAgent/chat/stream 的 SSE。
 * 事件与后端 SseAgentEventSink 对齐：run.start / message.delta / reasoning.delta /
 * tool.call / tool.result / sql.proposed / config.proposed / chart / error / run.cancelled / done。
 * sql.proposed → AiSqlCard；config.proposed → AiQueryConfigCard → 应用到界面。
 * @author yanch
 */
import { ref, triggerRef } from 'vue';

import {
  cancelAgentRun,
  listConversationMessages,
  streamAgentChat,
  type AgentChatRequest,
  type AgentScene,
} from '#/api/ai/agent';

export interface AiToolStep {
  callId: string;
  name: string;
  arguments: any;
  ok?: boolean;
  elapsedMs?: number;
  data?: any;
  truncated?: boolean;
}

export interface AiMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  steps: AiToolStep[];
  sql?: {
    sql: string;
    explanation: string;
    warnings?: string[];
    writeOperation?: boolean;
    replaceSelection?: boolean;
  };
  /** propose_query_config 产物，结构对齐 restoreFromConfigVo */
  queryConfig?: {
    explanation?: string;
    warnings?: string[];
    previewSql?: string;
    selectDistinct?: number;
    groupId?: number | string;
    columnItems?: any[];
    whereItems?: any[];
    havingItems?: any[];
    groupItems?: any[];
    orderItems?: any[];
  };
  chart?: { title: string; sql: string; spec: any; columns: string[]; rows: any[] };
  error?: string;
  done: boolean;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(raw: any) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return raw;
  }
}

/** 从 SSE data 里取出增量文本（兼容双重 JSON / 纯字符串） */
function pickDeltaText(data: any): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.content === 'string') return data.content;
  return '';
}

/** 规范化 config.proposed 载荷，兼容扁平 items */
function pickProposedQueryConfig(data: any): AiMsg['queryConfig'] | undefined {
  if (!data) return undefined;
  let obj = data;
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const split = (type: string) =>
    Array.isArray(obj.items)
      ? obj.items.filter((it: any) => String(it?.queryType || '').toUpperCase() === type)
      : [];
  const columnItems = Array.isArray(obj.columnItems) ? obj.columnItems : split('COLUMN');
  const whereItems = Array.isArray(obj.whereItems) ? obj.whereItems : split('WHERE');
  const havingItems = Array.isArray(obj.havingItems) ? obj.havingItems : split('HAVING');
  const groupItems = Array.isArray(obj.groupItems) ? obj.groupItems : split('GROUP');
  const orderItems = Array.isArray(obj.orderItems) ? obj.orderItems : split('ORDER');
  if (
    !columnItems.length &&
    !whereItems.length &&
    !havingItems.length &&
    !groupItems.length &&
    !orderItems.length &&
    !obj.previewSql
  ) {
    return undefined;
  }
  return {
    explanation: obj.explanation != null ? String(obj.explanation) : '',
    warnings: Array.isArray(obj.warnings) ? obj.warnings : undefined,
    previewSql: obj.previewSql != null ? String(obj.previewSql) : '',
    selectDistinct: obj.selectDistinct ? 1 : 0,
    groupId: obj.groupId,
    columnItems,
    whereItems,
    havingItems,
    groupItems,
    orderItems,
  };
}

/** 规范化 sql.proposed 载荷 */
function pickProposedSql(data: any): AiMsg['sql'] | undefined {
  if (!data) return undefined;
  let obj = data;
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data);
    } catch {
      return { sql: data, explanation: '' };
    }
  }
  const sql = obj?.sql ?? obj?.sqlText;
  if (sql == null || sql === '') return undefined;
  return {
    sql: String(sql),
    explanation: obj.explanation != null ? String(obj.explanation) : '',
    warnings: Array.isArray(obj.warnings) ? obj.warnings : undefined,
    writeOperation: !!obj.writeOperation,
    replaceSelection: !!obj.replaceSelection,
  };
}

export function useAiChat(getCtx: () => { dbConfigId: any; instanceName: string; modelId: any }) {
  const messages = ref<AiMsg[]>([]);
  const running = ref(false);
  const conversationId = ref<number | string | undefined>();
  let abort: null | (() => void) = null;
  let runId = '';
  /** 当前助手消息在数组中的下标，便于原地更新后 triggerRef */
  let curIdx = -1;

  function touch() {
    triggerRef(messages);
  }

  function curMsg(): AiMsg | null {
    return curIdx >= 0 ? messages.value[curIdx] || null : null;
  }

  function send(text: string, scene: AgentScene, context?: AgentChatRequest['context']) {
    const ctx = getCtx();
    if (!ctx.dbConfigId || !ctx.instanceName || !ctx.modelId) {
      throw new Error('请先选择连接、实例和模型');
    }
    // 先落用户气泡，再占一条空助手气泡；后续 SSE 都改这条（用 curIdx 原地更新）
    messages.value.push({ id: uid(), role: 'user', text, steps: [], done: true });
    const cur: AiMsg = {
      id: uid(),
      role: 'assistant',
      text: '',
      steps: [],
      done: false,
    };
    messages.value.push(cur);
    curIdx = messages.value.length - 1;
    touch();
    running.value = true;
    abort = streamAgentChat(
      {
        ...ctx,
        conversationId: conversationId.value,
        scene,
        message: text,
        context,
      },
      {
        onEvent(event, data) {
          const msg = curMsg();
          if (!msg) return;
          switch (event) {
            case 'run.start':
              // 后续点「停止」要靠这个 runId 调 cancel
              runId = data?.runId || '';
              if (data?.conversationId != null) {
                conversationId.value = data.conversationId;
              }
              break;
            case 'message.delta':
              // 增量追加，不要整段覆盖，否则流式会闪
              msg.text += pickDeltaText(data);
              touch();
              break;
            case 'reasoning.delta':
              msg.reasoning = (msg.reasoning || '') + pickDeltaText(data);
              touch();
              break;
            case 'tool.call':
              msg.steps.push({
                callId: data?.callId || uid(),
                name: data?.name || 'tool',
                arguments: safeJson(data?.arguments),
              });
              touch();
              break;
            case 'tool.result': {
              // 按 callId 回填同一条 step，不要再 push 一条
              const s = msg.steps.find((x) => x.callId === data?.callId);
              if (s) {
                Object.assign(s, {
                  ok: data?.ok,
                  elapsedMs: data?.elapsedMs,
                  data: data?.data,
                  truncated: data?.truncated,
                });
                touch();
              }
              break;
            }
            case 'sql.proposed': {
              const proposed = pickProposedSql(data);
              if (proposed) {
                msg.sql = proposed;
                touch();
              }
              break;
            }
            case 'config.proposed': {
              const proposed = pickProposedQueryConfig(data);
              if (proposed) {
                msg.queryConfig = proposed;
                touch();
              }
              break;
            }
            case 'chart':
              msg.chart = typeof data === 'string' ? safeJson(data) : data;
              touch();
              break;
            case 'error':
              msg.error =
                (typeof data === 'string' ? data : data?.message) || '未知错误';
              touch();
              break;
            case 'run.cancelled':
              msg.error = '已停止';
              touch();
              break;
            default:
              break;
          }
        },
        onError(e) {
          const msg = curMsg();
          if (msg) msg.error = e.message;
          finish();
        },
        onClose() {
          finish();
        },
      },
    );
    function finish() {
      // done / onClose / onError 都会进这里：标记气泡完成并放开输入框
      const msg = curMsg();
      if (msg) msg.done = true;
      running.value = false;
      abort = null;
      touch();
    }
  }

  function stop() {
    if (runId) cancelAgentRun(runId).catch(() => {});
    abort?.();
  }

  function newConversation() {
    conversationId.value = undefined;
    messages.value = [];
    curIdx = -1;
  }

  async function loadConversation(id: number | string) {
    const res: any = await listConversationMessages(id);
    const list = res?.data || [];
    conversationId.value = id;
    const out: AiMsg[] = [];
    let cur: AiMsg | null = null;
    // 库里 user/assistant/tool 是平铺行；前端要把紧随 assistant 的 tool 行叠进 steps
    for (const m of list) {
      if (m.role === 'user') {
        out.push({ id: String(m.id), role: 'user', text: m.content || '', steps: [], done: true });
        cur = null;
      } else if (m.role === 'assistant') {
        cur = {
          id: String(m.id),
          role: 'assistant',
          text: m.content || '',
          reasoning: m.reasoning,
          steps: [],
          done: true,
        };
        if (m.attachments) {
          try {
            const att = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
            if (att.proposedSql) cur.sql = pickProposedSql(att.proposedSql);
            if (att.proposedQueryConfig) {
              cur.queryConfig = pickProposedQueryConfig(att.proposedQueryConfig);
            }
            if (att.chart) cur.chart = att.chart;
          } catch {
            /* ignore */
          }
        }
        out.push(cur);
      } else if (m.role === 'tool' && cur) {
        cur.steps.push({
          callId: m.toolCallId,
          name: m.toolName,
          arguments: {},
          ok: true,
          data: m.content,
        });
      }
    }
    messages.value = out;
    curIdx = -1;
  }

  return { messages, running, conversationId, send, stop, newConversation, loadConversation };
}
