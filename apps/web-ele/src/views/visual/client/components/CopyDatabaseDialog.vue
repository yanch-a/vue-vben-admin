<script lang="ts" setup>
/**
 * 将数据库/表复制到不同主机（参考 SQLyog）
 * - 左侧：来源对象勾选（第一期仅表可勾选，其它类型置灰）
 * - 右侧：目标连接与实例、结构/数据选项
 * - 确认后异步启动任务，由父组件打开进度面板
 *
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { getInstances, getTables } from '#/api/visual/database';
import { startDbCopy, type DbCopyTaskVO } from '#/api/visual/dbCopy';
import { getDbConfigList } from '#/api/visual/vq';
import { visualClientConfig } from '../config';
import { resolveSqlDialect } from '../dialect/sqlDialect';
import type { DbConnection } from '../composables/useConnectionStore';

import { ElMessage } from 'element-plus';

defineOptions({ name: 'CopyDatabaseDialog' });

const props = defineProps<{
  modelValue: boolean;
  sourceConnection: DbConnection | null;
  sourceInstance: string;
  /** 右键单表时预勾选 */
  preselectedTables?: string[];
  /** 已打开的连接（优先作为目标候选） */
  openConnections?: DbConnection[];
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  started: [task: DbCopyTaskVO];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const sourceLabel = computed(() => {
  const c = props.sourceConnection;
  if (!c) return '-';
  const host = c.dbHost || c.dbName || String(c.id);
  return `${host} - ${props.sourceInstance || ''}`;
});

const sourceDialect = computed(() =>
  resolveSqlDialect(props.sourceConnection?.dbType),
);

const showIgnoreDefiner = computed(
  () => sourceDialect.value.family === 'MYSQL_LIKE',
);

const loadingTables = ref(false);
const loadingTargets = ref(false);
const loadingInstances = ref(false);
const submitting = ref(false);

const tableNames = ref<string[]>([]);
const checkedTables = ref<string[]>([]);
const tablesExpanded = ref(true);

const targetConfigs = ref<
  { id: number | string; label: string; dbType?: string }[]
>([]);
const targetInstances = ref<string[]>([]);

const form = reactive({
  targetDbConfigId: null as number | string | null,
  targetInstance: '',
  mode: 'both' as 'structure' | 'both',
  dropIfExists: true,
  bulkInsert: true,
  ignoreDefiner: false,
});

async function loadTables() {
  if (!props.sourceConnection?.id || !props.sourceInstance) {
    tableNames.value = [];
    checkedTables.value = [];
    return;
  }
  loadingTables.value = true;
  try {
    const res: any = await getTables(
      props.sourceConnection.id,
      props.sourceInstance,
    );
    const list = (res?.data || res || [])
      .map((t: any) => t.tableName)
      .filter(Boolean);
    tableNames.value = list;
    const pre = (props.preselectedTables || []).filter((t) => list.includes(t));
    checkedTables.value = pre.length ? pre : [...list];
  } catch {
    tableNames.value = [];
    checkedTables.value = [];
  } finally {
    loadingTables.value = false;
  }
}

async function loadTargetConfigs() {
  loadingTargets.value = true;
  try {
    const open = props.openConnections || [];
    const fromOpen = open.map((c) => ({
      id: c.id,
      label: `${c.dbHost || c.dbName || c.id} (${c.dbName || c.id})`,
      dbType: c.dbType,
    }));
    const res: any = await getDbConfigList({});
    const list = res?.data || res || [];
    const fromAll = (Array.isArray(list) ? list : []).map((c: any) => ({
      id: c.id,
      label: `${c.dbHost || c.dbName || c.id} (${c.dbName || c.id})`,
      dbType: c.dbType,
    }));
    // 合并：已打开优先，去重
    const map = new Map<string, { id: number | string; label: string; dbType?: string }>();
    [...fromOpen, ...fromAll].forEach((item) => {
      map.set(String(item.id), item);
    });
    targetConfigs.value = [...map.values()];
    // 默认选中：若有其它打开连接则选第一个不同的，否则仍可选同源
    const srcId = props.sourceConnection?.id;
    const other = targetConfigs.value.find((c) => String(c.id) !== String(srcId));
    form.targetDbConfigId = other?.id ?? targetConfigs.value[0]?.id ?? null;
  } catch {
    targetConfigs.value = [];
  } finally {
    loadingTargets.value = false;
  }
}

