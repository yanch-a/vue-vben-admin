<script lang="ts" setup>
/**
 * SQL 转储导出对话框（参考 SQLyog）
 * - 可选：仅结构 / 仅数据 / 结构+数据
 * - 勾选表、写入选项；确认后由后台生成 .sql 并下载
 *
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { exportSqlDump, getTables } from '#/api/visual/database';
import { visualClientConfig } from '../config';
import { resolveSqlDialect } from '../dialect/sqlDialect';

import { ElMessage } from 'element-plus';

defineOptions({ name: 'SqlDumpDialog' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string | null;
  dbName?: string;
  /** 连接库类型：用于选项文案按方言显示 */
  dbType?: string;
  instanceName: string;
  /** 右键单表时预勾选 */
  preselectedTables?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const dialect = computed(() => resolveSqlDialect(props.dbType));

const loadingTables = ref(false);
const exporting = ref(false);
const tableNames = ref<string[]>([]);
const checkedTables = ref<string[]>([]);
const fileName = ref('dump.sql');

const form = reactive({
  mode: 'both' as 'structure' | 'data' | 'both',
  includeUseDatabase: true,
  includeCreateDatabase: false,
  foreignKeyChecks0: true,
  createBulkInsert: true,
  oneRowPerLine: true,
  includeDrop: true,
  includeVersionInfo: true,
  convertBlobToHex: false,
});

const dumpExtension = computed(() => {
  if (props.dbType === 'MONGODB') return '.archive';
  if (
    props.dbType === 'SQL_SERVER' &&
    form.mode === 'data' &&
    checkedTables.value.length === 1
  ) {
    return '.csv';
  }
  return '.sql';
});

async function loadTables() {
  if (!props.dbConfigId || !props.instanceName) {
    tableNames.value = [];
    return;
  }
  loadingTables.value = true;
  try {
    const res: any = await getTables(props.dbConfigId, props.instanceName);
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

function syncFileName() {
  const inst = props.instanceName || 'dump';
  const tables = checkedTables.value;
  if (tables.length === 1) {
    fileName.value = `${inst}_${tables[0]}${dumpExtension.value}`;
  } else {
    fileName.value = `${inst}_dump${dumpExtension.value}`;
  }
}

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return;
    form.mode = 'both';
    await loadTables();
    syncFileName();
  },
);

watch(
  [checkedTables, () => form.mode, () => props.dbType],
  () => syncFileName(),
  { deep: true },
);

function toggleAll(check: boolean) {
  checkedTables.value = check ? [...tableNames.value] : [];
}

async function resolveDownloadExtension(fileBlob: Blob, response: any) {
  const engine = String(
    response?.headers?.['x-lemon-transfer-engine'] || '',
  ).toLowerCase();
  if (engine === 'jdbc') {
    if (props.dbType === 'MONGODB') return '.js';
    if (props.dbType === 'SQL_SERVER') return '.sql';
  }
  if (engine === 'native') {
    if (props.dbType === 'MONGODB') return '.archive';
    if (props.dbType === 'SQL_SERVER') return '.csv';
  }
  if (props.dbType !== 'MONGODB') return dumpExtension.value;
  // MongoDB 没有官方工具时后端会回退为 mongosh JS；用文件头避免把 JS 误命名为 archive。
  const head = await fileBlob.slice(0, 128).text();
  return /^\s*\/\//.test(head) ? '.js' : '.archive';
}

