<script lang="ts" setup>
/**
 * AI 结构文档抽屉。
 *
 * 联动（父组件 index.vue）：
 * - askAi → onSchemaDocAskAi：先改当前 Tab 实例，再打开 AiChatWindow（scene=schema_doc）
 * - selectInstance → onSelectInstance：编辑器实例下拉跟随
 * - openSql → onSchemaDocOpenSql：新开查询 Tab
 *
 * 耗时任务（初始化/生成/分析）提交后走右上角后台任务面板，不再在抽屉里轮询。
 * 后端：/admin/aiSchemaDoc/* ；记忆面板：/admin/aiAgentMemory/*
 * @author yanch
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listSelectableModels } from '#/api/ai/model';
import {
  digestAgentMemory,
  exportSchemaDoc,
  extractSchemaDocTaskId,
  generateSchemaDoc,
  getAgentMemoryPair,
  getSchemaDoc,
  initSchemaDoc,
  rollbackSchemaDoc,
  saveSchemaDoc,
  schemaDocDrift,
  schemaDocHistory,
  schemaDocTree,
  unlockSchemaDoc,
  analyzeHistory,
} from '#/api/ai/schemaDoc';
import { getInstances } from '#/api/visual/database';
import { useClientTasks } from '../../composables/useClientTasks';

defineOptions({ name: 'SchemaDocDrawer' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string | null;
  instanceName?: string;
  connLabel?: string;
  instanceOptions?: string[];
  instanceLabel?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [boolean];
  askAi: [{ message: string; instanceName: string }];
  selectInstance: [string];
  openSql: [{ tableName: string; instanceName: string }];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const tree = ref<any>(null);
const current = ref<any>(null);
const viewingMemory = ref(false);
const memoryPair = ref<any>(null);
const editing = ref(false);
const editMd = ref('');
const history = ref<any[]>([]);
const models = ref<any[]>([]);
const modelId = ref<any>();
const selectedInstance = ref('');
const localInstances = ref<string[]>([]);
const tableKeyword = ref('');
const genLoading = ref(false);
const initLoading = ref(false);
const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  table: null as any,
});
/** 最近一次只读漂移探测，表名可点生成 */
const drift = ref<{ newTables?: string[]; changedTables?: string[]; droppedTables?: string[] } | null>(
  null,
);
/** 本抽屉提交过的 taskId，完成后刷新左侧树 */
const submittedTaskIds = new Set<string>();
const { trackSchema, tasks: clientTasks } = useClientTasks();

const instLabel = computed(() => props.instanceLabel || '实例');
const instanceList = computed(() => {
  // 父组件已拉过实例列表就用它；否则抽屉自己调 getInstances 兜底
  const fromProp = props.instanceOptions || [];
  const merged = fromProp.length ? fromProp : localInstances.value;
  return merged.filter(Boolean);
});
const currentScopeText = computed(() => {
  const conn = props.connLabel || (props.dbConfigId != null ? `连接#${props.dbConfigId}` : '未选连接');
  const inst = selectedInstance.value || '未选实例';
  return `${conn} / ${inst}`;
});

const treeData = computed(() => {
  const inst = selectedInstance.value || tree.value?.instanceName || '未选实例';
  const tables = (tree.value?.tables || []).filter((t: any) => {
    if (!tableKeyword.value) return true;
    const kw = tableKeyword.value.toLowerCase();
    return String(t.tableName || '')
      .toLowerCase()
      .includes(kw);
  });
  return [
    {
      id: 'inst',
      label: inst,
      isInstance: true,
      children: tables.map((t: any) => ({
        id: t.docId || `t:${t.tableName}`,
        label: `${statusIcon(t)} ${t.tableName}`,
        docId: t.docId,
        tableName: t.tableName,
        status: t.status,
        userLocked: t.userLocked,
        filled: t.filled,
        source: t.source,
      })),
    },
  ];
});

function statusIcon(t: any) {
  if (t.userLocked === 1) return '🔒';
  if (t.status === 'DROPPED') return '🔴';
  if (t.status === 'STALE') return '🟡';
  if (t.status === 'NONE' || !t.docId) return '⚪';
  if (t.filled === false) return '○';
  return '🟢';
}

function unwrap(res: any) {
  return res?.data ?? res;
}

