<script lang="ts" setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { ArrowLeft, Delete, Edit, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  deleteRedisConnection, deleteRedisKey, executeRedisCommand, getRedisKey,
  redisConnections, saveRedisConnection, saveRedisKey, scanRedisKeys,
  testRedisConnection, updateRedisKeyMeta,
} from '#/api/visual/redisConsole';

defineOptions({ name: 'RedisConsole' });
const router = useRouter();
const connections = ref<any[]>([]);
const activeId = ref<any>();
const active = computed(() => connections.value.find((item) => item.id === activeId.value));
const database = ref(0);
const mode = ref<'browser' | 'cli'>('browser');
const keyPattern = ref('*');
const keys = ref<any[]>([]);
const loadingKeys = ref(false);
const selectedKey = ref('');
const keyLoading = ref(false);
const keyForm = reactive({ key: '', type: 'STRING', ttlSeconds: -1 as number | null, content: '' });
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
const cliLines = ref<Array<{ command: string; output: string; error?: boolean }>>([]);
const cliEnd = ref<HTMLElement>();

function unbox(res: any) { return res?.data ?? res; }
const dbOptions = computed(() => Array.from({ length: active.value?.mode === 'CLUSTER' ? 1 : (active.value?.databaseCount || 16) }, (_, i) => i));
const writable = computed(() => Boolean(active.value?.writable));

async function loadConnections(selectId?: any) {
  connections.value = unbox(await redisConnections()) || [];
  if (selectId) activeId.value = selectId;
  if (!connections.value.some((item) => item.id === activeId.value)) activeId.value = connections.value[0]?.id;
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
    ElMessage.success('键值已保存'); originalKey.value = keyForm.key.trim(); await loadKeys();
  } catch (error: any) { ElMessage.error(error?.message || '内容格式错误，请检查 JSON'); }
  finally { savingKey.value = false; }
}