function withExtension(name: string, extension: string) {
  const clean = name.replace(/[\\/:*?"<>|]/g, '_');
  return clean.replace(/\.[a-z0-9]+$/i, '') + extension;
}

async function onExport() {
  if (!props.dbConfigId) {
    ElMessage.warning('无有效连接');
    return;
  }
  if (!checkedTables.value.length) {
    ElMessage.warning('请至少选择一张表');
    return;
  }
  exporting.value = true;
  try {
    const res: any = await exportSqlDump({
      dbConfigId: props.dbConfigId,
      instanceName: props.instanceName,
      tableNames: checkedTables.value,
      mode: form.mode,
      includeUseDatabase: form.includeUseDatabase,
      includeCreateDatabase: form.includeCreateDatabase,
      foreignKeyChecks0: form.foreignKeyChecks0,
      createBulkInsert: form.createBulkInsert,
      oneRowPerLine: form.oneRowPerLine,
      includeDrop: form.includeDrop,
      includeVersionInfo: form.includeVersionInfo,
      convertBlobToHex: form.convertBlobToHex,
      maxRows: visualClientConfig.exportMaxRows,
    });
    // 兼容直出 Blob 与历史 { data: Blob } 包装，避免伪 .sql 文件
    // @author yanch
    const fileBlob =
      res instanceof Blob
        ? res
        : res?.data instanceof Blob
          ? res.data
          : null;
    if (!fileBlob) {
      ElMessage.error('导出失败：未收到有效文件');
      return;
    }
    if (fileBlob.type && fileBlob.type.includes('application/json')) {
      const text = await fileBlob.text();
      let msg = '导出失败';
      try {
        msg = JSON.parse(text)?.msg || msg;
      } catch {
        /* ignore */
      }
      ElMessage.error(msg);
      return;
    }
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = url;
    const extension = await resolveDownloadExtension(fileBlob, res);
    link.download = withExtension(
      fileName.value || `dump${extension}`,
      extension,
    );
    link.click();
    window.URL.revokeObjectURL(url);
    ElMessage.success('数据导出成功');
    visible.value = false;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('SQL转储')"
    width="860px"
    destroy-on-close
    append-to-body
    class="sql-dump-dialog"
  >
    <div class="dump-toolbar">
      <div class="mode-row">
        <span class="label">{{ $tr('SQL导出') }}</span>
        <ElRadioGroup v-model="form.mode" size="small">
          <ElRadioButton label="structure">{{ $tr('结构唯一') }}</ElRadioButton>
          <ElRadioButton label="data">{{ $tr('仅有数据') }}</ElRadioButton>
          <ElRadioButton label="both">{{ $tr('结构和数据') }}</ElRadioButton>
        </ElRadioGroup>
      </div>
      <div class="meta-row">
        <span class="label">{{ $tr('数据库名称') }}</span>
        <ElInput :model-value="instanceName" disabled style="width: 220px" />
        <span class="label">{{ $tr('导出文件名') }}</span>
        <ElInput v-model="fileName" style="flex: 1" placeholder="xxx.sql" />
      </div>
    </div>

    <div class="dump-body">
      <div v-loading="loadingTables" class="obj-pane">
        <div class="pane-title">
          <span>{{ $tr('对象') }}</span>
          <span class="pane-actions">
            <ElButton link type="primary" size="small" @click="toggleAll(true)">{{ $tr('全选') }}</ElButton>
            <ElButton link size="small" @click="toggleAll(false)">{{ $tr('清空') }}</ElButton>
          </span>
        </div>
        <ElScrollbar height="360px">
          <ElCheckboxGroup v-model="checkedTables" class="table-checks">
            <div class="folder">{{ $tr('表') }}</div>
            <ElCheckbox
              v-for="name in tableNames"
              :key="name"
              :label="name"
            >
              {{ name }}
            </ElCheckbox>
          </ElCheckboxGroup>
        </ElScrollbar>
      </div>

      <div class="opt-pane">
        <div class="opt-group">
          <div class="opt-title">{{ $tr('把选项写进文件') }}</div>
          <ElCheckbox v-model="form.includeUseDatabase">{{
            dialect.dumpUseOptionLabel
          }}</ElCheckbox>
          <ElCheckbox v-model="form.includeCreateDatabase">{{ $tr('包含创建库/Schema 语句') }}</ElCheckbox>
          <ElCheckbox v-model="form.foreignKeyChecks0">{{
            dialect.dumpFkOptionLabel
          }}</ElCheckbox>
          <ElCheckbox v-model="form.createBulkInsert">{{ $tr('创建批量插入语句') }}</ElCheckbox>
          <ElCheckbox
            v-model="form.oneRowPerLine"
            :disabled="!form.createBulkInsert"
            class="indent"
          >
            {{ $tr('每行一条记录') }}
          </ElCheckbox>
          <ElCheckbox v-model="form.includeDrop">{{ $tr('包含 "DROP" 语句') }}</ElCheckbox>
          <ElCheckbox v-model="form.includeVersionInfo">{{ $tr('在备份文件中包含版本信息') }}</ElCheckbox>
          <ElCheckbox v-model="form.convertBlobToHex">{{ $tr('将 BLOB 转为 HEX') }}</ElCheckbox>
        </div>
        <div class="hint">
          {{ $tr('导出由服务端重新读取表结构与数据生成，不使用前端缓存数据。 单表数据上限') }} {{ visualClientConfig.exportMaxRows }} {{ $tr('行。') }}
        </div>
      </div>
    </div>

    <template #footer>
      <ElButton :loading="exporting" type="primary" @click="onExport">{{ $tr('导出') }}</ElButton>
      <ElButton @click="visible = false">{{ $tr('关闭') }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.dump-toolbar {
  margin-bottom: 12px;
}
.mode-row,
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}
.label {
  font-size: var(--vc-ui-font-size, 13px);
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.dump-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  min-height: 380px;
}
.obj-pane,
.opt-pane {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--el-bg-color);
}
.pane-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-weight: 600;
}
.table-checks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.folder {
  margin: 4px 0;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
.opt-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.opt-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.indent {
  margin-left: 22px;
}
.hint {
  margin-top: 16px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
