<script lang="ts" setup>
/**
 * SQL 转储导出对话框（参考 SQLyog）
 * - 可选：仅结构 / 仅数据 / 结构+数据
 * - 勾选表、写入选项；确认后由后台生成 .sql 并下载
 *
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { startDbBackup, type DbBackupTaskVO } from '#/api/visual/dbBackup';
import { exportSqlDump, getTables } from '#/api/visual/database';
import {
  downloadBlobAsFile,
  readBlobErrorMessage,
  unwrapFileBlob,
} from '#/utils/blobDownload';
import { resolveSqlDialect } from '../dialect/sqlDialect';

import { ElMessage } from 'element-plus';

defineOptions({ name: 'SqlDumpDialog' });

const props = defineProps<{
  modelValue: boolean;
  /** 库级导出使用后台任务，保留进度、取消与大文件压缩。 */
  background?: boolean;
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
  started: [DbBackupTaskVO];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const dialect = computed(() => resolveSqlDialect(props.dbType));

const loadingTables = ref(false);
const exporting = ref(false);
/** key 用限定名（schema.table），和对象树右键带过来的名字一致，避免导出到同名空表 */
const tableOptions = ref<{ key: string; label: string }[]>([]);
const checkedTables = ref<string[]>([]);
const fileName = ref('dump.sql');

const form = reactive({
  mode: 'both' as 'structure' | 'data' | 'both',
  engine: 'jdbc' as 'jdbc' | 'native',
  pureSql: false,
  includeDatabaseObjects: true,
  targetCollation: '',
  limitRows: false,
  maxRows: 50000,
  includeUseDatabase: false,
  includeCreateDatabase: false,
  foreignKeyChecks0: true,
  createBulkInsert: true,
  oneRowPerLine: true,
  includeDrop: true,
  includeVersionInfo: true,
  convertBlobToHex: true,
});

/** 纯净模式按已验证的产品能力展示，避免把厂商 SQL 宣称为跨产品通用 SQL。 @author yanch */
const supportsPureSql = computed(() => dialect.value.family === 'MYSQL_LIKE');
const nativeMysql = computed(() => form.engine === 'native' && supportsPureSql.value);
/** 工具的固定能力先在界面说明，是否安装由后台任务继续检查。 */
const nativeUnavailableReason = computed(() => {
  if (['MYSQL_LIKE', 'POSTGRES_LIKE'].includes(dialect.value.family)) return '';
  if (['SQLITE_LIKE', 'MONGODB_LIKE'].includes(dialect.value.family)) {
    return form.mode === 'both' && checkedTables.value.length === 1
      ? '' : '当前客户端仅支持单表/集合的结构和数据导出，请调整选择或使用 Java。';
  }
  return '当前数据库的选表导出暂不支持官方客户端，请使用 Java。';
});
/** 附属对象只服务于明确的库级标准结构导出，部分表选择不扩大范围。 */
const canIncludeDatabaseObjects = computed(() => !!props.background && form.engine === 'jdbc'
  && !form.pureSql && form.mode !== 'data' && checkedTables.value.length === tableOptions.value.length);
const includeDatabaseObjects = computed(() => form.includeDatabaseObjects && canIncludeDatabaseObjects.value);
watch(checkedTables, () => {
  if (!loadingTables.value && checkedTables.value.length !== tableOptions.value.length) form.includeDatabaseObjects = false;
}, { deep: true });
const search = ref('');
const filteredTables = computed(() => tableOptions.value.filter((table) =>
  table.label.toLowerCase().includes(search.value.trim().toLowerCase()),
));
/** 纯净模式由 Java 生成，服务端再次校验，不能靠隐藏复选框保证文件纯净。 */
watch(() => form.pureSql, (pure) => {
  if (!pure) return;
  form.engine = 'jdbc';
  form.includeUseDatabase = false;
  form.includeCreateDatabase = false;
  form.foreignKeyChecks0 = false;
  form.includeDrop = false;
  form.includeVersionInfo = false;
});
watch(() => form.engine, (engine) => {
  if (engine !== 'native') return;
  form.convertBlobToHex = true;
  form.limitRows = false;
  if (dialect.value.family === 'SQLITE_LIKE') form.includeDrop = false;
});

