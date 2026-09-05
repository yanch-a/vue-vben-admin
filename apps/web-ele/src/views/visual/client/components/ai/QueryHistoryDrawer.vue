<script lang="ts" setup>
/**
 * 查询历史抽屉
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listSelectableModels } from '#/api/ai/model';
import { analyzeHistory } from '#/api/ai/schemaDoc';
import { clearSqlHistory, deleteSqlHistory, pageSqlHistory } from '#/api/ai/sqlHistory';

defineOptions({ name: 'QueryHistoryDrawer' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string | null;
  instanceName?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [boolean];
  openSql: [string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const query = reactive({
  keyword: '',
  status: undefined as number | undefined,
  source: '',
  pageNum: 1,
  pageSize: 20,
});
const list = ref<any[]>([]);
const total = ref(0);
const selected = ref<any[]>([]);
const models = ref<any[]>([]);
const modelId = ref<any>();

async function load() {
  if (!props.dbConfigId) return;
  const res: any = await pageSqlHistory({
    dbConfigId: props.dbConfigId,
    instanceName: props.instanceName,
    keyword: query.keyword || undefined,
    status: query.status,
    source: query.source || undefined,
    pageNum: query.pageNum,
    pageSize: query.pageSize,
  });
  list.value = res.list || res.data?.list || [];
  total.value = res.total || res.data?.total || 0;
}

watch(visible, async (v) => {
  if (v) {
    await load();
    const m: any = await listSelectableModels();
    models.value = m.data || [];
  }
});

async function onDel(row: any) {
  await deleteSqlHistory(row.id);
  load();
}
async function onClear() {
  await ElMessageBox.confirm('确认清空本实例历史？');
  await clearSqlHistory({ dbConfigId: props.dbConfigId!, instanceName: props.instanceName });
  load();
}
async function onAnalyze() {
  if (!modelId.value) {
    ElMessage.warning('请选择模型');
    return;
  }
  const ids = selected.value.map((r) => r.id);
  await analyzeHistory({
    dbConfigId: props.dbConfigId!,
    instanceName: props.instanceName!,
    modelId: modelId.value,
    historyIds: ids,
  });
  ElMessage.success('已提交任务，可在结构文档抽屉查看进度');
}

async function copySql(sql: string) {
  try {
    await navigator.clipboard.writeText(sql);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

function preview(sql: string) {
  return (sql || '').replace(/\s+/g, ' ').slice(0, 80);
}
</script>

<template>
  <ElDrawer v-model="visible" title="查询历史" size="60%">
    <div class="bar">
      <ElInput v-model="query.keyword" size="small" placeholder="关键字" clearable style="width: 180px" @change="load" />
      <ElSelect v-model="query.status" size="small" clearable placeholder="状态" style="width: 100px" @change="load">
        <ElOption :value="1" label="成功" />
        <ElOption :value="0" label="失败" />
      </ElSelect>
      <ElSelect v-model="query.source" size="small" clearable placeholder="来源" style="width: 120px" @change="load">
        <ElOption value="manual" label="手工" />
        <ElOption value="ai" label="AI" />
        <ElOption value="agent_tool" label="Agent" />
      </ElSelect>
      <ElSelect v-model="modelId" size="small" placeholder="分析模型" style="width: 180px">
        <ElOptionGroup v-for="g in models" :key="g.providerName" :label="g.providerName">
          <ElOption v-for="m in g.models" :key="m.id" :label="m.displayName" :value="m.id" />
        </ElOptionGroup>
      </ElSelect>
      <ElButton size="small" :disabled="!selected.length" @click="onAnalyze">AI 分析关联关系</ElButton>
      <ElButton size="small" type="danger" @click="onClear">清空</ElButton>
    </div>
    <ElTable :data="list" size="small" @selection-change="selected = $event">
      <ElTableColumn type="selection" width="42" />
      <ElTableColumn label="时间" width="170">
        <template #default="{ row }">{{ row.executedAt }}</template>
      </ElTableColumn>
      <ElTableColumn label="SQL">
        <template #default="{ row }">
          <ElTooltip :content="row.sqlText" placement="top">
            <span>{{ preview(row.sqlText) }}</span>
          </ElTooltip>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="status" label="状态" width="70">
        <template #default="{ row }">
          <ElTag :type="row.status === 1 ? 'success' : 'danger'" size="small">
            {{ row.status === 1 ? '成功' : '失败' }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="rowCount" label="行数" width="70" />
      <ElTableColumn prop="elapsedMs" label="耗时" width="80" />
      <ElTableColumn prop="source" label="来源" width="90" />
      <ElTableColumn label="操作" width="160">
        <template #default="{ row }">
          <ElButton link size="small" @click="emit('openSql', row.sqlText)">打开</ElButton>
          <ElButton link size="small" @click="copySql(row.sqlText)">复制</ElButton>
          <ElButton link size="small" type="danger" @click="onDel(row)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElPagination
      v-model:current-page="query.pageNum"
      v-model:page-size="query.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
  </ElDrawer>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
</style>
