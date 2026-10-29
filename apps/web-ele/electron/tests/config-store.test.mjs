import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ServerConfigStore } from '../config-store.mjs';

/** 为单个用例创建并自动清理隔离的临时配置目录。 */
async function createFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lemon-electron-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const configFile = path.join(directory, 'server-config.json');
  return { configFile, store: new ServerConfigStore(configFile) };
}

test('ServerConfigStore 可新增、更新并持久化当前服务端', async (t) => {
  const { configFile, store } = await createFixture(t);
  const created = await store.upsert({
    name: '测试环境',
    url: 'http://localhost:7806/lmdb/',
  });
  assert.equal(created.name, '测试环境');
  assert.equal(created.url, 'http://localhost:7806/lmdb');
  assert.equal(created.authenticated, false);

  const authenticated = await store.setAuthenticated(created.id, true);
  assert.equal(authenticated?.authenticated, true);

  const updated = await store.upsert({
    id: created.id,
    name: '测试环境（新）',
    url: 'http://127.0.0.1:7806/lmdb',
  });
  const state = await store.read();
  assert.equal(state.selectedServerId, created.id);
  assert.equal(state.servers.length, 1);
  assert.equal(updated.name, '测试环境（新）');
  assert.equal(updated.authenticated, false);
  assert.match(await readFile(configFile, 'utf8'), /127\.0\.0\.1/);
});

test('ServerConfigStore 未修改 URL 时保留登录状态', async (t) => {
  const { store } = await createFixture(t);
  const server = await store.upsert({
    name: '生产环境',
    url: 'https://example.com/lmdb',
  });
  await store.setAuthenticated(server.id, true);
  const renamed = await store.upsert({
    id: server.id,
    name: '生产环境（重命名）',
    url: server.url,
  });
  assert.equal(renamed.authenticated, true);
});

test('ServerConfigStore 切换当前服务端时保留各自的登录状态', async (t) => {
  const { store } = await createFixture(t);
  const first = await store.upsert({
    name: '开发环境',
    url: 'https://dev.example/lmdb',
  });
  const second = await store.upsert({
    name: '生产环境',
    url: 'https://prod.example/lmdb',
  });
  await store.setAuthenticated(first.id, true);
  const state = await store.select(first.id);
  assert.equal(state.selectedServerId, first.id);
  assert.equal(state.servers.find((item) => item.id === first.id)?.authenticated, true);
  assert.equal(state.servers.find((item) => item.id === second.id)?.name, '生产环境');
  assert.equal((await store.select('missing-id')).selectedServerId, first.id);
});

test('ServerConfigStore 删除当前记录后清空选中状态', async (t) => {
  const { store } = await createFixture(t);
  const server = await store.upsert({
    name: '待删除环境',
    url: 'https://example.com/lmdb',
  });
  const state = await store.remove(server.id);
  assert.equal(state.selectedServerId, null);
  assert.deepEqual(state.servers, []);
});

test('ServerConfigStore 遇到损坏配置时安全回退为空列表', async (t) => {
  const { configFile, store } = await createFixture(t);
  await writeFile(configFile, '{broken-json', 'utf8');
  assert.deepEqual(await store.read(), {
    selectedServerId: null,
    servers: [],
    tabBarCollapsed: false,
    version: 1,
  });
});

test('ServerConfigStore 可持久化标签栏折叠偏好', async (t) => {
  const { store } = await createFixture(t);
  assert.equal((await store.read()).tabBarCollapsed, false);
  const collapsed = await store.setTabBarCollapsed(true);
  assert.equal(collapsed.tabBarCollapsed, true);
  assert.equal((await store.read()).tabBarCollapsed, true);
  const restored = await store.setTabBarCollapsed(false);
  assert.equal(restored.tabBarCollapsed, false);
});
