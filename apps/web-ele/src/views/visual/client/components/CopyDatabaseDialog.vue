<script lang="ts" setup>
import type { DbConnection } from '../composables/useConnectionStore';

/**
 * 将数据库/表复制到不同主机（参考 SQLyog）
 * - 左侧：来源对象勾选（第一期仅表可勾选，其它类型置灰）
 * - 右侧：目标连接 / 实例 / 名称空间(schema|owner)、结构/数据选项
 * - PG/Oracle 族目标必须选到名称空间；达梦一级已是模式，不再套一层
 *
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import { getInstances, getTables, getTableTree } from '#/api/visual/database';
import { type DbCopyTaskVO, startDbCopy } from '#/api/visual/dbCopy';
import { getDbConfigList } from '#/api/visual/vq';

import { visualClientConfig } from '../config';
import {
  resolveDbType,
  resolveDialectFamily,
  type SqlDialectFamily,
} from '../dialect/dbTypes';
import { resolveSqlDialect } from '../dialect/sqlDialect';

defineOptions({ name: 'CopyDatabaseDialog' });

const props = defineProps<{
  modelValue: boolean;
  /** 已打开的连接（优先作为目标候选） */
  openConnections?: DbConnection[];
  /** 右键单表时预勾选（建议传 qualifiedName） */
  preselectedTables?: string[];
  /** 右键带来的源 schema，用于默认过滤 */
  sourceSchema?: string;
  sourceConnection: DbConnection | null;
  sourceInstance: string;
}>();