async function ensureInstances() {
  if ((props.instanceOptions || []).length || !props.dbConfigId) return;
  try {
    const res: any = await getInstances(props.dbConfigId);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    localInstances.value = instances.map((i: any) => i.instanceName).filter(Boolean);
  } catch {
    localInstances.value = [];
  }
}

async function loadTree() {
  if (!props.dbConfigId || !selectedInstance.value) {
    tree.value = null;
    return;
  }
  const res: any = await schemaDocTree({
    dbConfigId: props.dbConfigId,
    instanceName: selectedInstance.value,
  });
  tree.value = unwrap(res);
}

async function onNode(node: any) {
  if (node?.isInstance) return;
  if (!node?.tableName && !node?.docId) return;
  viewingMemory.value = false;
  if (!node?.docId) {
    current.value = {
      tableName: node.tableName,
      contentMd: `表 \`${node.tableName}\` 尚未初始化骨架。可直接点「生成所选表」让 AI 写文档，或先「初始化表骨架」。`,
      _uninitialized: true,
    };
    editing.value = false;
    history.value = [];
    return;
  }
  const res: any = await getSchemaDoc(node.docId);
  current.value = unwrap(res);
  editing.value = false;
  const h: any = await schemaDocHistory(node.docId);
  history.value = unwrap(h) || [];
}

function onInstanceChange(name: string) {
  selectedInstance.value = name;
  current.value = null;
  viewingMemory.value = false;
  memoryPair.value = null;
  drift.value = null;
  if (name) emit('selectInstance', name);
  void loadTree();
}

watch(visible, async (v) => {
  if (!v) {
    hideCtx();
    return;
  }
  // 打开抽屉：优先跟编辑器当前实例；都空则取下拉第一项
  selectedInstance.value = props.instanceName || selectedInstance.value || '';
  await ensureInstances();
  if (!selectedInstance.value && instanceList.value[0]) {
    selectedInstance.value = instanceList.value[0];
  }
  try {
    await loadTree();
  } catch (e: any) {
    ElMessage.error(e?.message || '加载结构文档失败');
  }
  const m: any = await listSelectableModels();
  models.value = m.data || [];
  if (!modelId.value) {
    for (const g of models.value) {
      const d = (g.models || []).find((x: any) => x.isDefault === 1);
      if (d) {
        modelId.value = d.id;
        break;
      }
    }
  }
});

watch(
  () => props.instanceName,
  (n) => {
    if (n && n !== selectedInstance.value && visible.value) {
      selectedInstance.value = n;
      void loadTree();
    }
  },
);

function requireScope(): boolean {
  if (!props.dbConfigId) {
    ElMessage.warning('请先打开数据库连接');
    return false;
  }
  if (!selectedInstance.value) {
    ElMessage.warning(`请先在顶部选择${instLabel.value}`);
    return false;
  }
  return true;
}

async function doInit() {
  if (!requireScope()) return;
  try {
    await ElMessageBox.confirm(
      `将为「${currentScopeText.value}」初始化结构文档骨架：拉取该实例下的全部表并生成表级文档。关系画布若有配置，只会作为关联补充，不再决定左侧分组。`,
      '确认初始化',
      { type: 'info', confirmButtonText: '开始初始化' },
    );
  } catch {
    return;
  }
  initLoading.value = true;
  try {
    const res: any = await initSchemaDoc({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
    });
    const taskId = extractSchemaDocTaskId(res);
    if (!taskId) {
      ElMessage.error('已提交但未拿到任务编号，请查看后台日志');
      return;
    }
    submittedTaskIds.add(taskId);
    await trackSchema(taskId, {
      kind: 'SCHEMA_INIT',
      title: '初始化骨架',
      subtitle: currentScopeText.value,
    });
    ElMessage.success(`已提交初始化（${currentScopeText.value}），进度见右上角`);
  } catch (e: any) {
    ElMessage.error(e?.message || e?.msg || '提交初始化失败');
  } finally {
    initLoading.value = false;
  }
}

