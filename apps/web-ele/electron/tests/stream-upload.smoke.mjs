import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { app, net } from 'electron';
import { createStreamingFetch, forwardApiRequest } from '../api-proxy.mjs';

/** 实际 Electron Chromium 网络层的分块上传冒烟，无窗口且仅连接本机临时 HTTP。@author yanch */
app.whenReady().then(async () => {
let release;
const firstReceived = new Promise((resolve) => { release = resolve; });
let bytes = 0;
const server = createServer((request, response) => {
  request.on('data', (chunk) => { bytes += chunk.length; release(); });
  request.on('end', () => { const data = gzipSync('ok'); response.setHeader('Content-Encoding', 'gzip'); response.setHeader('Content-Length', data.length); response.end(data); });
});
const timeout = setTimeout(() => { console.error('分块上传超时，第一块未及时到达服务端'); app.exit(1); }, 15000);
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let block = 0;
  const body = new ReadableStream({ async pull(controller) {
    if (block++ === 0) controller.enqueue(new Uint8Array(64 * 1024));
    else { await firstReceived; controller.enqueue(new Uint8Array(64 * 1024)); controller.close(); }
  } });
  const request = new Request('lemon://client/lmdb/upload', { method: 'POST', body, duplex: 'half' });
  const response = await forwardApiRequest(request, `http://127.0.0.1:${server.address().port}`, createStreamingFetch((options) => net.request(options)));
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(await response.text(), 'ok'); assert.equal(bytes, 128 * 1024);
  console.log('真实 Electron 分块上传通过：第一块收到后才生成第二块，无全量预读。');
  clearTimeout(timeout); server.closeAllConnections(); server.close(); app.exit(0);
} catch (error) { console.error(error); clearTimeout(timeout); server.close(); app.exit(1); }
});
