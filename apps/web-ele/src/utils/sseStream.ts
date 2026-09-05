/**
 * 基于 fetch + ReadableStream 的 SSE 客户端（EventSource 无法带 lmtoken / POST）
 * 事件格式：event: xxx\ndata: {...}\n\n
 * @author yanch
 */
import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

export interface SseHandlers {
  onEvent: (event: string, data: any) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
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
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            const dataLines: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
            }
            if (!dataLines.length) continue;
            const raw = dataLines.join('\n');
            let data: any = raw;
            try {
              data = JSON.parse(raw);
            } catch {
              /* keep string */
            }
            handlers.onEvent(event, data);
          }
        }
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