async function startGen(mode: 'FULL' | 'INCREMENTAL' | 'TABLES', tables?: string[]) {
  if (!requireScope()) return;
  if (!modelId.value) {
    ElMessage.warning('请先选择模型');
    return;
  }
  // TABLES 模式：右键传入的表优先，否则用当前右侧正在看的表
  const picked = tables?.length
    ? tables
    : current.value?.tableName
      ? [current.value.tableName]
      : undefined;
  if (mode === 'TABLES' && (!picked || !picked.length)) {
    ElMessage.warning('请先在左侧选中一张表');
    return;
  }
  genLoading.value = true;
  try {
    const res: any = await generateSchemaDoc({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
      modelId: modelId.value,
      mode,
      tables: mode === 'TABLES' ? picked : undefined,
    });
    const taskId = extractSchemaDocTaskId(res);
    if (!taskId) {
      ElMessage.error('已提交但未拿到任务编号，请查看后台日志');
      return;
    }
    const label =
      mode === 'FULL' ? '全量生成' : mode === 'INCREMENTAL' ? '增量更新' : `生成表 ${picked?.join(', ')}`;
    submittedTaskIds.add(taskId);
    await trackSchema(taskId, {
      kind: 'SCHEMA_GENERATE',
      title: label,
      subtitle: currentScopeText.value,
    });
    ElMessage.success(`已提交「${label}」（${currentScopeText.value}），进度见右上角`);
  } catch (e: any) {
    ElMessage.error(e?.message || e?.msg || '提交生成任务失败');
  } finally {
    genLoading.value = false;
  }
}

async function doAnalyze() {
  if (!requireScope()) return;
  try {
    const res: any = await analyzeHistory({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
    });
    const taskId = extractSchemaDocTaskId(res);
    if (!taskId) {
      ElMessage.error('分析任务未返回编号');
      return;
    }
    submittedTaskIds.add(taskId);
    await trackSchema(taskId, {
      kind: 'SCHEMA_ANALYZE',
      title: '分析查询历史',
      subtitle: currentScopeText.value,
    });
    ElMessage.success('已提交查询历史分析，进度见右上角');
  } catch (e: any) {
    ElMessage.error(e?.message || e?.msg || '分析失败');
  }
}