async function removeKey() {
  const key = originalKey.value || keyForm.key; if (!key) return;
  await ElMessageBox.confirm(`确认删除键「${key}」？`, '删除 Redis 键', { type: 'warning' });
  await deleteRedisKey(activeId.value, database.value, key); ElMessage.success('已删除'); newKey(); await loadKeys();
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

async function runCommand(allowDangerous = false) {
  const value = command.value.trim(); if (!value || !activeId.value) return;
  commandLoading.value = true;
  try {
    const output = unbox(await executeRedisCommand(activeId.value, database.value, value, allowDangerous));
    cliLines.value.push({ command: value, output: typeof output === 'string' ? output : JSON.stringify(output, null, 2) }); command.value = '';
  } catch (error: any) {
    const message = error?.message || '命令执行失败';
    if (!allowDangerous && message.includes('危险命令')) {
      await ElMessageBox.confirm(message, '危险 Redis 命令', { type: 'error', confirmButtonText: '确认执行' });
      commandLoading.value = false; return runCommand(true);
    }
    cliLines.value.push({ command: value, output: message, error: true });
  } finally { commandLoading.value = false; await nextTick(); cliEnd.value?.scrollIntoView({ behavior: 'smooth' }); }
}

watch(activeId, () => { database.value = 0; newKey(); loadKeys(); });
watch(database, () => { newKey(); loadKeys(); });
onMounted(loadConnections);
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="redis-page">
      <header class="topbar">
        <ElButton :icon="ArrowLeft" circle title="返回数据库客户端" @click="router.back()" />
        <h2>Redis 工作台</h2>
        <ElSegmented v-model="mode" :options="[{ label: '键浏览器', value: 'browser' }, { label: '命令行', value: 'cli' }]" />
        <template v-if="active">
          <span class="connection-state">{{ active.mode === 'CLUSTER' ? 'Cluster' : active.hostName + ':' + active.port }}</span>
          <ElSelect v-model="database" class="db-select"><ElOption v-for="db in dbOptions" :key="db" :label="`DB ${db}`" :value="db" /></ElSelect>
        </template>
      </header>

      <div class="workspace">
        <aside class="connections">
          <div class="pane-head"><strong>连接</strong><ElButton :icon="Plus" circle size="small" title="新建连接" @click="createConnection" /></div>
          <ElScrollbar>
            <button v-for="item in connections" :key="item.id" class="connection-item" :class="{ active: item.id === activeId }" @click="activeId = item.id">
              <span class="redis-mark">R</span><span class="connection-name">{{ item.connectionName }}</span><ElTag v-if="item.mode === 'CLUSTER'" size="small" effect="plain">集群</ElTag>
              <span class="connection-actions" @click.stop><ElButton v-if="item.writable" link :icon="Edit" title="编辑" @click="editConnection(item)"/><ElButton link title="测试" @click="testConnection(item)">PING</ElButton><ElButton v-if="item.writable" link type="danger" :icon="Delete" title="删除" @click="removeConnection(item)"/></span>
            </button>
            <ElEmpty v-if="!connections.length" description="还没有 Redis 连接" :image-size="64" />
          </ElScrollbar>
        </aside>

        <template v-if="active && mode === 'browser'">
          <section class="key-list">
            <div class="search-row"><ElInput v-model="keyPattern" placeholder="匹配模式，如 user:*" :prefix-icon="Search" @keyup.enter="loadKeys"/><ElButton :icon="Refresh" circle title="刷新键" @click="loadKeys"/><ElButton v-if="writable" :icon="Plus" circle type="primary" title="新建键" @click="newKey"/></div>
            <ElScrollbar v-loading="loadingKeys"><button v-for="item in keys" :key="item.key" class="key-item" :class="{ active: item.key === selectedKey }" @click="selectKey(item)"><ElTag size="small" effect="plain">{{ item.type }}</ElTag><span>{{ item.key }}</span><small>{{ item.ttlSeconds < 0 ? '永久' : item.ttlSeconds + 's' }}</small></button><ElEmpty v-if="!loadingKeys && !keys.length" description="没有匹配的键" :image-size="64" /></ElScrollbar>
          </section>

          <main class="editor" v-loading="keyLoading">
            <div class="pane-head"><strong>{{ originalKey ? '编辑键' : '新建键' }}</strong><span v-if="!writable" class="readonly">只读连接</span><ElButton v-if="originalKey && writable" type="danger" plain :icon="Delete" @click="removeKey">删除</ElButton><ElButton v-if="writable" type="primary" :loading="savingKey" @click="persistKey">保存</ElButton></div>
            <ElForm label-position="top" class="key-form">
              <div class="key-meta"><ElFormItem label="键名"><ElInput v-model="keyForm.key" /></ElFormItem><ElFormItem label="类型"><ElSelect v-model="keyForm.type" :disabled="Boolean(originalKey)"><ElOption v-for="type in ['STRING','HASH','LIST','SET','ZSET']" :key="type" :label="type" :value="type"/></ElSelect></ElFormItem><ElFormItem label="TTL 秒（-1 永久）"><ElInputNumber v-model="keyForm.ttlSeconds" :min="-1" controls-position="right" /></ElFormItem></div>
              <ElFormItem :label="keyForm.type === 'STRING' ? '值' : keyForm.type === 'HASH' ? '字段 JSON 对象' : keyForm.type === 'ZSET' ? '成员与分数 JSON 对象' : '成员 JSON 数组'">
                <ElInput v-model="keyForm.content" type="textarea" :rows="20" resize="none" class="value-editor" spellcheck="false" :readonly="!writable" />
              </ElFormItem>
            </ElForm>
          </main>
        </template>

        <main v-else-if="active" class="cli">
          <div class="terminal-output"><div class="welcome">Connected to {{ active.connectionName }} / DB {{ database }}. 输入 Redis 命令后回车执行。</div><div v-for="(line, i) in cliLines" :key="i" class="cli-block"><div class="prompt">redis&gt; {{ line.command }}</div><pre :class="{ error: line.error }">{{ line.output }}</pre></div><span ref="cliEnd" /></div>
          <div class="command-row"><span>redis&gt;</span><ElInput v-model="command" autofocus :disabled="commandLoading" @keyup.enter="runCommand()"/><ElButton type="primary" :loading="commandLoading" @click="runCommand()">执行</ElButton></div>
        </main>
        <ElEmpty v-else class="no-connection" description="新建或选择一个 Redis 连接" />
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
  </Page>
</template>

<style scoped>
.redis-page { height: 100%; min-height: 540px; background: var(--el-bg-color); color: var(--el-text-color-primary); }
.topbar { height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--el-border-color); }
.topbar h2 { margin: 0; font-size: 17px; letter-spacing: 0; }.connection-state { margin-left: auto; color: var(--el-text-color-secondary); }.db-select { width: 110px; }
.workspace { height: calc(100% - 53px); display: grid; grid-template-columns: 220px 300px minmax(380px, 1fr); min-height: 0; }
.connections,.key-list { min-width: 0; border-right: 1px solid var(--el-border-color); display: flex; flex-direction: column; }.pane-head { height: 50px; padding: 0 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--el-border-color); }.pane-head strong { margin-right: auto; }
.connection-item,.key-item { width: 100%; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); background: transparent; color: inherit; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; }.connection-item { min-height: 52px; padding: 6px 10px; }.connection-item.active,.key-item.active { background: var(--el-color-primary-light-9); }.redis-mark { width: 25px; height: 25px; display: grid; place-items: center; background: #c93636; color: white; font-weight: 700; border-radius: 4px; }.connection-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }.connection-actions { display: none; margin-left: auto; white-space: nowrap; }.connection-item:hover .connection-actions { display: inline-flex; }
.search-row { display: grid; grid-template-columns: 1fr 32px 32px; gap: 6px; padding: 9px; border-bottom: 1px solid var(--el-border-color); }.key-item { min-height: 40px; padding: 6px 10px; }.key-item span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; }.key-item small { color: var(--el-text-color-secondary); }
.editor { min-width: 0; }.readonly { color: var(--el-color-warning); }.key-form { padding: 14px; }.key-meta { display: grid; grid-template-columns: minmax(160px, 1fr) 130px 150px; gap: 10px; }.value-editor :deep(textarea),.terminal-output,.command-row { font-family: Consolas, 'Courier New', monospace; font-size: 13px; }
.cli { grid-column: 2 / 4; min-width: 0; display: flex; flex-direction: column; background: #171a1f; color: #dce3ea; }.terminal-output { flex: 1; overflow: auto; padding: 16px; }.welcome { color: #8ea1b2; margin-bottom: 14px; }.prompt { color: #6ed89b; }.cli-block pre { margin: 4px 0 14px; white-space: pre-wrap; color: #dce3ea; }.cli-block pre.error { color: #ff7474; }.command-row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #333b45; }.command-row :deep(.el-input__wrapper) { background: #20252c; box-shadow: none; }.command-row :deep(input) { color: #fff; }.no-connection { grid-column: 2 / 4; }.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.switches { display: flex; gap: 24px; }
@media (max-width: 900px) { .workspace { grid-template-columns: 180px minmax(220px, 1fr); }.editor { grid-column: 1 / 3; position: fixed; inset: 100px 10px 10px; z-index: 20; background: var(--el-bg-color); border: 1px solid var(--el-border-color); overflow: auto; }.key-meta,.form-grid { grid-template-columns: 1fr; }.connection-state { display: none; }.cli { grid-column: 2; } }
</style>
