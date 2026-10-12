import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createStreamingFetch, forwardApiRequest } from '../api-proxy.mjs';

/** 隔离 HTTP 验证实际请求流，没有生成或上传业务文件。@author yanch */
test('第一块到达服务端后才产生第二块，保持上传顺序和认证头', async () => {
  let release;
  const firstReceived = new Promise((resolve) => { release = resolve; });
  const chunks = [];
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/upload');
    assert.equal(request.headers.authorization, 'Bearer fixture');
    request.on('data', (chunk) => { chunks.push(chunk); release(); });
    request.on('end', () => { response.end('ok'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let block = 0;
    const body = new ReadableStream({ async pull(controller) {
      if (block++ === 0) controller.enqueue(new TextEncoder().encode('first'));
      else { await firstReceived; controller.enqueue(new TextEncoder().encode('second')); controller.close(); }
    } });
    const request = new Request('lemon://client/lmdb/upload', { method: 'POST', body, duplex: 'half', headers: { authorization: 'Bearer fixture' } });
    const response = await forwardApiRequest(request, `http://127.0.0.1:${server.address().port}/api`,
      createStreamingFetch((options) => httpRequest(options.url, options)));
    assert.equal(await response.text(), 'ok');
    assert.equal(Buffer.concat(chunks).toString(), 'firstsecond');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

/** 上传取消销毁上游流，不能在用户停止后继续读完整备份文件。 */
test('取消流式上传会中止网络及上游读取', async () => {
  const controller = new AbortController(); let cancelled = false;
  const server = createServer((request) => { request.on('data', () => controller.abort()); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
    const request = new Request('lemon://client/lmdb/upload', { method: 'POST', body, duplex: 'half', signal: controller.signal });
    await assert.rejects(forwardApiRequest(request, `http://127.0.0.1:${server.address().port}`, createStreamingFetch((options) => httpRequest(options.url, options))), { name: 'AbortError' });
    for (let i = 0; i < 10 && !cancelled; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled, true);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

/** 不消耗 GET body，保留取消信号；禁止无法安全重放的上传重定向。 */
test('取消信号、重定向策略与无请求体的方法传递给网络层', async () => {
  const controller = new AbortController();
  const request = new Request('lemon://client/lmdb/query', { signal: controller.signal });
  await forwardApiRequest(request, 'http://localhost:8080/api', async (_target, options) => {
    assert.equal(options.body, undefined); assert.equal(options.redirect, 'follow');
    controller.abort(); assert.equal(options.signal.aborted, true);
    return new Response('ok');
  });
});
