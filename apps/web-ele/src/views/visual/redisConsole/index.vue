<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  ArrowLeft, Close, DataAnalysis, Delete, Edit, Expand, Fold, Monitor,
  Plus, Promotion, Refresh, Search, SwitchButton,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  deleteRedisConnection, deleteRedisKey, executeRedisCommand, getRedisDatabases,
  getRedisInfo, getRedisKey, redisConnections, saveRedisConnection, saveRedisKey, scanRedisKeys,
  testRedisConnection, updateRedisKeyMeta,
} from '#/api/visual/redisConsole';

defineOptions({ name: 'RedisConsole' });
const router = useRouter();
const connections = ref<any[]>([]);
const activeId = ref<any>();
const active = computed(() => connections.value.find((item) => item.id === activeId.value));
const database = ref(0);
const mode = ref<'browser' | 'cli'>('browser');
const databaseStats = ref<Array<{ database: number; keyCount: number }>>([]);
const databaseStatsLoading = ref(false);
const keyPattern = ref('*');
const keys = ref<any[]>([]);
const loadingKeys = ref(false);
const selectedKey = ref('');
const keyLoading = ref(false);
const keyForm = reactive({ key: '', type: 'STRING', ttlSeconds: -1 as null | number, content: '' });
const originalKey = ref('');
const savingKey = ref(false);

const connectionVisible = ref(false);
const connectionSaving = ref(false);
const connectionForm = reactive({
  id: undefined as any, connectionName: '', mode: 'STANDALONE', hostName: '127.0.0.1', port: 6379,
  clusterNodes: '', username: '', password: '', tlsEnabled: 0, timeoutMs: 5000, databaseCount: 16, isPublic: 0,
});

const command = ref('');
const commandLoading = ref(false);
const cliLines = ref<Array<{ command: string; database: number; error?: boolean; output: string; }>>([]);
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const terminalOutput = ref<HTMLElement>();
const commandInput = ref<any>();

const connectionPaneVisible = ref(true);
const connectionWidth = ref(220);
const keyListWidth = ref(300);
const resizeState = reactive({ kind: '' as '' | 'connections' | 'keys', startX: 0, startWidth: 0 });
const workspaceStyle = computed(() => {
  const columns: string[] = [];
  if (connectionPaneVisible.value) columns.push(`${connectionWidth.value}px`, '5px');
  if (mode.value === 'browser') columns.push(`${keyListWidth.value}px`, '5px', 'minmax(300px, 1fr)');
  else columns.push('minmax(360px, 1fr)');
  return { gridTemplateColumns: columns.join(' ') };
});

const contextMenu = reactive({ visible: false, x: 0, y: 0, item: null as any });
const infoVisible = ref(false);
const infoLoading = ref(false);
const infoTitle = ref('Redis 信息');
const infoText = ref('');

function unbox(res: any) { return res?.data ?? res; }
const dbOptions = computed(() => {
  if (databaseStats.value.length) return databaseStats.value;
  const count = active.value?.mode === 'CLUSTER' ? 1 : (active.value?.databaseCount || 16);
  return Array.from({ length: count }, (_, index) => ({ database: index, keyCount: -1 }));
});
const writable = computed(() => Boolean(active.value?.writable));
const cliPrompt = computed(() => `redis[${database.value}]>`);

async function loadConnections(selectId?: any) {
  connections.value = unbox(await redisConnections()) || [];
  if (selectId) activeId.value = selectId;
  if (!connections.value.some((item) => item.id === activeId.value)) activeId.value = connections.value[0]?.id;
}

async function loadDatabaseStats() {
  if (!activeId.value) { databaseStats.value = []; return; }
  databaseStatsLoading.value = true;
  try { databaseStats.value = unbox(await getRedisDatabases(activeId.value)) || []; }
  finally { databaseStatsLoading.value = false; }
}

async function loadKeys() {
  if (!activeId.value) { keys.value = []; return; }
  loadingKeys.value = true;
  try { keys.value = unbox(await scanRedisKeys(activeId.value, database.value, keyPattern.value || '*')) || []; }
  finally { loadingKeys.value = false; }
}

