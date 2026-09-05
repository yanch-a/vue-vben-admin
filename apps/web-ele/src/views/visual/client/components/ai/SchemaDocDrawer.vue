<script lang="ts" setup>
/**
 * Schema 结构文档抽屉
 * @author yanch
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listSelectableModels } from '#/api/ai/model';
import {
  cancelSchemaDocTask,
  exportSchemaDoc,
  generateSchemaDoc,
  getSchemaDoc,
  initSchemaDoc,
  rollbackSchemaDoc,
  saveSchemaDoc,
  schemaDocDrift,
  schemaDocHistory,
  schemaDocTask,
  schemaDocTree,
  unlockSchemaDoc,
  analyzeHistory,
} from '#/api/ai/schemaDoc';

defineOptions({ name: 'SchemaDocDrawer' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string | null;
  instanceName?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [boolean];
  askAi: [{ message: string }];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const tree = ref<any>(null);
const current = ref<any>(null);
const editing = ref(false);
const editMd = ref('');
const history = ref<any[]>([]);
const task = ref<any>(null);
const models = ref<any[]>([]);
const modelId = ref<any>();
let poll: any = null;

const treeData = computed(() => {
  if (!tree.value) return [];
  const domains = (tree.value.domains || []).map((d: any) => ({
    id: 'd-' + d.domainCode,
    label: d.domainName || d.domainCode,
    docId: d.docId,
    children: (d.tables || []).map((t: any) => ({
      id: t.docId,
      label: `${statusIcon(t)} ${t.tableName}`,
      docId: t.docId,
      tableName: t.tableName,
    })),
  }));
  if (tree.value.overview) {
    return [{ id: 'ov', label: '实例总览', docId: tree.value.overview.docId, children: domains }];
  }
  return domains;
});

function statusIcon(t: any) {
  if (t.userLocked === 1) return '🔒';
  if (t.status === 'STALE') return '🟡';
  if (t.status === 'DROPPED') return '🔴';
  return '🟢';
}

async function loadTree() {
  if (!props.dbConfigId || !props.instanceName) return;
  const res: any = await schemaDocTree({ dbConfigId: props.dbConfigId, instanceName: props.instanceName });
  tree.value = unwrap(res);
}

async function onNode(node: any) {
  if (!node?.docId) return;
  const res: any = await getSchemaDoc(node.docId);
  current.value = unwrap(res);
  editing.value = false;
  const h: any = await schemaDocHistory(node.docId);
  history.value = unwrap(h) || [];
}

watch(visible, async (v) => {
  if (v) {
    await loadTree();
    const m: any = await listSelectableModels();
    models.value = m.data || [];
    for (const g of models.value) {
      const d = (g.models || []).find((x: any) => x.isDefault === 1);
      if (d) {
        modelId.value = d.id;
        break;
      }
    }
  }
});

async function doInit() {
  await initSchemaDoc({ dbConfigId: props.dbConfigId!, instanceName: props.instanceName! });
  ElMessage.success('已初始化骨架');
  await loadTree();
}

function unwrap(res: any) {
  return res?.data ?? res;
}

async function startGen(mode: 'FULL' | 'INCREMENTAL' | 'TABLES') {
  if (!modelId.value) {
    ElMessage.warning('请选择模型');
    return;
  }
  const tables = current.value?.tableName ? [current.value.tableName] : undefined;
  const res: any = await generateSchemaDoc({
    dbConfigId: props.dbConfigId!,
    instanceName: props.instanceName!,
    modelId: modelId.value,
    mode,
    tables: mode === 'TABLES' ? tables : undefined,
  });
  startPoll(String(unwrap(res)));
}

async function doAnalyze() {
  const res: any = await analyzeHistory({
    dbConfigId: props.dbConfigId!,
    instanceName: props.instanceName!,
    modelId: modelId.value,
  });
  startPoll(String(unwrap(res)));
}

function startPoll(taskId: string) {
  if (!taskId || taskId === 'undefined' || taskId === 'null') return;
  stopPoll();
  poll = setInterval(async () => {
    const res: any = await schemaDocTask(taskId);
    task.value = unwrap(res);
    const st = task.value?.status;
    if (['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(st)) {
      stopPoll();
      loadTree();
    }
  }, 2000);
}
function stopPoll() {
  if (poll) clearInterval(poll);
  poll = null;
}

onBeforeUnmount(stopPoll);

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
  const res: any = await schemaDocDrift({ dbConfigId: props.dbConfigId!, instanceName: props.instanceName! });
  const d = res.data || {};
  await ElMessageBox.alert(
    `新表 ${d.newTables?.length || 0}，变更 ${d.changedTables?.length || 0}，删除 ${d.droppedTables?.length || 0}`,
    '结构变化',
  );
}
async function doExport() {
  const blob: any = await exportSchemaDoc({ dbConfigId: props.dbConfigId!, instanceName: props.instanceName! });
  const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schema.md';
  a.click();
  URL.revokeObjectURL(url);
}

const previewHtml = computed(() =>
  DOMPurify.sanitize(md.render(current.value?.contentMd || '')),
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
  <ElDrawer v-model="visible" title="AI 结构文档" size="70%">
    <div class="bar">
      <ElSelect v-model="modelId" size="small" placeholder="模型" style="width: 180px">
        <ElOptionGroup v-for="g in models" :key="g.providerName" :label="g.providerName">
          <ElOption v-for="m in g.models" :key="m.id" :label="m.displayName" :value="m.id" />
        </ElOptionGroup>
      </ElSelect>
      <ElButton size="small" @click="doInit">初始化(画布)</ElButton>
      <ElButton size="small" type="primary" @click="startGen('FULL')">AI 全量生成</ElButton>
      <ElButton size="small" @click="startGen('INCREMENTAL')">AI 增量更新</ElButton>
      <ElButton size="small" :disabled="!current?.tableName" @click="startGen('TABLES')">生成所选表</ElButton>
      <ElButton size="small" @click="doAnalyze">分析查询历史</ElButton>
      <ElButton size="small" @click="doDrift">检测结构变化</ElButton>
      <ElButton size="small" @click="doExport">导出 .md</ElButton>
      <ElButton
        size="small"
        @click="emit('askAi', { message: `请为表 ${current?.tableName || ''} 补充说明文档` })"
      >
        问 AI
      </ElButton>
      <ElButton v-if="task && ['PENDING','RUNNING'].includes(task.status)" size="small" type="danger" @click="cancelSchemaDocTask(task.taskId)">
        取消任务
      </ElButton>
    </div>
    <ElProgress v-if="task" :percentage="task.total ? Math.round((task.done / task.total) * 100) : 0" />
    <div class="body">
      <ElTree :data="treeData" node-key="id" default-expand-all highlight-current @node-click="onNode" />
      <div class="right">
        <template v-if="current">
          <div class="ops">
            <ElButton size="small" @click="editing = !editing; editMd = current.contentMd || ''">
              {{ editing ? '预览' : '编辑' }}
            </ElButton>
            <ElButton v-if="editing" size="small" type="primary" @click="doSave">保存</ElButton>
            <ElButton v-if="current.userLocked === 1" size="small" @click="doUnlock">解锁</ElButton>
          </div>
          <ElInput v-if="editing" v-model="editMd" type="textarea" :rows="18" />
          <div v-else class="md" v-html="previewHtml" />
          <h4>关键字段</h4>
          <ElTable :data="keyFields" size="small">
            <ElTableColumn prop="field" label="字段" />
            <ElTableColumn prop="role" label="角色" />
            <ElTableColumn prop="meaning" label="含义" />
          </ElTable>
          <h4>关联</h4>
          <ElTable :data="relations" size="small">
            <ElTableColumn prop="table" label="表" />
            <ElTableColumn prop="onSql" label="ON" />
            <ElTableColumn prop="source" label="来源" />
          </ElTable>
          <h4>版本</h4>
          <div v-for="h in history" :key="h.id" class="hist">
            v{{ h.version }} {{ h.changeNote }} {{ h.createTime }}
            <ElButton link size="small" @click="doRollback(h.version)">回滚</ElButton>
          </div>
        </template>
        <ElEmpty v-else description="选择左侧文档" />
      </div>
    </div>
    <div v-if="tree" class="cov">覆盖率 {{ tree.coverage }}% （{{ tree.documentedTables }}/{{ tree.totalTables }}）</div>
  </ElDrawer>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.body { display: grid; grid-template-columns: 260px 1fr; gap: 12px; min-height: 60vh; }
.right { overflow: auto; }
.md :deep(p) { margin: 6px 0; }
.cov { margin-top: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.hist { font-size: 12px; }
</style>