const emit = defineEmits<{
  started: (task: DbCopyTaskVO) => void;
  'update:modelValue': (arg0: boolean) => void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const sourceLabel = computed(() => {
  const c = props.sourceConnection;
  if (!c) return '-';
  const host = c.dbHost || c.dbName || String(c.id);
  const schema = form.sourceSchema ? `.${form.sourceSchema}` : '';
  return `${host} - ${props.sourceInstance || ''}${schema}`;
});

const sourceDialect = computed(() =>
  resolveSqlDialect(props.sourceConnection?.dbType),
);

const showIgnoreDefiner = computed(
  () => sourceDialect.value.family === 'MYSQL_LIKE',
);

/** PG / 真 Oracle：实例之下还有 schema/owner；达梦 instanceKind=SCHEMA 则否 */
function needsNamespace(dbType?: string) {
  const d = resolveDbType(dbType);
  if (d.family === 'POSTGRES_LIKE' || d.family === 'SQLSERVER_LIKE') return true;
  if (d.family === 'ORACLE_LIKE' && d.instanceKind === 'DATABASE') return true;
  return false;
}

const sourceNeedsNamespace = computed(() =>
  needsNamespace(props.sourceConnection?.dbType),
);

const targetDbType = computed(() => {
  const id = form.targetDbConfigId;
  const hit = targetConfigs.value.find((c) => String(c.id) === String(id));
  return hit?.dbType;
});

const targetNeedsNamespace = computed(() => needsNamespace(targetDbType.value));

const targetInstanceLabel = computed(() => {
  const d = resolveDbType(targetDbType.value);
  if (d.family === 'ORACLE_LIKE' && d.instanceKind === 'DATABASE') return '服务';
  if (d.instanceKind === 'SCHEMA') return '模式';
  return '数据库';
});

const targetSchemaLabel = computed(() => {
  const family = resolveDialectFamily(targetDbType.value) as SqlDialectFamily;
  return family === 'ORACLE_LIKE' ? 'Owner' : 'Schema';
});

const loadingTables = ref(false);
const loadingTargets = ref(false);
const loadingInstances = ref(false);
const loadingSchemas = ref(false);
const submitting = ref(false);

const tableNames = ref<string[]>([]);
const checkedTables = ref<string[]>([]);
const tablesExpanded = ref(true);
const sourceSchemaOptions = ref<string[]>([]);

const targetConfigs = ref<
  { dbType?: string; id: number | string; label: string }[]
>([]);
const targetInstances = ref<string[]>([]);
const targetSchemas = ref<string[]>([]);
/** 目标连接快速切换时，只允许最后一次实例请求更新下拉框。 */
let targetInstanceRequestId = 0;
let targetSchemaRequestId = 0;
/** 源过滤快速切换时，旧结果不能覆盖新选择。 */
let sourceTableRequestId = 0;

const form = reactive({
  targetDbConfigId: null as null | number | string,
  targetInstance: '',
  targetSchema: '',
  sourceSchema: '' as string,
  mode: 'both' as 'both' | 'structure' | 'data',
  existingTableAction: 'fail' as 'fail' | 'replace' | 'skip',
  verifyRowCount: true,
  consistentSnapshot: true,
  continueOnError: false,
  batchSize: 200,
  batchMemoryMiB: 8,
  queryTimeoutSeconds: 300,
  bulkInsert: true,
  ignoreDefiner: false,
  /** 默认全表；勾选后才按 maxRows 截断 */
  limitRows: false,
  maxRows: visualClientConfig.exportMaxRows,
});

function tableDisplayName(qualified: string) {
  return qualified;
}

async function loadTables() {
  const requestId = ++sourceTableRequestId;
  const selectedSchema = form.sourceSchema;
  if (!props.sourceConnection?.id || !props.sourceInstance) {
    tableNames.value = [];
    checkedTables.value = [];
    sourceSchemaOptions.value = [];
    return;
  }
  loadingTables.value = true;
  try {
    let list: string[] = [];
    if (sourceNeedsNamespace.value) {
      const res: any = await getTableTree(
        props.sourceConnection.id,
        props.sourceInstance,
      );
      if (requestId !== sourceTableRequestId) return;
      const schemas = res?.data || res || [];
      const schemaNames: string[] = [];
      const all: string[] = [];
      for (const s of schemas) {
        const sn = s?.schemaName || s?.displayName;
        if (sn) schemaNames.push(String(sn));
        for (const t of s?.tables || []) {
          const q =
            t.qualifiedName ||
            t.tableName ||
            (sn && (t.rawTableName || t.tableName)
              ? `${sn}.${t.rawTableName || t.tableName}`
              : '');
          if (q) all.push(String(q));
        }
      }
      sourceSchemaOptions.value = [...new Set(schemaNames)].sort();
      const filterSchema = (selectedSchema || '').trim();
      list = filterSchema
        ? all.filter(
            (n) =>
              n === filterSchema ||
              n.startsWith(`${filterSchema}.`),
          )
        : all;
    } else {
      const res: any = await getTables(
        props.sourceConnection.id,
        props.sourceInstance,
      );
      if (requestId !== sourceTableRequestId) return;
      list = (res?.data || res || [])
        .map((t: any) => t.qualifiedName || t.tableName)
        .filter(Boolean);
      sourceSchemaOptions.value = [];
    }
    tableNames.value = list;
    const pre = (props.preselectedTables || []).filter((t) => list.includes(t));
    // 裸表名只有唯一匹配才可预选，避免同名表跨 schema 被同时误选。
    let resolvedPre = pre;
    if (!resolvedPre.length && props.preselectedTables?.length) {
      resolvedPre = props.preselectedTables.flatMap((name) => {
        const matches = list.filter((item) => item === name || item.endsWith(`.${name}`));
        return matches.length === 1 ? matches : [];
      });
    }
    checkedTables.value = props.preselectedTables?.length ? resolvedPre : [...list];
  } catch {
    if (requestId !== sourceTableRequestId) return;
    tableNames.value = [];
    checkedTables.value = [];
    sourceSchemaOptions.value = [];
  } finally {
    if (requestId === sourceTableRequestId) loadingTables.value = false;
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
    const map = new Map<
      string,
      { dbType?: string; id: number | string; label: string }
    >();
    [...fromOpen, ...fromAll].forEach((item) => {
      map.set(String(item.id), item);
    });
    const sourceFamily = sourceDialect.value.family;
    targetConfigs.value = [...map.values()].filter((item) => {
      const family = resolveDialectFamily(item.dbType);
      const supported = ['MYSQL_LIKE', 'POSTGRES_LIKE', 'ORACLE_LIKE', 'SQLSERVER_LIKE', 'H2_LIKE', 'SQLITE_LIKE', 'MONGODB_LIKE'].includes(family);
      return supported && (sourceFamily === 'MONGODB_LIKE' ? family === 'MONGODB_LIKE' : family !== 'MONGODB_LIKE');
    });
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
  const requestId = ++targetInstanceRequestId;
  if (!form.targetDbConfigId) {
    targetInstances.value = [];
    form.targetInstance = '';
    targetSchemas.value = [];
    form.targetSchema = '';
    return;
  }
  const targetDbConfigId = form.targetDbConfigId;
  loadingInstances.value = true;
  try {
    const res: any = await getInstances(targetDbConfigId);
    if (
      requestId !== targetInstanceRequestId ||
      String(targetDbConfigId) !== String(form.targetDbConfigId)
    ) {
      return;
    }
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    targetInstances.value = (instances || [])
      .map((i: any) => i.instanceName || i.name)
      .filter(Boolean);
    if (
      form.targetInstance &&
      !targetInstances.value.includes(form.targetInstance)
    ) {
      form.targetInstance = '';
    }
  } catch {
    if (requestId !== targetInstanceRequestId) return;
    targetInstances.value = [];
    form.targetInstance = '';
  } finally {
    if (requestId === targetInstanceRequestId) {
      loadingInstances.value = false;
    }
  }
  await loadTargetSchemas();
}

async function loadTargetSchemas() {
  const requestId = ++targetSchemaRequestId;
  form.targetSchema = '';
  targetSchemas.value = [];
  if (!targetNeedsNamespace.value || !form.targetDbConfigId || !form.targetInstance) {
    return;
  }
  loadingSchemas.value = true;
  try {
    const res: any = await getTableTree(form.targetDbConfigId, form.targetInstance);
    if (requestId !== targetSchemaRequestId) return;
    const schemas = res?.data || res || [];
    const names: string[] = (schemas || [])
      .map((s: any) => s.schemaName || s.displayName)
      .filter(Boolean)
      .map(String);
    // 即使库是空的也提供常用默认
    const family = resolveDialectFamily(targetDbType.value);
    if (family === 'POSTGRES_LIKE' && !names.includes('public')) {
      names.unshift('public');
    }
    targetSchemas.value = [...new Set(names)];
    if (targetSchemas.value.includes('public')) {
      form.targetSchema = 'public';
    }
  } catch {
    if (requestId !== targetSchemaRequestId) return;
    const family = resolveDialectFamily(targetDbType.value);
    targetSchemas.value = family === 'POSTGRES_LIKE' ? ['public'] : [];
    form.targetSchema = targetSchemas.value[0] || '';
  } finally {
    if (requestId === targetSchemaRequestId) {
      loadingSchemas.value = false;
    }
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return;
    form.mode = 'both';
    form.existingTableAction = 'fail';
    form.verifyRowCount = true;
    form.consistentSnapshot = true;
    form.continueOnError = false;
    form.batchSize = 200;
    form.batchMemoryMiB = 8;
    form.queryTimeoutSeconds = 300;
    form.bulkInsert = true;
    form.ignoreDefiner = false;
    form.limitRows = false;
    form.maxRows = visualClientConfig.exportMaxRows;
    form.targetInstance = '';
    form.targetSchema = '';
    form.sourceSchema = props.sourceSchema || '';
    await Promise.all([loadTargetConfigs()]);
    await loadTables();
    await loadTargetInstances();
  },
);

watch(
  () => form.targetDbConfigId,
  () => {
    form.targetInstance = '';
    form.targetSchema = '';
    targetInstances.value = [];
    targetSchemas.value = [];
    loadTargetInstances();
  },
);

watch(
  () => form.targetInstance,
  () => {
    loadTargetSchemas();
  },
);

watch(
  () => form.sourceSchema,
  () => {
    if (props.modelValue) loadTables();
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
    ElMessage.warning(`请选择目标${targetInstanceLabel.value}`);
    return;
  }
  if (targetNeedsNamespace.value && !form.targetSchema) {
    ElMessage.warning(`请选择目标${targetSchemaLabel.value}`);
    return;
  }
  if (
    String(props.sourceConnection?.id) === String(form.targetDbConfigId) &&
    props.sourceInstance === form.targetInstance &&
    (!targetNeedsNamespace.value ||
      !form.sourceSchema ||
      form.sourceSchema === form.targetSchema)
  ) {
    // 同源同库且同 schema（或无需 schema）禁止
    if (
      !targetNeedsNamespace.value ||
      (form.sourceSchema || '') === (form.targetSchema || '')
    ) {
      ElMessage.warning('目标不能与源完全相同');
      return;
    }
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
      sourceSchema: form.sourceSchema || undefined,
      targetDbConfigId: form.targetDbConfigId,
      targetInstance: form.targetInstance,
      targetSchema: targetNeedsNamespace.value
        ? form.targetSchema || undefined
        : undefined,
      tableNames: checkedTables.value,
      mode: form.mode,
      existingTableAction: form.existingTableAction,
      verifyRowCount: form.verifyRowCount,
      consistentSnapshot: form.consistentSnapshot,
      queryTimeoutSeconds: form.queryTimeoutSeconds,
      batchMemoryMiB: form.batchMemoryMiB,
      bulkInsert: form.bulkInsert,
      ignoreDefiner: form.ignoreDefiner,
      maxRows: form.limitRows ? form.maxRows : 0,
      batchSize: form.batchSize,
      continueOnError: form.continueOnError,
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
    :title="$tr('复制数据库')"
    width="min(960px, 96vw)"
    destroy-on-close
    append-to-body
    class="copy-db-dialog"
  >
    <p class="desc">{{ $tr('此选项复制数据库/主机之间的对象。') }}</p>

    <div class="copy-body">
      <!-- 左侧：来源 -->
      <div class="pane source-pane">
        <div class="pane-head">{{ $tr('来源') }}</div>
        <div class="source-name">
          <span class="label">{{ $tr('名') }}</span>
          <ElInput :model-value="sourceLabel" disabled />
        </div>
        <div v-if="sourceNeedsNamespace" class="field-row">
          <span class="label">{{ $tr('Schema') }}</span>
          <ElSelect
            v-model="form.sourceSchema"
            clearable
            filterable
            style="flex: 1"
            :placeholder="$tr('全部名称空间')"
          >
            <ElOption
              v-for="name in sourceSchemaOptions"
              :key="name"
              :label="name"
              :value="name"
            />
          </ElSelect>
        </div>
        <div class="pane-title">
          <span>{{ $tr('对象') }}</span>
          <span class="pane-actions">
            <ElButton link type="primary" size="small" @click="toggleAllTables(true)">
              {{ $tr('全选表') }}
            </ElButton>
            <ElButton link size="small" @click="toggleAllTables(false)">{{ $tr('清空') }}</ElButton>
          </span>
        </div>
        <ElScrollbar v-loading="loadingTables" class="obj-scroll">
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
                {{ $tr('表') }}
              </ElCheckbox>
            </div>
            <ElCheckboxGroup v-if="tablesExpanded" v-model="checkedTables" class="table-checks">
              <ElCheckbox v-for="name in tableNames" :key="name" :value="name">
                {{ tableDisplayName(name) }}
              </ElCheckbox>
            </ElCheckboxGroup>

            <div class="folder-row disabled" :title="$tr('第一期暂不支持')">
              <span class="exp">+</span>
              <ElCheckbox disabled>{{ $tr('视图') }}</ElCheckbox>
            </div>
            <div class="folder-row disabled" :title="$tr('第一期暂不支持')">
              <span class="exp">+</span>
              <ElCheckbox disabled>{{ $tr('存储过程') }}</ElCheckbox>
            </div>
            <div class="folder-row disabled" :title="$tr('第一期暂不支持')">
              <span class="exp">+</span>
              <ElCheckbox disabled>{{ $tr('函数') }}</ElCheckbox>
            </div>
            <div class="folder-row disabled" :title="$tr('第一期暂不支持')">
              <span class="exp">+</span>
              <ElCheckbox disabled>{{ $tr('触发器') }}</ElCheckbox>
            </div>
            <div class="folder-row disabled" :title="$tr('第一期暂不支持')">
              <span class="exp">+</span>
              <ElCheckbox disabled>{{ $tr('事件') }}</ElCheckbox>
            </div>
          </div>
        </ElScrollbar>
      </div>

      <!-- 右侧：目标 + 选项（固定高度内滚动） -->
      <div class="pane target-pane">
        <ElScrollbar class="target-scroll">
          <div class="pane-head">{{ $tr('目标') }}</div>
          <p class="note">
            {{ $tr('注意：若要复制到不同主机，请先在「打开连接」中配置并打开目标连接；目标连接下拉会列出已保存的连接。PG/Oracle 还需选择名称空间（Schema/Owner）。') }}
          </p>
          <div class="field-row" v-loading="loadingTargets">
            <span class="label">{{ $tr('连接') }}</span>
            <ElSelect
              v-model="form.targetDbConfigId"
              filterable
              style="flex: 1"
              :placeholder="$tr('选择目标连接')"
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
            <span class="label">{{ targetInstanceLabel }}</span>
            <ElSelect
              v-model="form.targetInstance"
              filterable
              style="flex: 1"
              :placeholder="$tr('选择目标') + targetInstanceLabel"
            >
              <ElOption
                v-for="name in targetInstances"
                :key="name"
                :label="name"
                :value="name"
              />
            </ElSelect>
          </div>
          <div
            v-if="targetNeedsNamespace"
            class="field-row"
            v-loading="loadingSchemas"
          >
            <span class="label">{{ targetSchemaLabel }}</span>
            <ElSelect
              v-model="form.targetSchema"
              filterable
              allow-create
              default-first-option
              style="flex: 1"
              :placeholder="$tr('选择或输入目标名称空间')"
            >
              <ElOption
                v-for="name in targetSchemas"
                :key="name"
                :label="name"
                :value="name"
              />
            </ElSelect>
          </div>

          <ElDivider />

          <ElRadioGroup v-model="form.mode" class="mode-radios">
            <ElRadio value="both">{{ $tr('结构和数据') }}</ElRadio>
            <ElRadio value="structure">{{ $tr('仅结构') }}</ElRadio>
            <ElRadio v-if="props.sourceConnection?.dbType !== 'MONGODB'" value="data">{{ $tr('仅追加数据') }}</ElRadio>
          </ElRadioGroup>

          <div class="opts">
            <div v-if="form.mode !== 'data'" class="field-row">
              <span class="label">{{ $tr('目标已存在') }}</span>
              <ElSelect v-model="form.existingTableAction" style="flex: 1">
                <ElOption value="fail" :label="$tr('报错停止（默认）')" />
                <ElOption value="skip" :label="$tr('跳过并保留目标表')" />
                <ElOption value="replace" :label="$tr('删除并重新复制')" />
              </ElSelect>
            </div>
            <ElAlert v-if="form.mode !== 'data' && form.existingTableAction === 'replace'" type="warning" :closable="false"
              :title="$tr('替换会删除目标表及数据。MySQL、Oracle 等数据库的 DDL 不能通过事务恢复，请先备份目标。')" />
            <ElAlert v-if="form.mode === 'data'" type="info" :closable="false"
              :title="$tr('向已有目标表追加数据，保留原结构和约束。主键重复或类型不兼容时，本表写入失败并回滚；重试前请检查已完成的表。')" />
            <ElCheckbox v-model="form.bulkInsert">{{ $tr('使用大容量插入（多值 INSERT）') }}</ElCheckbox>
            <ElCheckbox v-if="showIgnoreDefiner" v-model="form.ignoreDefiner">
              {{ $tr('忽略 DEFINER') }}
            </ElCheckbox>
            <ElCheckbox v-if="form.mode !== 'structure'" v-model="form.verifyRowCount">{{ $tr('提交前校验目标新增行数') }}</ElCheckbox>
            <ElCheckbox v-model="form.continueOnError">{{ $tr('单表失败后继续其他表') }}</ElCheckbox>
            <ElCheckbox v-if="['MYSQL_LIKE', 'POSTGRES_LIKE'].includes(sourceDialect.family)" v-model="form.consistentSnapshot">{{ $tr('源数据使用一致性快照') }}</ElCheckbox>
            <ElCheckbox v-model="form.limitRows">{{ $tr('限制每表导出行数') }}</ElCheckbox>
            <div v-if="form.limitRows" class="max-rows">
              <span class="label">{{ $tr('上限') }}</span>
              <ElInputNumber v-model="form.maxRows" :min="1" :max="10000000" :step="10000" />
            </div>
          </div>

          <ElCollapse>
            <ElCollapseItem name="performance" :title="$tr('性能与超时设置')">
              <div class="field-row"><span class="label">{{ $tr('每批行数') }}</span><ElInputNumber v-model="form.batchSize" :min="1" :max="1000" /></div>
              <div class="field-row"><span class="label">{{ $tr('批次内存 MiB') }}</span><ElInputNumber v-model="form.batchMemoryMiB" :min="1" :max="64" /></div>
              <div class="field-row"><span class="label">{{ $tr('语句超时（秒）') }}</span><ElInputNumber v-model="form.queryTimeoutSeconds" :min="1" :max="86400" /></div>
            </ElCollapseItem>
          </ElCollapse>
          <div class="hint">
            {{ $tr('默认复制全表数据，按表提交。限制行数时会标记数据截断。同产品优先保留原生结构；异产品使用类型映射并报告需核对的差异。取消或失败保留此前已完成的表。行数校验会扫描目标表，大表可按需要关闭。') }}
          </div>
        </ElScrollbar>
      </div>
    </div>

    <template #footer>
      <ElButton :disabled="loadingTables || loadingInstances || loadingSchemas || !checkedTables.length" :loading="submitting" type="primary" @click="onCopy">{{ $tr('复制') }}</ElButton>
      <ElButton @click="visible = false">{{ $tr('关闭') }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.desc {
  margin: 0 0 12px;
  font-size: var(--vc-ui-font-size, 13px);
  color: var(--el-text-color-secondary);
}
.copy-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  /* 弹窗主体固定高度，左右栏对齐，不再随内容伸缩 */
  height: 480px;
}
.pane {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--el-bg-color);
  min-height: 0;
  overflow: hidden;
}
.source-pane,
.target-pane {
  display: flex;
  flex-direction: column;
}
.obj-scroll,
.target-scroll {
  flex: 1;
  /* flex 子项用 height:0 吃满固定父高度并内部滚动 */
  height: 0;
  min-height: 0;
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
  width: 64px;
  flex-shrink: 0;
  font-size: var(--vc-ui-font-size, 13px);
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
  font-size: var(--vc-ui-font-size, 13px);
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
  font-size: var(--vc-ui-font-size-sm, 12px);
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
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.max-rows {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 22px;
}
@media (max-width: 720px) {
  .copy-body { grid-template-columns: 1fr; height: auto; max-height: 70vh; overflow-y: auto; }
  .pane { min-height: 260px; }
}
</style>