async function selectKey(item: any) {
  selectedKey.value = item.key; keyLoading.value = true;
  try {
    const data = unbox(await getRedisKey(activeId.value, database.value, item.key));
    originalKey.value = data.key; keyForm.key = data.key; keyForm.type = data.type; keyForm.ttlSeconds = data.ttlSeconds;
    if (data.type === 'STRING') keyForm.content = data.value ?? '';
    else if (data.type === 'HASH') keyForm.content = JSON.stringify(data.entries || {}, null, 2);
    else if (data.type === 'ZSET') keyForm.content = JSON.stringify(data.scoredValues || {}, null, 2);
    else keyForm.content = JSON.stringify(data.values || [], null, 2);
    if (data.truncated) ElMessage.warning('集合内容超过服务端展示上限，当前只显示前 500 项');
  } finally { keyLoading.value = false; }
}

function newKey() {
  selectedKey.value = ''; originalKey.value = '';
  Object.assign(keyForm, { key: '', type: 'STRING', ttlSeconds: -1, content: '' });
}

function buildKeyPayload() {
  const payload: any = { key: keyForm.key, type: keyForm.type, ttlSeconds: keyForm.ttlSeconds };
  if (keyForm.type === 'STRING') payload.value = keyForm.content;
  else if (keyForm.type === 'HASH') payload.entries = JSON.parse(keyForm.content || '{}');
  else if (keyForm.type === 'ZSET') payload.scoredValues = JSON.parse(keyForm.content || '{}');
  else payload.values = JSON.parse(keyForm.content || '[]');
  return payload;
}

async function persistKey() {
  if (!writable.value) return ElMessage.warning('公开连接为只读');
  if (!keyForm.key.trim()) return ElMessage.warning('键名不能为空');
  savingKey.value = true;
  try {
    if (originalKey.value && originalKey.value !== keyForm.key.trim()) {
      await updateRedisKeyMeta(activeId.value, database.value, originalKey.value, { newKey: keyForm.key.trim(), ttlSeconds: keyForm.ttlSeconds });
      originalKey.value = keyForm.key.trim();
    }
    await saveRedisKey(activeId.value, database.value, buildKeyPayload());
    ElMessage.success('键值已保存'); originalKey.value = keyForm.key.trim();
    await Promise.all([loadKeys(), loadDatabaseStats()]);
  } catch (error: any) { ElMessage.error(error?.message || '内容格式错误，请检查 JSON'); }
  finally { savingKey.value = false; }
}

async function removeKey() {
  const key = originalKey.value || keyForm.key; if (!key) return;
  await ElMessageBox.confirm(`确认删除键「${key}」？`, '删除 Redis 键', { type: 'warning' });
  await deleteRedisKey(activeId.value, database.value, key); ElMessage.success('已删除'); newKey();
  await Promise.all([loadKeys(), loadDatabaseStats()]);
}

function resetConnection() {
  Object.assign(connectionForm, { id: undefined, connectionName: '', mode: 'STANDALONE', hostName: '127.0.0.1', port: 6379, clusterNodes: '', username: '', password: '', tlsEnabled: 0, timeoutMs: 5000, databaseCount: 16, isPublic: 0 });
}
function createConnection() { resetConnection(); connectionVisible.value = true; }
function editConnection(item: any) { resetConnection(); Object.assign(connectionForm, item, { password: '' }); connectionVisible.value = true; }
async function persistConnection() {
  if (!connectionForm.connectionName.trim()) return ElMessage.warning('请输入连接名称');
  connectionSaving.value = true;
  try { const saved = unbox(await saveRedisConnection({ ...connectionForm })); ElMessage.success('连接已保存'); connectionVisible.value = false; await loadConnections(saved?.id); }
  finally { connectionSaving.value = false; }
}
async function testConnection(item: any) { const result = unbox(await testRedisConnection(item.id)); ElMessage.success(`连接正常: ${result?.message || 'PONG'}`); }
async function removeConnection(item: any) { await ElMessageBox.confirm(`确认删除连接「${item.connectionName}」？`, '删除连接', { type: 'warning' }); await deleteRedisConnection(item.id); await loadConnections(); }

function activateConnection(item: any) {
  activeId.value = item.id;
  closeContextMenu();
}

