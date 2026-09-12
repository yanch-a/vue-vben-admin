import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProxyTarget, normalizeServerUrl } from '../server-url.mjs';

test('normalizeServerUrl 保留 context-path 并移除尾部斜杠', () => {
  assert.equal(
    normalizeServerUrl(' https://example.com:8443/lmdb/ '),
    'https://example.com:8443/lmdb',
  );
});

test('normalizeServerUrl 拒绝非 http(s) 和带凭据的地址', () => {
  assert.throws(() => normalizeServerUrl('file:///tmp/api'), /仅支持/);
  assert.throws(
    () => normalizeServerUrl('https://user:secret@example.com/lmdb'),
    /不能包含用户名或密码/,
  );
});

test('buildProxyTarget 正确映射路径和查询参数', () => {
  assert.equal(
    buildProxyTarget(
      'https://api.example.com/lmdb',
      'lemon://app/lmdb/admin/user/getPage?page=2&size=20',
    ),
    'https://api.example.com/lmdb/admin/user/getPage?page=2&size=20',
  );
});

test('buildProxyTarget 不接受静态资源路径', () => {
  assert.throws(
    () => buildProxyTarget('https://api.example.com/lmdb', 'lemon://app/assets/app.js'),
    /不是可代理的 API 路径/,
  );
});
