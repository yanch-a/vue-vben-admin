import { buildProxyTarget } from './server-url.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * 直接转发请求体流，避免把 SQL 备份/文件上传整体复制进主进程内存。
 * 注入 fetch 便于用本地 HTTP 服务验证流式传输、取消和错误传播。
 * @author yanch
 */
export function forwardApiRequest(request, serverUrl, fetcher) {
  const headers = new Headers(request.headers);
  for (const name of ['content-length', 'host', 'origin', 'referer', 'connection', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'upgrade']) headers.delete(name);
  const method = request.method.toUpperCase();
  const body = ['GET', 'HEAD'].includes(method) ? undefined : request.body;
  return fetcher(buildProxyTarget(serverUrl, request.url), {
    body,
    ...(body ? { duplex: 'half' } : {}),
    headers,
    method,
    // 上传流不能重放到另一个地址；无请求体的查询沿用原来的重定向行为。
    redirect: body ? 'error' : 'follow',
    signal: request.signal,
  });
}

/**
 * Electron net.fetch 的当前实现仍会缓存上传体；必须显式启用 net.request.chunkedEncoding。
 * 请求/响应都通过带背压的流传输，信号取消时销毁上游读取和网络请求。
 * @author yanch
 */
export function createStreamingFetch(requestFactory) {
  return (url, options) => new Promise((resolve, reject) => {
    const request = requestFactory({ url, method: options.method, headers: Object.fromEntries(options.headers), redirect: options.redirect, useSessionCookies: true });
    let source;
    let response;
    const signal = options.signal;
    const detach = () => signal?.removeEventListener('abort', abort);
    const fail = (error) => { source?.destroy(error); response?.destroy(error); reject(error); };
    const abort = () => { const error = signal?.reason || new DOMException('请求已取消', 'AbortError'); fail(error); request.abort(); };
    request.on('error', (error) => { detach(); fail(error); });
    request.on('abort', () => { detach(); fail(new DOMException('请求已取消', 'AbortError')); });
    request.on('response', (incoming) => {
      response = incoming;
      incoming.once('end', detach); incoming.once('close', detach);
      incoming.once('error', (error) => { detach(); reject(error); });
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const part of value) headers.append(key, part);
          else if (value !== undefined) headers.set(key, String(value));
        }
        // Chromium 已解压/去掉传输分块；自定义协议不能再次按旧编码解压已解码的字节。
        for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']) headers.delete(name);
        const body = options.method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming);
        if (!body) incoming.resume();
        resolve(new Response(body, { headers, status: incoming.statusCode, statusText: incoming.statusMessage }));
      } catch (error) { detach(); fail(error); request.abort(); }
    });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (options.body) {
      request.chunkedEncoding = true;
      source = Readable.fromWeb(options.body);
      pipeline(source, request).catch((error) => { detach(); fail(error); request.abort(); });
    } else request.end();
  });
}