function closeConnection(item: any) {
  if (item?.id === activeId.value) {
    activeId.value = undefined;
    ElMessage.success('连接已关闭');
  } else {
    ElMessage.info('该连接当前未打开');
  }
  closeContextMenu();
}

async function refreshConnection(item: any) {
  activeId.value = item.id;
  closeContextMenu();
  await Promise.all([loadConnections(item.id), loadDatabaseStats(), loadKeys()]);
  ElMessage.success('已刷新');
}

async function openCli(item: any) {
  activeId.value = item.id;
  mode.value = 'cli';
  closeContextMenu();
  await nextTick();
  commandInput.value?.focus?.();
}

function formatRedisInfo(data: any) {
  if (!data || typeof data !== 'object') return String(data ?? '');
  const sections: string[] = [`mode: ${data.mode || '-'}`];
  if (data.server) {
    sections.push('', ...Object.entries(data.server).map(([key, value]) => `${key}: ${value}`));
  }
  if (data.nodes) {
    for (const [node, values] of Object.entries(data.nodes as Record<string, any>)) {
      sections.push('', `[${node}]`);
      sections.push(...Object.entries(values || {}).map(([key, value]) => `${key}: ${value}`));
    }
  }
  return sections.join('\n');
}

async function showRedisInfo(item: any) {
  closeContextMenu();
  infoVisible.value = true;
  infoLoading.value = true;
  infoTitle.value = `${item.connectionName} · Redis 信息`;
  infoText.value = '';
  try { infoText.value = formatRedisInfo(unbox(await getRedisInfo(item.id))); }
  finally { infoLoading.value = false; }
}

function openConnectionMenu(event: MouseEvent, item: any) {
  contextMenu.item = item;
  contextMenu.x = Math.max(4, Math.min(event.clientX, window.innerWidth - 190));
  contextMenu.y = Math.max(4, Math.min(event.clientY, window.innerHeight - 300));
  contextMenu.visible = true;
}

function closeContextMenu() { contextMenu.visible = false; }

function startResize(kind: 'connections' | 'keys', event: PointerEvent) {
  if (event.button !== 0 || window.innerWidth < 720) return;
  resizeState.kind = kind;
  resizeState.startX = event.clientX;
  resizeState.startWidth = kind === 'connections' ? connectionWidth.value : keyListWidth.value;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', resizePane);
  window.addEventListener('pointerup', stopResize);
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
}

function resizePane(event: PointerEvent) {
  const width = resizeState.startWidth + event.clientX - resizeState.startX;
  if (resizeState.kind === 'connections') connectionWidth.value = Math.max(50, Math.min(520, width));
  if (resizeState.kind === 'keys') keyListWidth.value = Math.max(180, Math.min(680, width));
}

function stopResize() {
  if (!resizeState.kind) return;
  localStorage.setItem('lemon-redis-connection-width', String(connectionWidth.value));
  localStorage.setItem('lemon-redis-key-width', String(keyListWidth.value));
  resizeState.kind = '';
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', resizePane);
  window.removeEventListener('pointerup', stopResize);
}

function toggleConnectionPane() {
  connectionPaneVisible.value = !connectionPaneVisible.value;
  localStorage.setItem('lemon-redis-connections-visible', String(connectionPaneVisible.value));
}

function formatCommandOutput(output: any): string {
  if (output === null || output === undefined) return '(nil)';
  if (Array.isArray(output)) {
    if (!output.length) return '(empty array)';
    return output.map((item, index) => `${index + 1}) ${formatCommandOutput(item)}`).join('\n');
  }
  if (typeof output === 'object') return JSON.stringify(output, null, 2);
  return String(output);
}

function cleanCommandError(error: any): string {
  let message = String(error?.msg || error?.message || '命令执行失败').trim();
  const marker = 'RedisCommandExecutionException:';
  if (message.includes(marker)) message = message.slice(message.lastIndexOf(marker) + marker.length).trim();
  message = message.replace(/^Redis 操作失败:\s*/, '').replace(/^ERR\s+/, '');
  return message || '命令执行失败';
}

async function scrollTerminalToEnd() {
  await nextTick();
  if (terminalOutput.value) terminalOutput.value.scrollTop = terminalOutput.value.scrollHeight;
}