async function loadTargetInstances() {
  if (!form.targetDbConfigId) {
    targetInstances.value = [];
    form.targetInstance = '';
    return;
  }
  loadingInstances.value = true;
  try {
    const res: any = await getInstances(form.targetDbConfigId);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    targetInstances.value = (instances || [])
      .map((i: any) => i.instanceName || i.name)
      .filter(Boolean);
    if (
      !form.targetInstance ||
      !targetInstances.value.includes(form.targetInstance)
    ) {
      form.targetInstance = targetInstances.value[0] || '';
    }
  } catch {
    targetInstances.value = [];
    form.targetInstance = '';
  } finally {
    loadingInstances.value = false;
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return;
    form.mode = 'both';
    form.dropIfExists = true;
    form.bulkInsert = true;
    form.ignoreDefiner = false;
    await Promise.all([loadTables(), loadTargetConfigs()]);
    await loadTargetInstances();
  },
);

watch(
  () => form.targetDbConfigId,
  () => {
    loadTargetInstances();
  },
);

function toggleAllTables(check: boolean) {
  checkedTables.value = check ? [...tableNames.value] : [];
}

async function onCopy() {
  if (!props.sourceConnection?.id) {
    ElMessage.warning('无有效源连接');
    return;
  }
  if (!form.targetDbConfigId) {
    ElMessage.warning('请选择目标连接');
    return;
  }
  if (!form.targetInstance) {
    ElMessage.warning('请选择目标数据库');
    return;
  }
  if (!checkedTables.value.length) {
    ElMessage.warning('请至少选择一张表');
    return;
  }
  submitting.value = true;
  try {
    const res: any = await startDbCopy({
      sourceDbConfigId: props.sourceConnection.id,
      sourceInstance: props.sourceInstance,
      targetDbConfigId: form.targetDbConfigId,
      targetInstance: form.targetInstance,
      tableNames: checkedTables.value,
      mode: form.mode,
      dropIfExists: form.dropIfExists,
      bulkInsert: form.bulkInsert,
      ignoreDefiner: form.ignoreDefiner,
      maxRows: visualClientConfig.exportMaxRows,
      batchSize: 200,
      continueOnError: true,
    });
    const task = (res?.data || res) as DbCopyTaskVO;
    if (!task?.taskId) {
      ElMessage.error(res?.msg || '启动复制失败');
      return;
    }
    ElMessage.success('复制任务已启动');
    visible.value = false;
    emit('started', task);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '启动复制失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    title="复制数据库"
    width="920px"
    destroy-on-close
    append-to-body
    class="copy-db-dialog"
  >
    <p class="desc">此选项复制数据库/主机之间的对象。</p>

    <div class="copy-body">
      <!-- 左侧：来源 -->
      <div class="pane source-pane">
        <div class="pane-head">来源</div>
        <div class="source-name">
          <span class="label">名</span>
          <ElInput :model-value="sourceLabel" disabled />
        </div>
        <div class="pane-title">
          <span>对象</span>
          <span class="pane-actions">
            <ElButton link type="primary" size="small" @click="toggleAllTables(true)">
              全选表
            </ElButton>
            <ElButton link size="small" @click="toggleAllTables(false)">清空</ElButton>
          </span>
        </div>
        <ElScrollbar v-loading="loadingTables" height="360px">
          <div class="obj-tree">
            <div class="folder-row" @click="tablesExpanded = !tablesExpanded">
              <span class="exp">{{ tablesExpanded ? '−' : '+' }}</span>
              <ElCheckbox
                :model-value="
                  checkedTables.length > 0 &&
                  checkedTables.length === tableNames.length
                "
                :indeterminate="
                  checkedTables.length > 0 &&
                  checkedTables.length < tableNames.length
                "
                @click.stop
                @change="(v: boolean) => toggleAllTables(!!v)"
              >
                表
              </ElCheckbox>
            </div>
            <ElCheckboxGroup v-if="tablesExpanded" v-model="checkedTables" class="table-checks">
              <ElCheckbox v-for="name in tableNames" :key="name" :label="name">
                {{ name }}
              </ElCheckbox>
            </ElCheckboxGroup>

            <div class="folder-row disabled" title="第一期暂不支持">
              <span class="exp">+</span>
              <ElCheckbox disabled>视图</ElCheckbox>
            </div>
            <div class="folder-row disabled" title="第一期暂不支持">
              <span class="exp">+</span>
              <ElCheckbox disabled>存储过程</ElCheckbox>
            </div>
            <div class="folder-row disabled" title="第一期暂不支持">
              <span class="exp">+</span>
              <ElCheckbox disabled>函数</ElCheckbox>
            </div>
            <div class="folder-row disabled" title="第一期暂不支持">
              <span class="exp">+</span>
              <ElCheckbox disabled>触发器</ElCheckbox>
            </div>
            <div class="folder-row disabled" title="第一期暂不支持">
              <span class="exp">+</span>
              <ElCheckbox disabled>事件</ElCheckbox>
            </div>
          </div>
        </ElScrollbar>
      </div>

      <!-- 右侧：目标 + 选项 -->
      <div class="pane target-pane">
        <div class="pane-head">目标</div>
        <p class="note">
          注意：若要复制到不同主机，请先在「打开连接」中配置并打开目标连接；目标连接下拉会列出已保存的连接。
        </p>
        <div class="field-row" v-loading="loadingTargets">
          <span class="label">连接</span>
          <ElSelect
            v-model="form.targetDbConfigId"
            filterable
            style="flex: 1"
            placeholder="选择目标连接"
          >
            <ElOption
              v-for="c in targetConfigs"
              :key="c.id"
              :label="c.label"
              :value="c.id"
            />
          </ElSelect>
        </div>
        <div class="field-row" v-loading="loadingInstances">
          <span class="label">数据库</span>
          <ElSelect
            v-model="form.targetInstance"
            filterable
            style="flex: 1"
            placeholder="选择目标库"
          >
            <ElOption
              v-for="name in targetInstances"
              :key="name"
              :label="name"
              :value="name"
            />
          </ElSelect>
        </div>

        <ElDivider />

        <ElRadioGroup v-model="form.mode" class="mode-radios">
          <ElRadio label="both">结构和数据</ElRadio>
          <ElRadio label="structure">结构唯一</ElRadio>
        </ElRadioGroup>

        <div class="opts">
          <ElCheckbox v-model="form.dropIfExists">如果目标中存在则删除</ElCheckbox>
          <ElCheckbox v-model="form.bulkInsert">使用大容量插入</ElCheckbox>
          <ElCheckbox v-if="showIgnoreDefiner" v-model="form.ignoreDefiner">
            忽略 DEFINER
          </ElCheckbox>
        </div>

        <div class="hint">
          单表数据上限 {{ visualClientConfig.exportMaxRows }} 行；异库类型将按统一类型标准映射建表。
        </div>
      </div>
    </div>

    <template #footer>
      <ElButton :loading="submitting" type="primary" @click="onCopy">复制</ElButton>
      <ElButton @click="visible = false">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.copy-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-height: 420px;
}
.pane {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--el-bg-color);
}
.pane-head {
  font-weight: 600;
  margin-bottom: 8px;
}
.source-name,
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.pane-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-weight: 600;
}
.obj-tree {
  font-size: 13px;
}
.folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  cursor: pointer;
}
.folder-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.exp {
  width: 14px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-family: monospace;
}
.table-checks {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 28px;
  margin-bottom: 6px;
}
.note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin: 0 0 10px;
}
.mode-radios {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 12px;
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