const dumpExtension = computed(() => {
  if (form.engine === 'jdbc') return props.dbType === 'MONGODB' ? '.js' : '.sql';
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
    tableOptions.value = [];
    checkedTables.value = [];
    return;
  }
  loadingTables.value = true;
  try {
    const res: any = await getTables(props.dbConfigId, props.instanceName);
    const list = (res?.data || res || [])
      .map((t: any) => {
        const key = String(t?.qualifiedName || t?.tableName || '').trim();
        if (!key) return null;
        const raw = String(t?.rawTableName || t?.tableName || key);
        const schema = String(t?.schemaName || '').trim();
        const label =
          schema && key.toLowerCase() !== raw.toLowerCase()
            ? `${schema}.${raw}`
            : raw;
        return { key, label };
      })
      .filter(Boolean) as { key: string; label: string }[];
    tableOptions.value = list;
    const keys = list.map((t) => t.key);
    const pre = (props.preselectedTables || []).filter((t) => keys.includes(t));
    // 右键带来的是 schema.table，列表若仍是裸表名，再按后缀对齐，避免误选全库
    const resolved =
      pre.length > 0
        ? pre
        : keys.filter((key) =>
            (props.preselectedTables || []).some(
              (name) =>
                key === name ||
                key.endsWith(`.${name}`) ||
                name.endsWith(`.${key}`),
            ),
          );
    checkedTables.value = props.preselectedTables?.length ? resolved : [...keys];
  } catch {
    tableOptions.value = [];
    checkedTables.value = [];
    ElMessage.error('读取表清单失败，请关闭后重试');
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
    form.includeDatabaseObjects = true;
    search.value = '';
    if (!supportsPureSql.value) form.pureSql = false;
    await loadTables();
    syncFileName();
  },
  { immediate: true },
);

watch(
  [checkedTables, () => form.mode, () => props.dbType, () => form.engine],
  () => syncFileName(),
  { deep: true },
);