async function runCommand(allowDangerous = false) {
  const value = command.value.trim(); if (!value || !activeId.value) return;
  const executionDatabase = database.value;
  if (!allowDangerous) {
    commandHistory.value = [value, ...commandHistory.value.filter((item) => item !== value)].slice(0, 100);
    historyIndex.value = -1;
  }
  commandLoading.value = true;
  try {
    const result = unbox(await executeRedisCommand(activeId.value, executionDatabase, value, allowDangerous));
    const output = result && Object.prototype.hasOwnProperty.call(result, 'output') ? result.output : result;
    cliLines.value.push({ command: value, database: executionDatabase, output: formatCommandOutput(output) });
    historyIndex.value = -1;
    command.value = '';
    if (Number.isInteger(result?.database) && result.database !== database.value) database.value = result.database;
    await loadDatabaseStats();
  } catch (error: any) {
    const message = cleanCommandError(error);
    if (!allowDangerous && message.includes('危险命令')) {
      await ElMessageBox.confirm(message, '危险 Redis 命令', { type: 'error', confirmButtonText: '确认执行' });
      commandLoading.value = false; return runCommand(true);
    }
    cliLines.value.push({ command: value, database: executionDatabase, output: message, error: true });
  } finally {
    commandLoading.value = false;
    await scrollTerminalToEnd();
  }
}

function onCommandKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { event.preventDefault(); runCommand(); return; }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  if (!commandHistory.value.length) return;
  if (event.key === 'ArrowUp') historyIndex.value = Math.min(historyIndex.value + 1, commandHistory.value.length - 1);
  else historyIndex.value = Math.max(historyIndex.value - 1, -1);
  command.value = historyIndex.value < 0 ? '' : commandHistory.value[historyIndex.value]!;
}

watch(activeId, async () => {
  databaseStats.value = [];
  cliLines.value = [];
  historyIndex.value = -1;
  const databaseChanged = database.value !== 0;
  database.value = 0;
  newKey();
  if (!activeId.value) { keys.value = []; return; }
  await loadDatabaseStats();
  if (!databaseChanged) await loadKeys();
});
watch(database, () => { newKey(); loadKeys(); });

onMounted(async () => {
  const savedConnectionWidth = localStorage.getItem('lemon-redis-connection-width');
  const savedKeyWidth = localStorage.getItem('lemon-redis-key-width');
  if (savedConnectionWidth !== null && Number.isFinite(Number(savedConnectionWidth))) connectionWidth.value = Math.max(50, Math.min(520, Number(savedConnectionWidth)));
  if (savedKeyWidth !== null && Number.isFinite(Number(savedKeyWidth))) keyListWidth.value = Math.max(180, Math.min(680, Number(savedKeyWidth)));
  connectionPaneVisible.value = localStorage.getItem('lemon-redis-connections-visible') !== 'false';
  if (window.innerWidth < 720) connectionPaneVisible.value = false;
  document.addEventListener('click', closeContextMenu);
  await loadConnections();
});