watch(
  clientTasks,
  (list) => {
    // 本抽屉提交的任务一旦终态，刷新左侧树（进度本身在右上角面板）
    let needReload = false;
    for (const t of list) {
      if (t.source !== 'schema' || !submittedTaskIds.has(t.id)) continue;
      if (['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(t.status)) {
        submittedTaskIds.delete(t.id);
        if (t.status === 'SUCCESS') ElMessage.success(t.message || '任务完成');
        else if (t.status === 'PARTIAL') ElMessage.warning(t.message || '部分完成');
        else if (t.status === 'FAILED') ElMessage.error(t.message || '任务失败');
        else ElMessage.info('任务已取消');
        needReload = true;
      }
    }
    if (needReload && visible.value) {
      const name = current.value?.tableName;
      const docId = current.value?.id;
      void loadTree().then(() => {
        if (docId) {
          void onNode({ docId, tableName: name });
          return;
        }
        const t = (tree.value?.tables || []).find((x: any) => x.tableName === name);
        if (t) void onNode(t);
      });
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  hideCtx();
});

async function doSave() {
  await saveSchemaDoc({ id: current.value.id, contentMd: editMd.value });
  ElMessage.success('已保存并锁定');
  await onNode({ docId: current.value.id });
}
async function doUnlock() {
  await unlockSchemaDoc(current.value.id);
  await onNode({ docId: current.value.id });
}
async function doRollback(ver: number) {
  await rollbackSchemaDoc({ docId: current.value.id, version: ver });
  await onNode({ docId: current.value.id });
}
async function doDrift() {
  if (!requireScope()) return;
  try {
    const res: any = await schemaDocDrift({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
    });
    drift.value = unwrap(res) || {};
    await loadTree();
    const d = drift.value;
    const n = d?.newTables?.length || 0;
    const c = d?.changedTables?.length || 0;
    const x = d?.droppedTables?.length || 0;
    if (n + c + x === 0) {
      ElMessage.success('未发现结构变化');
    } else {
      ElMessage.info(`新表 ${n}，变更 ${c}，已删 ${x}。可点下方表名生成文档。`);
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '检测失败');
  }
}
function onMoreCommand(cmd: string) {
  if (cmd === 'analyze') void doAnalyze();
  if (cmd === 'memory') void openMemory();
  if (cmd === 'digest') void refreshMemory();
  if (cmd === 'export') void doExport();
}
async function doExport() {
  if (!requireScope()) return;
  const blob: any = await exportSchemaDoc({
    dbConfigId: props.dbConfigId!,
    instanceName: selectedInstance.value,
  });
  const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `schema-${selectedInstance.value || 'doc'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function askAi(tableName?: string) {
  if (!requireScope()) return;
  const table = tableName || current.value?.tableName || '';
  emit('askAi', {
    message: table
      ? `请结合当前实例「${selectedInstance.value}」为表 ${table} 补充说明，并回答我接下来的问题。`
      : `请结合当前实例「${selectedInstance.value}」回答我关于这个库的问题。`,
    instanceName: selectedInstance.value,
  });
}

async function openMemory() {
  if (!requireScope()) return;
  try {
    const res: any = await getAgentMemoryPair({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
    });
    memoryPair.value = unwrap(res);
    viewingMemory.value = true;
    current.value = null;
  } catch (e: any) {
    ElMessage.error(e?.message || '读取记忆失败');
  }
}

async function refreshMemory() {
  if (!requireScope()) return;
  if (!modelId.value) {
    ElMessage.warning('请先选择模型');
    return;
  }
  try {
    await digestAgentMemory({
      dbConfigId: props.dbConfigId!,
      instanceName: selectedInstance.value,
      modelId: modelId.value,
    });
    ElMessage.success('已根据未总结的对话与查询历史刷新记忆');
    await openMemory();
  } catch (e: any) {
    ElMessage.error(e?.message || '刷新记忆失败');
  }
}

function onTreeContext(e: MouseEvent, data: any) {
  if (!data?.tableName) return;
  e.preventDefault();
  ctxMenu.visible = true;
  ctxMenu.x = e.clientX;
  ctxMenu.y = e.clientY;
  ctxMenu.table = data;
  window.addEventListener('click', hideCtx, { once: true });
}
function hideCtx() {
  ctxMenu.visible = false;
}
function ctxAction(action: string) {
  const t = ctxMenu.table;
  hideCtx();
  if (!t) return;
  if (action === 'view') void onNode(t);
  if (action === 'gen') void startGen('TABLES', [t.tableName]);
  if (action === 'ask') askAi(t.tableName);
  if (action === 'copy') {
    void navigator.clipboard?.writeText(t.tableName);
    ElMessage.success('已复制表名');
  }
  if (action === 'sql') {
    emit('openSql', {
      tableName: t.tableName,
      instanceName: selectedInstance.value,
    });
  }
}

const previewHtml = computed(() =>
  DOMPurify.sanitize(md.render(current.value?.contentMd || '')),
);
const instanceMemHtml = computed(() =>
  DOMPurify.sanitize(md.render(memoryPair.value?.instance?.contentMd || memoryPair.value?.instance?.summary || '_暂无实例记忆_')),
);
const userMemHtml = computed(() =>
  DOMPurify.sanitize(md.render(memoryPair.value?.user?.contentMd || memoryPair.value?.user?.summary || '_暂无个人使用记忆_')),
);
const relations = computed(() => {
  try {
    return JSON.parse(current.value?.relationsJson || '[]');
  } catch {
    return [];
  }
});
const keyFields = computed(() => {
  try {
    return JSON.parse(current.value?.keyFieldsJson || '[]');
  } catch {
    return [];
  }
});
</script>

<template>
  <ElDrawer v-model="visible" :title="$tr('AI 结构文档')" size="72%" class="schema-doc-drawer" append-to-body>
    <div class="scope">
      <span class="scope-k">{{ $tr('当前目标') }}</span>
      <strong>{{ $tr(connLabel || '未选连接') }}</strong>
      <span class="scope-sep">/</span>
      <ElSelect
        v-model="selectedInstance"
        size="small"
        filterable
        :placeholder="`选择${instLabel}`"
        style="width: 220px"
        @change="onInstanceChange"
      >
        <ElOption v-for="n in instanceList" :key="n" :label="n" :value="n" />
      </ElSelect>
    </div>
    <div class="bar">
      <ElSelect v-model="modelId" size="small" :placeholder="$tr('模型')" style="width: 180px">
        <ElOptionGroup v-for="g in models" :key="g.providerName" :label="g.providerName">
          <ElOption v-for="m in g.models" :key="m.id" :label="m.displayName" :value="m.id" />
        </ElOptionGroup>
      </ElSelect>
      <ElButton size="small" :loading="initLoading" @click="doInit">{{ $tr('初始化表骨架') }}</ElButton>
      <ElButton size="small" type="primary" :loading="genLoading" @click="startGen('FULL')">{{ $tr('AI 全量生成') }}</ElButton>
      <ElButton size="small" :loading="genLoading" @click="startGen('INCREMENTAL')">{{ $tr('AI 增量更新') }}</ElButton>
      <ElButton
        size="small"
        :disabled="!current?.tableName"
        :loading="genLoading"
        @click="startGen('TABLES')"
      >
        {{ $tr('生成所选表') }}
      </ElButton>
      <ElButton size="small" @click="doDrift">{{ $tr('检测结构变化') }}</ElButton>
      <ElButton size="small" type="success" @click="askAi()">{{ $tr('问 AI') }}</ElButton>
      <ElDropdown trigger="click" @command="onMoreCommand">
        <ElButton size="small">{{ $tr('更多') }}</ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem command="analyze">{{ $tr('分析查询历史（规则抽 JOIN，不调模型）') }}</ElDropdownItem>
            <ElDropdownItem command="memory">{{ $tr('智能体记忆') }}</ElDropdownItem>
            <ElDropdownItem command="digest">{{ $tr('刷新记忆') }}</ElDropdownItem>
            <ElDropdownItem command="export">{{ $tr('导出 Markdown') }}</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
    <div class="body">
      <div class="left">
        <ElInput v-model="tableKeyword" size="small" clearable :placeholder="$tr('搜索表名')" />
        <div v-if="drift && ((drift.newTables?.length || 0) + (drift.changedTables?.length || 0) + (drift.droppedTables?.length || 0) > 0)" class="drift-box">
          <div v-if="drift.newTables?.length" class="drift-row">
            {{ $tr('新表') }}
            <button
              v-for="n in drift.newTables"
              :key="'n-' + n"
              type="button"
              class="drift-name"
              @click="startGen('TABLES', [n])"
            >
              {{ n }}
            </button>
          </div>
          <div v-if="drift.changedTables?.length" class="drift-row">
            {{ $tr('结构变化') }}
            <button
              v-for="n in drift.changedTables"
              :key="'c-' + n"
              type="button"
              class="drift-name"
              @click="startGen('TABLES', [n])"
            >
              {{ n }}
            </button>
          </div>
          <div v-if="drift.droppedTables?.length" class="drift-row">
            {{ $tr('已删除') }}
            <span v-for="n in drift.droppedTables" :key="'d-' + n" class="drift-dropped">{{ n }}</span>
          </div>
        </div>
        <ElTree
          class="table-tree"
          :data="treeData"
          node-key="id"
          default-expand-all
          highlight-current
          @node-click="onNode"
          @node-contextmenu="onTreeContext"
        />
        <div v-if="!(tree?.tables || []).length" class="left-empty">
          {{ $tr('该实例下没有表，或尚未打开连接') }}
        </div>
      </div>
      <div class="right">
        <template v-if="viewingMemory && memoryPair">
          <h4>{{ $tr('实例知识（所有用户共享，AI 自动维护）') }}</h4>
          <div class="md" v-html="instanceMemHtml" />
          <h4>{{ $tr('我的使用记忆（只属于你，越用越准）') }}</h4>
          <p class="hint">
            {{ $tr('常查表：') }}{{ memoryPair.user?.focusTablesJson || '[]' }}
          </p>
          <div class="md" v-html="userMemHtml" />
        </template>
        <template v-else-if="current">
          <div class="ops">
            <ElButton
              v-if="!current._uninitialized"
              size="small"
              @click="editing = !editing; editMd = current.contentMd || ''"
            >
              {{ $tr(editing ? '预览' : '编辑') }}
            </ElButton>
            <ElButton v-if="editing" size="small" type="primary" @click="doSave">{{ $tr('保存') }}</ElButton>
            <ElButton v-if="current.userLocked === 1" size="small" @click="doUnlock">{{ $tr('解锁') }}</ElButton>
            <ElButton size="small" type="primary" :loading="genLoading" @click="startGen('TABLES')">
              {{ $tr('生成此表') }}
            </ElButton>
            <ElButton size="small" @click="askAi(current.tableName)">{{ $tr('问 AI') }}</ElButton>
          </div>
          <ElInput v-if="editing" v-model="editMd" type="textarea" :rows="18" />
          <div v-else class="md" v-html="previewHtml" />
          <template v-if="!current._uninitialized">
          <h4>{{ $tr('关键字段') }}</h4>
          <ElTable :data="keyFields" size="small">
            <ElTableColumn prop="field" :label="$tr('字段')" />
            <ElTableColumn prop="role" :label="$tr('角色')" />
            <ElTableColumn prop="meaning" :label="$tr('含义')" />
          </ElTable>
          <h4>{{ $tr('关联') }}</h4>
          <ElTable :data="relations" size="small">
            <ElTableColumn prop="table" :label="$tr('表')" />
            <ElTableColumn prop="onSql" label="ON" />
            <ElTableColumn prop="source" :label="$tr('来源')" />
          </ElTable>
          <h4>{{ $tr('版本') }}</h4>
          <div v-for="h in history" :key="h.id" class="hist">
            v{{ h.version }} {{ h.changeNote }} {{ h.createTime }}
            <ElButton link size="small" @click="doRollback(h.version)">{{ $tr('回滚') }}</ElButton>
          </div>
          </template>
        </template>
        <ElEmpty v-else :description="$tr('在左侧选择一张表，或查看智能体记忆')" />
      </div>
    </div>
    <div v-if="tree" class="cov">
      {{ currentScopeText }} {{ $tr('· AI 已填写') }} {{ tree.aiFilledTables ?? 0 }}/{{ tree.totalTables || 0 }}
      （{{ tree.coverage }}{{ $tr('%）· 骨架') }} {{ tree.initializedTables ?? tree.documentedTables ?? 0 }}
      {{ $tr('· 结构变化') }} {{ tree.staleTables ?? 0 }}
    </div>
    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="schema-ctx"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
      >
        <div class="item" @click="ctxAction('view')">{{ $tr('查看文档') }}</div>
        <div class="item" @click="ctxAction('gen')">{{ $tr('AI 生成此表') }}</div>
        <div class="item" @click="ctxAction('ask')">{{ $tr('问 AI') }}</div>
        <div class="item" @click="ctxAction('copy')">{{ $tr('复制表名') }}</div>
        <div class="item" @click="ctxAction('sql')">{{ $tr('在编辑器打开 SELECT') }}</div>
      </div>
    </Teleport>
  </ElDrawer>
</template>

<style scoped>
.scope {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--vc-ui-font-size, 13px);
}
.scope-k {
  color: var(--el-text-color-secondary);
}
.scope-sep {
  opacity: 0.45;
}
.bar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
/* 占满抽屉剩余高度，避免 calc(100vh - N) 留下底部空白 */
.body {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}
.left,
.right {
  min-height: 0;
  overflow: auto;
}
.left {
  display: flex;
  flex-direction: column;
  padding-right: 8px;
  border-right: 1px solid var(--el-border-color-lighter);
}
.table-tree {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 8px;
  overflow: auto;
}
.left-empty {
  margin-top: 16px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
.drift-box {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-regular);
}
.drift-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 4px;
}
.drift-name {
  padding: 0 6px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 4px;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
}
.drift-name:hover {
  background: var(--el-color-primary-light-9);
}
.drift-dropped {
  opacity: 0.7;
}
.md {
  font-size: var(--vc-ui-font-size, 13px);
  line-height: 1.55;
}
.md :deep(p) {
  margin: 6px 0;
}
.cov {
  flex-shrink: 0;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
.hist {
  font-size: var(--vc-ui-font-size-sm, 12px);
}
.hint {
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
.ops {
  margin-bottom: 8px;
}
</style>

<style>
.schema-ctx {
  position: fixed;
  z-index: 4100;
  min-width: 180px;
  padding: 4px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  font-size: 13px;
}
.schema-ctx .item {
  padding: 8px 14px;
  cursor: pointer;
}
.schema-ctx .item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
/* 收紧标题与「当前目标」间距，正文区用 flex 铺满到底 */
.schema-doc-drawer.el-drawer {
  display: flex;
  flex-direction: column;
}
.schema-doc-drawer .el-drawer__header {
  margin-bottom: 0;
  padding: 12px 16px 8px;
}
.schema-doc-drawer .el-drawer__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  padding: 8px 16px 12px;
  overflow: hidden;
}
</style>