function toggleAll(check: boolean) {
  checkedTables.value = check ? tableOptions.value.map((t) => t.key) : [];
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

/** 校验选择并下载完整文件，避免重复提交。 @author yanch */
async function onExport() {
  if (exporting.value || loadingTables.value) return;
  if (form.engine === 'native' && nativeUnavailableReason.value) {
    ElMessage.warning(nativeUnavailableReason.value);
    return;
  }
  if (!props.dbConfigId) {
    ElMessage.warning('无有效连接');
    return;
  }
  if (!checkedTables.value.length && !includeDatabaseObjects.value) {
    ElMessage.warning('请至少选择一张表');
    return;
  }
  exporting.value = true;
  try {
    const request: Parameters<typeof exportSqlDump>[0] = {
      dbConfigId: props.dbConfigId,
      instanceName: props.instanceName,
      tableNames: checkedTables.value,
      mode: form.mode,
      engine: form.engine,
      pureSql: form.pureSql,
      ...(props.background ? { includeDatabaseObjects: includeDatabaseObjects.value } : {}),
      targetCollation: form.pureSql && form.mode !== 'data' ? form.targetCollation || undefined : undefined,
      includeUseDatabase: form.includeUseDatabase,
      includeCreateDatabase: form.includeCreateDatabase,
      foreignKeyChecks0: form.foreignKeyChecks0,
      createBulkInsert: form.createBulkInsert,
      oneRowPerLine: form.oneRowPerLine,
      includeDrop: form.includeDrop,
      includeVersionInfo: form.includeVersionInfo,
      convertBlobToHex: form.convertBlobToHex,
      maxRows: form.limitRows ? form.maxRows : 0,
    };
    if (props.background) {
      const { dbConfigId, engine, ...options } = request;
      const response: any = await startDbBackup({ dbConfigId, instanceName: props.instanceName, engine,
        options: { ...options, fileName: fileName.value } });
      const task = response?.data ?? response;
      if (!task?.taskId) throw new Error(task?.msg || '未获取到导出任务');
      emit('started', task);
      visible.value = false;
      return;
    }
    const res: any = await exportSqlDump(request);
    // 兼容直出 Blob 与历史 { data: Blob } 包装，避免伪 .sql 文件
    // @author yanch
    const fileBlob = unwrapFileBlob(res);
    if (!fileBlob) {
      ElMessage.error('导出失败：未收到有效文件');
      return;
    }
    const errMsg = await readBlobErrorMessage(fileBlob);
    if (errMsg) {
      ElMessage.error(errMsg);
      return;
    }
    const extension = await resolveDownloadExtension(fileBlob, res);
    await downloadBlobAsFile(
      fileBlob,
      withExtension(fileName.value || `dump${extension}`, extension),
    );
    ElMessage.success('备份导出成功');
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
    :title="$tr('数据库导出')"
    width="960px"
    :close-on-click-modal="!exporting"
    :close-on-press-escape="!exporting"
    :show-close="!exporting"
    destroy-on-close
    append-to-body
    class="sql-dump-dialog"
  >
    <fieldset class="dump-fields" :disabled="exporting" :aria-busy="exporting">
    <div class="dump-toolbar">
      <div class="mode-row">
        <span class="label">{{ $tr('SQL导出') }}</span>
        <ElRadioGroup v-model="form.mode" size="small">
          <ElRadioButton value="structure">{{ $tr('仅结构') }}</ElRadioButton>
          <ElRadioButton value="data">{{ $tr('仅数据') }}</ElRadioButton>
          <ElRadioButton value="both">{{ $tr('结构和数据') }}</ElRadioButton>
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
        <ElInput v-model="search" class="obj-search" :placeholder="$tr('搜索表名')" :aria-label="$tr('搜索表名')" clearable />
        <div class="folder">{{ $tr('已选择') }} {{ checkedTables.length }} / {{ tableOptions.length }}</div>
        <!-- 高度由 .obj-scroll 吃满左侧剩余空间，避免固定 360px 与面板对不齐 -->
        <ElScrollbar class="obj-scroll">
          <!-- 全选控件独立于 CheckboxGroup，避免把它自身当作待导出表。 -->
          <ElCheckbox :model-value="checkedTables.length > 0 && checkedTables.length === tableOptions.length"
            :indeterminate="checkedTables.length > 0 && checkedTables.length < tableOptions.length"
            @change="(checked: boolean | number | string) => toggleAll(!!checked)">{{ $tr('表（全选）') }}</ElCheckbox>
          <ElCheckboxGroup v-model="checkedTables" class="table-checks">
            <ElCheckbox
              v-for="item in filteredTables"
              :key="item.key"
              :value="item.key"
            >
              {{ item.label }}
            </ElCheckbox>
          </ElCheckboxGroup>
        </ElScrollbar>
      </div>

      <div class="opt-pane">
        <div class="opt-group">
          <div class="opt-title">{{ $tr('导出方式') }}</div>
          <ElRadioGroup v-model="form.engine" :aria-label="$tr('导出方式')">
            <ElRadio value="jdbc">{{ $tr('Java 导出') }}</ElRadio>
            <ElRadio value="native" :disabled="form.pureSql || !!nativeUnavailableReason">{{ $tr('官方客户端') }}</ElRadio>
          </ElRadioGroup>
          <ElCheckbox v-if="background" v-model="form.includeDatabaseObjects" :disabled="!canIncludeDatabaseObjects">{{ $tr('包含视图、独立序列和程序对象（全部表）') }}</ElCheckbox>
          <ElCheckbox v-model="form.pureSql" :disabled="!supportsPureSql">{{ $tr('纯净 SQL（仅建表语句和 INSERT）') }}</ElCheckbox>
          <div v-if="form.pureSql" class="mt-2">
            <span>{{ $tr('目标排序规则') }}</span>
            <ElSelect v-model="form.targetCollation" :disabled="form.mode === 'data'" :aria-label="$tr('目标排序规则')" style="width: 100%">
              <ElOption :label="$tr('保留源定义（默认）')" value="" />
              <ElOption label="utf8mb4_unicode_ci" value="utf8mb4_unicode_ci" />
              <ElOption label="utf8mb4_general_ci" value="utf8mb4_general_ci" />
              <ElOption label="utf8mb4_bin" value="utf8mb4_bin" />
            </ElSelect>
            <div class="hint">{{ $tr('迁到 MariaDB 或旧版 MySQL 时可明确选择兼容规则；更换规则会改变比较与排序语义。') }}</div>
          </div>
          <div class="hint">{{ $tr(supportsPureSql
            ? '纯净版使用源数据库方言，不含 USE、CREATE DATABASE、DROP、SET、触发器和存储过程。导入前选择目标库；导出结构时外键依赖表需一起勾选；仅数据可选择子表。'
            : '当前纯净 SQL 支持 MySQL 兼容数据库，其他数据库可使用标准导出。') }}</div>
          <ElAlert v-if="form.engine === 'native'" type="info" :closable="false"
            :title="$tr('使用服务端配置的官方客户端；不可用时会提示错误。客户端负责会话及文件格式，精细选项请使用 Java 导出。')" />
          <ElAlert v-if="nativeUnavailableReason" type="info" :closable="false" :title="$tr(nativeUnavailableReason)" />
        </div>
        <ElDivider />
        <div class="opt-group">
          <div class="opt-title">{{ $tr('把选项写进文件') }}</div>
          <ElCheckbox v-model="form.includeUseDatabase" :disabled="form.pureSql || form.engine === 'native'">{{
            dialect.dumpUseOptionLabel
          }}</ElCheckbox>
          <ElCheckbox v-model="form.includeCreateDatabase" :disabled="form.pureSql || form.engine === 'native'">{{ $tr('包含创建库/Schema 语句') }}</ElCheckbox>
          <ElCheckbox v-model="form.foreignKeyChecks0" :disabled="form.pureSql || form.engine === 'native'">{{
            dialect.dumpFkOptionLabel
          }}</ElCheckbox>
          <ElCheckbox v-model="form.createBulkInsert" :disabled="form.engine === 'native' && !nativeMysql">{{ $tr('创建批量插入语句') }}</ElCheckbox>
          <ElCheckbox
            v-model="form.oneRowPerLine"
            :disabled="!form.createBulkInsert || form.engine === 'native'"
            class="indent"
          >
            {{ $tr('每行一条记录') }}
          </ElCheckbox>
          <ElCheckbox v-model="form.includeDrop" :disabled="form.pureSql || (form.engine === 'native' && !nativeMysql && dialect.family !== 'POSTGRES_LIKE')">{{ $tr('包含 "DROP" 语句') }}</ElCheckbox>
          <ElCheckbox v-model="form.includeVersionInfo" :disabled="form.pureSql || (form.engine === 'native' && !nativeMysql)">{{ $tr('在备份文件中包含版本信息') }}</ElCheckbox>
          <ElCheckbox v-model="form.convertBlobToHex" :disabled="form.engine === 'native'">{{ $tr('将 BLOB 转为 HEX') }}</ElCheckbox>
        </div>
        <div class="hint">
          <ElCheckbox v-model="form.limitRows" :disabled="form.engine === 'native' || form.mode === 'structure'">{{ $tr('限制每表数据行数') }}</ElCheckbox>
          <ElInputNumber v-if="form.limitRows" v-model="form.maxRows" :min="1" :max="2147483647" :aria-label="$tr('每表数据行数上限')" />
          <p>{{ $tr('默认导出所选表的全部数据。导出文件供同类型数据库导入；不同产品之间迁移请使用复制到不同主机。') }}</p>
        </div>
      </div>
    </div>

    </fieldset>
    <template #footer>
      <ElButton :loading="exporting" :disabled="loadingTables || (!checkedTables.length && !includeDatabaseObjects)" type="primary" @click="onExport">{{ $tr('导出') }}</ElButton>
      <ElButton :disabled="exporting" @click="visible = false">{{ $tr('关闭') }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.dump-fields { border: 0; margin: 0; padding: 0; min-width: 0; }
.sql-dump-dialog { max-width: calc(100vw - 32px); }

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
  /* 主体固定高度，左右栏对齐，表列表在剩余空间内滚动 */
  height: 480px;
}
.obj-pane,
.opt-pane {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--el-bg-color);
  min-height: 0;
  overflow: hidden;
}
.obj-pane {
  display: flex;
  flex-direction: column;
}
.obj-search,
.pane-title,
.folder {
  flex-shrink: 0;
}
.obj-scroll {
  flex: 1;
  /* flex 子项用 height:0 吃满左侧剩余高度并内部滚动 */
  height: 0;
  min-height: 0;
}
.opt-pane {
  overflow-y: auto;
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
@media (max-width: 680px) {
  .dump-body {
    grid-template-columns: 1fr;
    height: auto;
    max-height: 70vh;
    overflow-y: auto;
  }
  .obj-pane {
    min-height: 260px;
  }
}
</style>
