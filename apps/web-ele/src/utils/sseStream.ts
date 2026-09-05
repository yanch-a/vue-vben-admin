/**
 * 基于 fetch + ReadableStream 的 SSE 客户端（EventSource 无法带 lmtoken / POST）
 * 事件格式：event: xxx\ndata: {...}\n\n（兼容 CRLF）
 * @author yanch
 */
import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

export interface SseHandlers {
  onEvent: (event: string, data: any) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

/** 兼容后端把 JSON 又包成字符串的情况：'"{\"text\":\"a\"}"' → 对象 */
function parseSseData(raw: string): any {
  const text = (raw || '').replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  try {
    let parsed: any = JSON.parse(text);
    // 双重编码：解析后仍是 JSON 字符串，再解一层
    if (typeof parsed === 'string') {
      const inner = parsed.trim();
      if (
        (inner.startsWith('{') && inner.endsWith('}')) ||
        (inner.startsWith('[') && inner.endsWith(']'))
      ) {
        try {
          parsed = JSON.parse(inner);
        } catch {
          /* 保留字符串 */
        }
      }
    }
    return parsed;
  } catch {
    return text;
  }
}

function dispatchBlock(block: string, handlers: SseHandlers) {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return;
  handlers.onEvent(event, parseSseData(dataLines.join('\n')));
}

/**
 * 从缓冲中切出完整 SSE 事件（以空行分隔，兼容 \n\n 与 \r\n\r\n）
 */
function consumeSseBuffer(buf: string, handlers: SseHandlers): string {
  // 统一换行，再按空行切块
  const normalized = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let rest = normalized;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    if (block.trim()) dispatchBlock(block, handlers);
  }
  return rest;
}

export function sseFetch(
  url: string,
  body: any,
  handlers: SseHandlers,
  signal?: AbortSignal,
) {
  const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
  const token = useAccessStore().accessToken;
  const abs = `${String(apiURL || '').replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  return fetch(abs, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { lmtoken: token, Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
    .then(async (resp) => {
      if (!resp.ok || !resp.body) {
        let msg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          msg = j?.msg || j?.message || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          buf = consumeSseBuffer(buf, handlers);
        }
        // 流结束时冲掉可能残留的最后一块（无尾部空行）
        if (buf.trim()) dispatchBlock(buf, handlers);
        handlers.onClose?.();
      } catch (e: any) {
        if (signal?.aborted) handlers.onClose?.();
        else handlers.onError?.(e);
      }
    })
    .catch((e) => {
      if (signal?.aborted) handlers.onClose?.();
      else handlers.onError?.(e);
    });
}