onBeforeUnmount(() => {
  stopResize();
  document.removeEventListener('click', closeContextMenu);
});
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="redis-page">
      <header class="topbar">
        <ElButton :icon="ArrowLeft" circle title="返回数据库客户端" @click="router.back()" />
        <h2>Redis 工作台</h2>
        <ElButton :icon="connectionPaneVisible ? Fold : Expand" circle :title="connectionPaneVisible ? '隐藏连接区' : '显示连接区'" @click="toggleConnectionPane" />
        <template v-if="active">
          <ElSelect v-model="database" class="db-select" :loading="databaseStatsLoading">
            <ElOption
              v-for="item in dbOptions"
              :key="item.database"
              :label="item.keyCount < 0 ? `DB ${item.database}` : `DB ${item.database} · ${item.keyCount} keys`"
              :value="item.database"
            />
          </ElSelect>
        </template>
        <ElSegmented v-model="mode" :options="[{ label: '键浏览器', value: 'browser' }, { label: '命令行', value: 'cli' }]" />
        <template v-if="active">
          <span class="connection-state">{{ active.mode === 'CLUSTER' ? 'Cluster' : `${active.hostName}:${active.port}` }}</span>
        </template>
      </header>

      <div class="workspace" :style="workspaceStyle">
        <aside v-if="connectionPaneVisible" class="connections" :class="{ compact: connectionWidth < 110 }">
          <div class="pane-head"><strong>连接</strong><ElButton :icon="Plus" circle size="small" title="新建连接" @click="createConnection" /></div>
          <ElScrollbar>
            <button
              v-for="item in connections"
              :key="item.id"
              class="connection-item"
              :class="{ active: item.id === activeId }"
              @click="activateConnection(item)"
              @contextmenu.prevent.stop="openConnectionMenu($event, item)"
            >
              <span class="redis-mark">R</span><span class="connection-name">{{ item.connectionName }}</span><ElTag v-if="item.mode === 'CLUSTER'" size="small" effect="plain">集群</ElTag>
            </button>
            <ElEmpty v-if="!connections.length" description="还没有 Redis 连接" :image-size="64" />
          </ElScrollbar>
        </aside>
        <div v-if="connectionPaneVisible" class="resize-handle" title="拖动调整连接区宽度" @pointerdown="startResize('connections', $event)"></div>

        <template v-if="active && mode === 'browser'">
          <section class="key-list">
            <div class="search-row"><ElInput v-model="keyPattern" placeholder="匹配模式，如 user:*" :prefix-icon="Search" @keyup.enter="loadKeys" /><ElButton :icon="Refresh" circle title="刷新键与数量" @click="refreshConnection(active)" /><ElButton v-if="writable" :icon="Plus" circle type="primary" title="新建键" @click="newKey" /></div>
            <ElScrollbar v-loading="loadingKeys"><button v-for="item in keys" :key="item.key" class="key-item" :class="{ active: item.key === selectedKey }" @click="selectKey(item)"><ElTag size="small" effect="plain">{{ item.type }}</ElTag><span>{{ item.key }}</span><small>{{ item.ttlSeconds < 0 ? '永久' : `${item.ttlSeconds}s` }}</small></button><ElEmpty v-if="!loadingKeys && !keys.length" description="没有匹配的键" :image-size="64" /></ElScrollbar>
          </section>
          <div class="resize-handle" title="拖动调整键列表宽度" @pointerdown="startResize('keys', $event)"></div>

          <main class="editor" v-loading="keyLoading">
            <div class="pane-head"><strong>{{ originalKey ? '编辑键' : '新建键' }}</strong><span v-if="!writable" class="readonly">只读连接</span><ElButton v-if="originalKey && writable" type="danger" plain :icon="Delete" @click="removeKey">删除</ElButton><ElButton v-if="writable" type="primary" :loading="savingKey" @click="persistKey">保存</ElButton></div>
            <ElForm label-position="top" class="key-form">
              <div class="key-meta"><ElFormItem label="键名"><ElInput v-model="keyForm.key" /></ElFormItem><ElFormItem label="类型"><ElSelect v-model="keyForm.type" :disabled="Boolean(originalKey)"><ElOption v-for="type in ['STRING','HASH','LIST','SET','ZSET']" :key="type" :label="type" :value="type" /></ElSelect></ElFormItem><ElFormItem label="TTL 秒（-1 永久）"><ElInputNumber v-model="keyForm.ttlSeconds" :min="-1" controls-position="right" /></ElFormItem></div>
              <ElFormItem :label="keyForm.type === 'STRING' ? '值' : keyForm.type === 'HASH' ? '字段 JSON 对象' : keyForm.type === 'ZSET' ? '成员与分数 JSON 对象' : '成员 JSON 数组'">
                <ElInput v-model="keyForm.content" type="textarea" :rows="20" resize="none" class="value-editor" spellcheck="false" :readonly="!writable" />
              </ElFormItem>
            </ElForm>
          </main>
        </template>

        <main v-else-if="active" class="cli">
          <div ref="terminalOutput" class="terminal-output">
            <div class="welcome">已连接 {{ active.connectionName }} / DB {{ database }}</div>
            <div v-for="(line, i) in cliLines" :key="i" class="cli-block"><div class="prompt">redis[{{ line.database }}]&gt; {{ line.command }}</div><pre :class="{ error: line.error }">{{ line.output }}</pre></div>
          </div>
          <div class="command-row"><span>{{ cliPrompt }}</span><ElInput ref="commandInput" v-model="command" autofocus :disabled="commandLoading" @keydown="onCommandKeydown" /><ElButton :icon="Promotion" circle type="primary" title="执行命令" :loading="commandLoading" @click="runCommand()" /><ElButton :icon="Delete" circle title="清空终端" @click="cliLines = []" /></div>
        </main>
        <ElEmpty v-else class="no-connection" description="新建或选择一个 Redis 连接" />
      </div>

      <div v-if="contextMenu.visible" class="connection-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
        <button v-if="contextMenu.item?.writable" @click="editConnection(contextMenu.item); closeContextMenu()"><Edit />编辑</button>
        <button @click="testConnection(contextMenu.item); closeContextMenu()"><SwitchButton />PING</button>
        <button @click="refreshConnection(contextMenu.item)"><Refresh />刷新</button>
        <button @click="closeConnection(contextMenu.item)"><Close />关闭连接</button>
        <button @click="showRedisInfo(contextMenu.item)"><DataAnalysis />查看 Redis 信息</button>
        <button @click="openCli(contextMenu.item)"><Monitor />命令行模式</button>
        <button v-if="contextMenu.item?.writable" class="danger" @click="removeConnection(contextMenu.item); closeContextMenu()"><Delete />删除</button>
      </div>
    </div>

    <ElDialog v-model="connectionVisible" :title="connectionForm.id ? '编辑 Redis 连接' : '新建 Redis 连接'" width="620px">
      <ElForm label-position="top">
        <ElFormItem label="连接名称"><ElInput v-model="connectionForm.connectionName" maxlength="120" /></ElFormItem>
        <ElFormItem label="连接模式"><ElSegmented v-model="connectionForm.mode" :options="[{ label: '单机', value: 'STANDALONE' }, { label: 'Cluster', value: 'CLUSTER' }]" /></ElFormItem>
        <div v-if="connectionForm.mode === 'STANDALONE'" class="form-grid"><ElFormItem label="主机"><ElInput v-model="connectionForm.hostName" /></ElFormItem><ElFormItem label="端口"><ElInputNumber v-model="connectionForm.port" :min="1" :max="65535" controls-position="right" /></ElFormItem></div>
        <ElFormItem v-else label="集群节点"><ElInput v-model="connectionForm.clusterNodes" type="textarea" :rows="4" placeholder="redis-1:6379, redis-2:6379, redis-3:6379" /></ElFormItem>
        <div class="form-grid"><ElFormItem label="ACL 用户名"><ElInput v-model="connectionForm.username" placeholder="可选" /></ElFormItem><ElFormItem :label="connectionForm.id ? '密码（留空保持不变）' : '密码'"><ElInput v-model="connectionForm.password" type="password" show-password /></ElFormItem><ElFormItem label="命令超时 ms"><ElInputNumber v-model="connectionForm.timeoutMs" :min="500" :max="120000" controls-position="right" /></ElFormItem><ElFormItem v-if="connectionForm.mode === 'STANDALONE'" label="DB 数量"><ElInputNumber v-model="connectionForm.databaseCount" :min="1" :max="256" controls-position="right" /></ElFormItem></div>
        <div class="switches"><ElCheckbox v-model="connectionForm.tlsEnabled" :true-value="1" :false-value="0">TLS</ElCheckbox><ElCheckbox v-model="connectionForm.isPublic" :true-value="1" :false-value="0">公开为只读连接</ElCheckbox></div>
      </ElForm>
      <template #footer><ElButton @click="connectionVisible = false">取消</ElButton><ElButton type="primary" :loading="connectionSaving" @click="persistConnection">保存</ElButton></template>
    </ElDialog>

    <ElDialog v-model="infoVisible" :title="infoTitle" width="min(820px, 92vw)">
      <pre v-loading="infoLoading" class="redis-info">{{ infoText }}</pre>
    </ElDialog>
  </Page>
