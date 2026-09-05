/**
 * AI 会话状态机：消费 SSE 事件
 * @author yanch
 */
import { reactive, ref } from 'vue';

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

export function useAiChat(getCtx: () => { dbConfigId: any; instanceName: string; modelId: any }) {
  const messages = ref<AiMsg[]>([]);
  const running = ref(false);
  const conversationId = ref<number | string | undefined>();
  let abort: null | (() => void) = null;
  let runId = '';

  function send(text: string, scene: AgentScene, context?: AgentChatRequest['context']) {
    const ctx = getCtx();
    if (!ctx.dbConfigId || !ctx.instanceName || !ctx.modelId) {
      throw new Error('请先选择连接、实例和模型');
    }
    messages.value.push({ id: uid(), role: 'user', text, steps: [], done: true });
    const cur: AiMsg = reactive({
      id: uid(),
      role: 'assistant',
      text: '',
      steps: [],
      done: false,
    });
    messages.value.push(cur);
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
          switch (event) {
            case 'run.start':
              runId = data.runId;
              conversationId.value = data.conversationId;
              break;
            case 'message.delta':
              cur.text += data.text || '';
              break;
            case 'reasoning.delta':
              cur.reasoning = (cur.reasoning || '') + (data.text || '');
              break;
            case 'tool.call':
              cur.steps.push({
                callId: data.callId,
                name: data.name,
                arguments: safeJson(data.arguments),
              });
              break;
            case 'tool.result': {
              const s = cur.steps.find((x) => x.callId === data.callId);
              if (s) {
                Object.assign(s, {
                  ok: data.ok,
                  elapsedMs: data.elapsedMs,
                  data: data.data,
                  truncated: data.truncated,
                });
              }
              break;
            }
            case 'sql.proposed':
              cur.sql = data;
              break;
            case 'chart':
              cur.chart = data;
              break;
            case 'error':
              cur.error = data?.message || '未知错误';
              break;
            case 'run.cancelled':
              cur.error = '已停止';
              break;
            default:
              break;
          }
        },
        onError(e) {
          cur.error = e.message;
          finish();
        },
        onClose() {
          finish();
        },
      },
    );
    function finish() {
      cur.done = true;
      running.value = false;
      abort = null;
    }
  }

  function stop() {
    if (runId) cancelAgentRun(runId).catch(() => {});
    abort?.();
  }

  function newConversation() {
    conversationId.value = undefined;
    messages.value = [];
  }

  async function loadConversation(id: number | string) {
    const res: any = await listConversationMessages(id);
    const list = res?.data || [];
    conversationId.value = id;
    const out: AiMsg[] = [];
    let cur: AiMsg | null = null;
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
            if (att.proposedSql) cur.sql = att.proposedSql;
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
  }

  return { messages, running, conversationId, send, stop, newConversation, loadConversation };
}