</template>

<style scoped>
.redis-page { height: 100%; min-height: 0; overflow: hidden; background: var(--el-bg-color); color: var(--el-text-color-primary); }
.topbar { height: 52px; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--el-border-color); }
.topbar h2 { margin: 0; font-size: 17px; letter-spacing: 0; white-space: nowrap; }
.connection-state { min-width: 0; margin-left: auto; overflow: hidden; color: var(--el-text-color-secondary); text-overflow: ellipsis; white-space: nowrap; }
.db-select { width: 180px; }
.workspace { height: calc(100% - 53px); min-height: 0; display: grid; overflow: hidden; }
.connections,.key-list,.editor,.cli { min-width: 0; min-height: 0; overflow: hidden; }
.connections,.key-list { display: flex; flex-direction: column; }
.connections :deep(.el-scrollbar),.key-list :deep(.el-scrollbar) { flex: 1; min-height: 0; }
.pane-head { height: 50px; flex: 0 0 50px; padding: 0 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--el-border-color); }
.pane-head strong { margin-right: auto; white-space: nowrap; }
.connections.compact .pane-head { justify-content: center; padding: 0 4px; }
.connections.compact .pane-head strong,.connections.compact .connection-name,.connections.compact .el-tag { display: none; }
.connection-item,.key-item { width: 100%; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); background: transparent; color: inherit; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; }
.connection-item { min-height: 52px; padding: 6px 10px; }
.connections.compact .connection-item { justify-content: center; padding: 6px 4px; }
.connection-item.active,.key-item.active { background: var(--el-color-primary-light-9); }
.redis-mark { width: 25px; height: 25px; flex: 0 0 25px; display: grid; place-items: center; background: #c93636; color: white; font-weight: 700; border-radius: 4px; }
.connection-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resize-handle { position: relative; z-index: 2; cursor: col-resize; background: var(--el-border-color-lighter); touch-action: none; }
.resize-handle::after { position: absolute; inset: 0 1px; content: ''; }
.resize-handle:hover::after { background: var(--el-color-primary-light-5); }
.search-row { display: grid; grid-template-columns: minmax(80px, 1fr) 32px 32px; gap: 6px; padding: 9px; border-bottom: 1px solid var(--el-border-color); }
.key-item { min-height: 40px; padding: 6px 10px; }
.key-item span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.key-item small { color: var(--el-text-color-secondary); white-space: nowrap; }
.editor { overflow: auto; }
.readonly { color: var(--el-color-warning); }
.key-form { min-width: 430px; padding: 14px; }
.key-meta { display: grid; grid-template-columns: minmax(160px, 1fr) 130px 150px; gap: 10px; }
.value-editor :deep(textarea),.terminal-output,.command-row,.redis-info { font-family: Consolas, 'Courier New', monospace; font-size: 13px; }
.cli { display: flex; flex-direction: column; background: #171a1f; color: #dce3ea; }
.terminal-output { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; }
.welcome { color: #8ea1b2; margin-bottom: 14px; }
.prompt { color: #6ed89b; }
.cli-block pre { margin: 4px 0 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: #dce3ea; }
.cli-block pre.error { color: #ff7474; }
.command-row { display: grid; grid-template-columns: auto minmax(80px, 1fr) 32px 32px; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #333b45; }
.command-row :deep(.el-input__wrapper) { background: #20252c; box-shadow: none; }
.command-row :deep(input) { color: #fff; }
.no-connection { grid-column: 1 / -1; }
.connection-menu { position: fixed; z-index: 4000; width: 184px; padding: 4px; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color); border-radius: 6px; box-shadow: var(--el-box-shadow-light); }
.connection-menu button { width: 100%; height: 34px; padding: 0 9px; display: flex; align-items: center; gap: 9px; color: var(--el-text-color-primary); text-align: left; background: transparent; border: 0; border-radius: 4px; cursor: pointer; }
.connection-menu button:hover { background: var(--el-fill-color-light); }
.connection-menu button.danger { color: var(--el-color-danger); }
.connection-menu svg { width: 16px; height: 16px; }
.redis-info { min-height: 240px; max-height: 60vh; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.switches { display: flex; gap: 24px; }
@media (max-width: 900px) { .topbar h2,.connection-state { display: none; }.topbar { gap: 6px; }.db-select { width: 150px; }.workspace { overflow-x: auto; }.key-meta,.form-grid { grid-template-columns: 1fr; } }
</style>
