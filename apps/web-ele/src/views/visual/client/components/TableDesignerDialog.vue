<script lang="ts" setup>
import type {
  TableDesignColumn,
  TableDesignForeignKey,
  TableDesignIndex,
  TableDesignModel,
  TableDesignSqlResult,
} from '../dialect/tableDesignerDialect';

/**
 * 可视化表设计器。
 *
 * <p>字段、索引、外键和表属性使用统一交互；所有数据库差异由 tableDesignerDialect
 * 提供。保存前始终重新生成 SQL，预览与实际执行使用同一份语句，避免两条路径不一致。</p>
 *
 * @author yanch
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import { resolveTableIdent } from '../dialect/sqlDialect';
import {
  generateTableDesignSql,
  columnParameterHint,
  columnTypeNotice,
  normalizeColumnTypeSelection,
  resolveColumnParameterMode,
  resolveTableDesignerProfile,
  splitColumnType,
  supportsIndexSort,
  supportsAutoIncrementType,
  validateColumnParameters,
} from '../dialect/tableDesignerDialect';

defineOptions({ name: 'TableDesignerDialog' });

const props = withDefaults(
  defineProps<{
    dbType?: string;
    info?: null | TableInfoInput;
    instanceName: string;
    loading?: boolean;
    executionError?: string;
    mode: 'alter' | 'create';
    modelValue: boolean;
    saving?: boolean;
    schemaName?: string;
    tableName?: string;
  }>(),
  {
    dbType: 'MY_SQL',
    info: null,
    loading: false,
    executionError: '',
    saving: false,
    schemaName: '',
    tableName: '',
  },
);

const emit = defineEmits<{
  save: [payload: TableDesignSqlResult];
  'update:modelValue': [boolean];
}>();

interface TableInfoInput {
  tableName?: string;
  instanceName?: string;
  schemaName?: string;
  description?: string;
  columns?: Array<{
    autoIncrement?: boolean;
    dataType?: string;
    defaultConstraintName?: string;
    defaultValue?: string;
    description?: string;
    fieldName?: string;
    isNullable?: boolean;
    isPrimary?: boolean;
    length?: number | string;
    scale?: number | string;
  }>;
  indexes?: Array<{
    columns?: string;
    indexName?: string;
    indexType?: string;
    unique?: boolean;
  }>;
  foreignKeys?: Array<{
    columns?: string;
    foreignKeyName?: string;
    onDelete?: string;
    onUpdate?: string;
    referencedColumns?: string;
    referencedSchema?: string;
    referencedTable?: string;
  }>;
  properties?: Record<string, string>;
}

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const profile = computed(() => resolveTableDesignerProfile(props.dbType));
const activeTab = ref('columns');
const previewVisible = ref(false);
const previewResult = ref<TableDesignSqlResult>({ statements: [], sql: '', warnings: [], errors: [] });
const original = ref<null | TableDesignModel>(null);
const form = reactive<TableDesignModel>(emptyModel());
const validationErrors = ref<string[]>([]);
const errorSummary = ref<HTMLElement>();
const previousColumnNames = new Map<string, string>();
let sequence = 0;

function uid(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function emptyModel(): TableDesignModel {
  return {
    tableName: 'new_table',
    comment: '',
    columns: [],
    indexes: [],
    foreignKeys: [],
    options: {},
  };
}

function splitColumns(value?: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\s+(ASC|DESC)$/i, ''))
    .filter(Boolean);
}

/** 解析元数据中的索引字段顺序，同时保留 DESC 信息。 */
function parseIndexColumns(value?: string): { columns: string[]; descendingColumns: string[] } {
  const parts = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const columnName = (item: string) => {
    const name = item.replace(/\s+(ASC|DESC)$/i, '').trim();
    if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
      return name.slice(1, -1).replaceAll('""', '"');
    }
    if (name.length >= 2 && name.startsWith('`') && name.endsWith('`')) {
      return name.slice(1, -1).replaceAll('``', '`');
    }
    if (name.length >= 2 && name.startsWith('[') && name.endsWith(']')) {
      return name.slice(1, -1).replaceAll(']]', ']');
    }
    return name;
  };
  return {
    columns: parts.map(columnName),
    descendingColumns: parts
      .filter((item) => /\s+DESC$/i.test(item))
      .map(columnName),
  };
}

function cloneModel(value: TableDesignModel): TableDesignModel {
  return JSON.parse(JSON.stringify(value));
}

/** 将后端表详情还原为可编辑模型，originalName 用于保存时可靠计算差异。 */
function modelFromInfo(info: TableInfoInput): TableDesignModel {
  const tableName = info.tableName || props.tableName || '';
  const columns: TableDesignColumn[] = (info.columns || []).map((item) => {
    const type = splitColumnType(
      item.dataType || profile.value.defaultType,
      item.length,
      item.scale,
      profile.value.family,
    );
    return {
      id: uid('column'),
      originalName: item.fieldName || '',
      name: item.fieldName || '',
      ...type,
      nullable: item.isNullable !== false,
      primary: !!item.isPrimary,
      autoIncrement: !!item.autoIncrement,
      defaultValue: item.defaultValue || '',
      defaultConstraintName: item.defaultConstraintName || '',
      comment: item.description || '',
    };
  });
  const primaryKeyName = Object.entries(info.properties || {}).find(([name]) => name.toLowerCase() === 'primarykeyname')?.[1];
  const indexes: TableDesignIndex[] = (info.indexes || [])
    .filter((item) => {
      const name = String(item.indexName || '').toLowerCase();
      // 主键由字段页管理；同列的普通唯一索引不能被误隐藏。
      const isPrimaryIndex = (profile.value.family === 'MYSQL_LIKE' && name === 'primary')
        || (!!primaryKeyName && name === primaryKeyName.toLowerCase())
        || (profile.value.family === 'SQLITE_LIKE' && /^sqlite_autoindex_/.test(name));
      return !(profile.value.family === 'MONGODB_LIKE' && name === '_id_') && !isPrimaryIndex;
    })
    .map((item) => {
      const indexColumns = parseIndexColumns(item.columns);
      return {
        id: uid('index'),
        originalName: item.indexName || '',
        name: item.indexName || '',
        unique: !!item.unique,
        type: normalizeIndexType(item.indexType),
        ...indexColumns,
      };
    });
  const foreignKeys: TableDesignForeignKey[] = (info.foreignKeys || []).map((item) => ({
    id: uid('foreign-key'),
    originalName: item.foreignKeyName || '',
    name: item.foreignKeyName || '',
    columns: splitColumns(item.columns),
    referencedSchema: item.referencedSchema || '',
    referencedTable: item.referencedTable || '',
    referencedColumns: splitColumns(item.referencedColumns),
    onDelete: item.onDelete || 'NO ACTION',
    onUpdate: item.onUpdate || 'NO ACTION',
  }));
  return {
    originalTableName: tableName,
    tableName,
    comment: info.description || '',
    columns,
    indexes,
    foreignKeys,
    options: inferOptions(info.properties || {}),
  };
}

/** 常见属性名大小写不同，这里只做无损的展示值回填。 */
function inferOptions(properties: Record<string, string>): Record<string, string> {
  const lower = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    engine: lower.engine || '',
    charset: lower.charset || lower.collation?.split('_')[0] || '',
    collation: lower.collation || '',
    tablespace: lower.tablespace || lower.tablespace_name || '',
    filegroup: lower.filegroup || '',
    primaryKeyName: lower.primarykeyname || '',
    validationLevel: lower.validationlevel || 'strict',
    validationAction: lower.validationaction || 'error',
    // 仅作为 MongoDB 校验器无损回写的底稿，不在表信息页暴露为普通文本框。
    jsonSchema: lower.jsonschema || '',
  };
}

/** 将各驱动返回的索引类型名归一化为当前方言的可编辑值。 */
function normalizeIndexType(value?: string): string {
  const type = String(value || '').trim().toUpperCase().replaceAll('_', ' ');
  if (profile.value.family === 'MONGODB_LIKE' && (!type || type === 'BTREE')) return 'STANDARD';
  if (profile.value.family === 'SQLITE_LIKE') return 'DEFAULT';
  if (profile.value.family === 'ORACLE_LIKE' && (!type || type === 'BTREE')) return 'NORMAL';
  return type || profile.value.defaultIndexType;
}

function resetForm(): void {
  const next = props.mode === 'alter' && props.info
    ? modelFromInfo(props.info)
    : emptyModel();
  if (props.mode === 'create') {
    next.tableName = props.tableName || 'new_table';
    next.options = inferOptions({});
    if (profile.value.family === 'MYSQL_LIKE') {
      next.options.engine = 'InnoDB';
      next.options.charset = 'utf8mb4';
    }
    if (profile.value.family === 'MONGODB_LIKE') {
      next.options.validationLevel = 'strict';
      next.options.validationAction = 'error';
    }
    next.columns.push({
      id: uid('column'),
      name: profile.value.family === 'MONGODB_LIKE' ? '_id' : 'id',
      dataType: profile.value.family === 'MONGODB_LIKE' ? 'objectId' : profile.value.defaultType,
      length: '',
      scale: '',
      nullable: false,
      primary: true,
      autoIncrement: profile.value.family !== 'MONGODB_LIKE',
      defaultValue: '',
      comment: '主键',
    });
  }
  Object.assign(form, cloneModel(next));
  previousColumnNames.clear();
  form.columns.forEach(column => previousColumnNames.set(column.id, column.name));
  validationErrors.value = [];
  original.value = props.mode === 'alter' ? cloneModel(next) : null;
  activeTab.value = 'columns';
  previewVisible.value = false;
}

watch(
  () => [props.modelValue, props.info, props.dbType, props.mode],
  ([open]) => {
    if (open) resetForm();
  },
  { immediate: true },
);

const columnNames = computed(() => form.columns.map((item) => item.name.trim()).filter(Boolean));
const dialogTitle = computed(() => {
  const action = props.mode === 'create' ? '新建表' : '修改表';
  return `${action} · ${props.instanceName || '-'} · ${profile.value.label}`;
});

function addColumn(): void {
  let suffix = form.columns.length + 1;
  while (form.columns.some(column => column.name === `column_${suffix}`)) suffix++;
  form.columns.push({
    id: uid('column'),
    name: `column_${suffix}`,
    dataType: profile.value.defaultType,
    length: '',
    scale: '',
    nullable: true,
    primary: false,
    autoIncrement: false,
    defaultValue: '',
    comment: '',
  });
  const column = form.columns.at(-1)!;
  previousColumnNames.set(column.id, column.name);
}

function addIndex(): void {
  form.indexes.push({
    id: uid('index'),
    name: `idx_${form.tableName}_${form.indexes.length + 1}`,
    unique: false,
    type: profile.value.defaultIndexType,
    columns: [],
    descendingColumns: [],
  });
}

/** 类型切换后清理不适用的参数，避免隐藏值触发无意义的 ALTER。 */
function normalizeColumnArguments(column: TableDesignColumn): void {
  normalizeColumnTypeSelection(column, profile.value);
}

/** 字段改名同步本表索引和外键，并维护自引用外键的目标列名。 @author yanch */
function renameColumn(column: TableDesignColumn): void {
  const before = previousColumnNames.get(column.id);
  column.name = column.name.trim();
  if (before && before !== column.name) {
    for (const index of form.indexes) {
      index.columns = index.columns.map(name => name === before ? column.name : name);
      index.descendingColumns = index.descendingColumns.map(name => name === before ? column.name : name);
    }
    for (const fk of form.foreignKeys) {
      fk.columns = fk.columns.map(name => name === before ? column.name : name);
      if (fk.referencedTable === form.tableName && (!fk.referencedSchema || fk.referencedSchema === props.schemaName)) fk.referencedColumns = fk.referencedColumns.map(name => name === before ? column.name : name);
    }
  }
  previousColumnNames.set(column.id, column.name);
}

/** 单列参数错误在字段旁显示；历史字段未改类型参数时保留原生元数据。 @author yanch */
const columnErrors = computed(() => Object.fromEntries(form.columns.map(column => {
  const before = original.value?.columns.find(item => item.name === column.originalName);
  const unchanged = before && ['dataType', 'length', 'scale', 'autoIncrement', 'defaultValue'].every(key => before[key as keyof TableDesignColumn] === column[key as keyof TableDesignColumn]);
  return [column.id, unchanged ? [] : validateColumnParameters(column, profile.value)];
})));

/** 主键必填状态与生成的 NOT NULL 一致，避免界面显示可空而数据库实际不可空。 @author yanch */
function setPrimary(column: TableDesignColumn, primary: boolean): void {
  column.primary = primary;
  if (primary) column.nullable = false;
}

/** 错误摘要定位到对应字段；切换到字段页后再设置键盘焦点。 @author yanch */
function errorColumnId(error: string): string | undefined {
  return form.columns.find(column => error.includes(`字段「${column.name}」`))?.id;
}

/** 保证错误字段在横向滚动的表格中可见。 @author yanch */
async function focusErrorColumn(error: string): Promise<void> {
  activeTab.value = 'columns'; await nextTick();
  const input = document.getElementById(`column-input-${errorColumnId(error)}`);
  input?.focus(); input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function columnParameterMode(column: TableDesignColumn) {
  return resolveColumnParameterMode(column.dataType, profile.value.family);
}

function canSortIndex(index: TableDesignIndex): boolean {
  return supportsIndexSort(index.type, profile.value.family);
}

function normalizeIndexColumns(index: TableDesignIndex): void {
  index.descendingColumns = (index.descendingColumns || [])
    .filter((name) => index.columns.includes(name));
  if (!canEditBoundingBox(index)) index.boundingBox = '';
}

function normalizeIndexTypeSelection(index: TableDesignIndex): void {
  if (!canSortIndex(index)) index.descendingColumns = [];
  if (!canEditBoundingBox(index)) index.boundingBox = '';
}

/** geometry 的空间网格需要用户指定实际坐标边界，不能替用户猜测。 @author yanch */
function canEditBoundingBox(index: TableDesignIndex): boolean {
  return profile.value.family === 'SQLSERVER_LIKE' && index.type === 'SPATIAL'
    && index.columns.some(name => form.columns.some(column => column.name === name && column.dataType.toUpperCase() === 'GEOMETRY'));
}

function addForeignKey(): void {
  form.foreignKeys.push({
    id: uid('foreign-key'),
    name: `fk_${form.tableName}_${form.foreignKeys.length + 1}`,
    columns: [],
    referencedSchema: '',
    referencedTable: '',
    referencedColumns: [],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  });
}

function moveColumn(index: number, offset: number): void {
  const target = index + offset;
  if (target < 0 || target >= form.columns.length) return;
  const [item] = form.columns.splice(index, 1);
  if (item) form.columns.splice(target, 0, item);
}

/** 构建与执行共用的 SQL；错误固定显示在表单上方，避免仅依赖短暂消息。 @author yanch */
function buildSql(): TableDesignSqlResult {
  form.tableName = form.tableName.trim();
  form.columns.forEach(renameColumn);
  const ident = resolveTableIdent(props.dbType, {
    instanceName: props.instanceName,
    schemaName: props.schemaName || props.info?.schemaName,
    tableName: form.tableName,
  });
  const result = generateTableDesignSql({
    dbType: props.dbType,
    schema: ident.schema,
    mode: props.mode,
    model: cloneModel(form),
    original: original.value ? cloneModel(original.value) : null,
  });
  validationErrors.value = result.errors;
  if (result.errors.length) void nextTick(() => errorSummary.value?.focus());
  return result;
}

function preview(): void {
  if (props.loading || props.saving) return;
  const result = buildSql();
  previewResult.value = result;
  previewVisible.value = true;
}

function save(): void {
  if (props.loading || props.saving || props.executionError) return;
  const result = buildSql();
  if (result.errors.length) {
    return;
  }
  if (!result.statements.length) {
    ElMessage.info('表结构没有变化');
    return;
  }
  emit('save', result);
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="dialogTitle"
    width="min(1480px, 97vw)"
    top="4vh"
    destroy-on-close
    append-to-body
    class="table-designer-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
  >
    <div v-loading="loading || saving" :inert="loading || saving" class="designer-body">
      <ElAlert v-if="executionError" :title="executionError" type="error" :closable="false" show-icon class="designer-alert" />
      <div v-if="validationErrors.length" ref="errorSummary" class="validation-summary" role="alert" tabindex="-1" aria-label="表结构校验错误">
        <strong>{{ $tr('请修正以下问题') }}</strong>
        <ul><li v-for="error in validationErrors" :key="error"><a v-if="errorColumnId(error)" :href="`#column-input-${errorColumnId(error)}`" @click.prevent="focusErrorColumn(error)">{{ error }}</a><span v-else>{{ error }}</span></li></ul>
      </div>
      <ElAlert
        v-if="profile.family === 'SQLITE_LIKE' && mode === 'alter'"
        :title="$tr('SQLite 可直接新增、删除、重命名字段；修改字段类型、默认值、可空性或外键需要重建表。')"
        type="info"
        :closable="false"
        show-icon
        class="designer-alert"
      />
      <ElAlert
        v-if="profile.family === 'MONGODB_LIKE'"
        :title="$tr('MongoDB 字段页配置 $jsonSchema 校验规则；必填表示字段必须存在，允许 null 请在类型中输入 string | null 等联合类型。')"
        type="info"
        :closable="false"
        show-icon
        class="designer-alert"
      />

      <ElForm label-width="86px" size="small" class="table-summary">
        <ElRow :gutter="16">
          <ElCol :span="8">
            <ElFormItem :label="$tr(profile.family === 'MONGODB_LIKE' ? '集合名' : '表名')" required>
              <ElInput v-model="form.tableName" clearable :disabled="mode === 'alter' && profile.family === 'MONGODB_LIKE'" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem :label="$tr('所属位置')">
              <ElInput :model-value="schemaName || info?.schemaName || instanceName" disabled />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem :label="$tr('备注')">
              <ElInput v-model="form.comment" clearable :disabled="['MONGODB_LIKE', 'SQLITE_LIKE'].includes(profile.family)" />
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>

      <ElTabs v-model="activeTab" class="designer-tabs">
        <ElTabPane :label="`${$tr('字段')} (${form.columns.length})`" name="columns">
          <div class="tab-toolbar">
            <ElButton type="primary" plain size="small" @click="addColumn">+ {{ $tr('添加字段') }}</ElButton>
            <span class="toolbar-hint">{{ $tr('类型支持搜索及原生声明；长度、精度独立设置。默认值按 SQL 表达式填写，字符串须加单引号。') }}</span>
          </div>
          <ElTable :data="form.columns" border stripe size="small" max-height="430" row-key="id">
            <ElTableColumn type="index" width="46" align="center" />
            <ElTableColumn :label="$tr('字段名')" min-width="150">
              <template #default="{ row }">
                <ElInput :id="`column-input-${row.id}`" v-model="row.name" :aria-label="`${$tr('字段名')} ${row.name}`" :aria-describedby="columnErrors[row.id]?.length ? `column-error-${row.id}` : undefined" @change="renameColumn(row)" />
                <div v-if="columnErrors[row.id]?.length" :id="`column-error-${row.id}`" class="column-error">{{ columnErrors[row.id]?.join('；') }}</div>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('类型')" min-width="180">
              <template #default="{ row }">
                <ElSelect v-model="row.dataType" filterable allow-create default-first-option :aria-label="`${row.name} ${$tr('类型')}`" @change="normalizeColumnArguments(row)">
                  <ElOption v-for="type in profile.types" :key="type" :label="type" :value="type" />
                </ElSelect>
                <div v-if="columnTypeNotice(row, profile)" class="column-type-notice">{{ columnTypeNotice(row, profile) }}</div>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!['MONGODB_LIKE', 'SQLITE_LIKE'].includes(profile.family)" :label="$tr('长度/精度/成员')" width="150">
              <template #default="{ row }">
                <ElTooltip :content="columnParameterHint(row, profile)" placement="top" trigger="hover">
                <ElInput
                  v-model="row.length"
                  :disabled="columnParameterMode(row) === 'none'"
                  :aria-label="`${row.name} ${$tr('长度/精度/成员')}`"
                  :aria-describedby="columnErrors[row.id]?.length ? `column-error-${row.id}` : undefined"
                  :placeholder="columnParameterMode(row) === 'free' ? `'a','b'` : columnParameterMode(row) === 'precision-scale' ? '可选精度' : columnParameterMode(row) === 'fractional' ? '小数秒精度' : profile.family === 'SQLSERVER_LIKE' ? '长度 / MAX' : '长度'"
                />
                </ElTooltip>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!['MONGODB_LIKE', 'SQLITE_LIKE'].includes(profile.family)" :label="$tr('小数位')" width="88">
              <template #default="{ row }">
                <ElInput
                  v-model="row.scale"
                  :disabled="columnParameterMode(row) !== 'precision-scale'"
                  :aria-label="`${row.name} ${$tr('小数位')}`"
                  :aria-describedby="columnErrors[row.id]?.length ? `column-error-${row.id}` : undefined"
                  :placeholder="columnParameterMode(row) === 'precision-scale' ? '可选' : ''"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="profile.family !== 'MONGODB_LIKE'" :label="$tr('主键')" width="64" align="center">
              <template #default="{ row }"><ElCheckbox :model-value="row.primary" :aria-label="`${row.name} ${$tr('主键')}`" @update:model-value="(value: boolean) => setPrimary(row, value)" /></template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('必填')" width="64" align="center">
              <template #default="{ row }"><ElCheckbox :model-value="row.primary || !row.nullable" :disabled="row.primary" :aria-label="`${row.name} ${$tr('必填')}`" @update:model-value="(value: boolean) => (row.nullable = !value)" /></template>
            </ElTableColumn>
            <ElTableColumn v-if="profile.family !== 'MONGODB_LIKE'" :label="$tr('自增')" width="64" align="center">
              <template #default="{ row }"><ElCheckbox v-model="row.autoIncrement" :disabled="!supportsAutoIncrementType(row, profile) || (mode === 'alter' && !!row.originalName && profile.family !== 'MYSQL_LIKE')" :aria-label="`${row.name} ${$tr('自增')}`" /></template>
            </ElTableColumn>
            <ElTableColumn v-if="profile.family !== 'MONGODB_LIKE'" :label="$tr('默认值')" min-width="130">
              <template #default="{ row }"><ElInput v-model="row.defaultValue" :disabled="row.autoIncrement || /^(ROWVERSION|TIMESTAMP)$/i.test(row.dataType) && profile.family === 'SQLSERVER_LIKE'" :aria-label="`${row.name} ${$tr('默认值')}`" placeholder="'文本' / 0 / CURRENT_TIMESTAMP" /></template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('备注')" min-width="140">
              <template #default="{ row }"><ElInput v-model="row.comment" :disabled="profile.family === 'SQLITE_LIKE'" /></template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('操作')" width="116" fixed="right" align="center">
              <template #default="{ $index }">
                <ElButton link size="small" :aria-label="$tr('上移字段')" :disabled="$index === 0" @click="moveColumn($index, -1)">↑</ElButton>
                <ElButton link size="small" :aria-label="$tr('下移字段')" :disabled="$index === form.columns.length - 1" @click="moveColumn($index, 1)">↓</ElButton>
                <ElButton link type="danger" size="small" @click="form.columns.splice($index, 1)">{{ $tr('删除') }}</ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </ElTabPane>

        <ElTabPane :label="`${$tr('索引')} (${form.indexes.length})`" name="indexes">
          <div class="tab-toolbar"><ElButton type="primary" plain size="small" @click="addIndex">+ {{ $tr('添加索引') }}</ElButton></div>
          <ElTable :data="form.indexes" border stripe size="small" max-height="430" row-key="id">
            <ElTableColumn :label="$tr('索引名')" min-width="190"><template #default="{ row }"><ElInput v-model="row.name" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('字段')" min-width="280">
              <template #default="{ row }">
                <ElSelect v-model="row.columns" multiple filterable :allow-create="profile.family === 'MONGODB_LIKE'" default-first-option @change="normalizeIndexColumns(row)"><ElOption v-for="name in columnNames" :key="name" :label="name" :value="name" /></ElSelect>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('降序字段')" min-width="180">
              <template #default="{ row }">
                <ElSelect v-model="row.descendingColumns" multiple clearable :disabled="!canSortIndex(row)" :placeholder="$tr('默认全部升序')">
                  <ElOption v-for="name in row.columns" :key="name" :label="name" :value="name" />
                </ElSelect>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="$tr('索引类型')" width="210"><template #default="{ row }"><ElSelect v-model="row.type" filterable allow-create @change="normalizeIndexTypeSelection(row)"><ElOption v-for="type in profile.indexTypes" :key="type" :label="type" :value="type" /></ElSelect></template></ElTableColumn>
            <ElTableColumn v-if="profile.family === 'SQLSERVER_LIKE'" :label="$tr('空间边界')" min-width="240"><template #default="{ row }"><ElInput v-model="row.boundingBox" :disabled="!canEditBoundingBox(row)" :aria-label="`${row.name} ${$tr('空间边界')}`" placeholder="xmin,ymin,xmax,ymax" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('唯一')" width="70" align="center"><template #default="{ row }"><ElCheckbox v-model="row.unique" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('操作')" width="76" align="center"><template #default="{ $index }"><ElButton link type="danger" @click="form.indexes.splice($index, 1)">{{ $tr('删除') }}</ElButton></template></ElTableColumn>
          </ElTable>
        </ElTabPane>

        <ElTabPane v-if="profile.supportsForeignKeys" :label="`${$tr('外键')} (${form.foreignKeys.length})`" name="foreignKeys">
          <div class="tab-toolbar"><ElButton type="primary" plain size="small" @click="addForeignKey">+ {{ $tr('添加外键') }}</ElButton></div>
          <ElTable :data="form.foreignKeys" border stripe size="small" max-height="430" row-key="id">
            <ElTableColumn :label="$tr('外键名')" min-width="180"><template #default="{ row }"><ElInput v-model="row.name" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('本表字段')" min-width="220"><template #default="{ row }"><ElSelect v-model="row.columns" multiple><ElOption v-for="name in columnNames" :key="name" :label="name" :value="name" /></ElSelect></template></ElTableColumn>
            <ElTableColumn label="Schema" min-width="130"><template #default="{ row }"><ElInput v-model="row.referencedSchema" :placeholder="schemaName || info?.schemaName" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('引用表')" min-width="150"><template #default="{ row }"><ElInput v-model="row.referencedTable" /></template></ElTableColumn>
            <ElTableColumn :label="$tr('引用字段')" min-width="210"><template #default="{ row }"><ElSelect v-model="row.referencedColumns" multiple filterable allow-create default-first-option /></template></ElTableColumn>
            <ElTableColumn label="ON DELETE" width="135"><template #default="{ row }"><ElSelect v-model="row.onDelete"><ElOption v-for="action in profile.foreignKeyDeleteActions" :key="action" :label="action" :value="action" /></ElSelect></template></ElTableColumn>
            <ElTableColumn label="ON UPDATE" width="135"><template #default="{ row }"><ElSelect v-model="row.onUpdate" :disabled="profile.foreignKeyUpdateActions.length === 1"><ElOption v-for="action in profile.foreignKeyUpdateActions" :key="action" :label="action" :value="action" /></ElSelect></template></ElTableColumn>
            <ElTableColumn :label="$tr('操作')" width="76" fixed="right"><template #default="{ $index }"><ElButton link type="danger" @click="form.foreignKeys.splice($index, 1)">{{ $tr('删除') }}</ElButton></template></ElTableColumn>
          </ElTable>
        </ElTabPane>

        <ElTabPane :label="$tr('表信息')" name="options">
          <ElEmpty v-if="!profile.options.length" :description="$tr('当前数据库没有需要额外设置的表选项')" />
          <ElForm v-else label-width="130px" class="option-form">
            <ElFormItem v-for="option in profile.options" :key="option.key" :label="$tr(option.label)">
              <ElSwitch v-if="option.type === 'boolean'" v-model="form.options[option.key]" />
              <ElSelect v-else-if="option.type === 'select'" v-model="form.options[option.key]" filterable allow-create clearable :placeholder="option.placeholder">
                <ElOption v-for="value in option.values" :key="value" :label="value" :value="value" />
              </ElSelect>
              <ElInput v-else v-model="form.options[option.key]" clearable :placeholder="option.placeholder" />
            </ElFormItem>
          </ElForm>
        </ElTabPane>
      </ElTabs>
    </div>

    <template #footer>
      <div class="designer-footer">
        <ElButton :disabled="saving" @click="visible = false">{{ $tr('取消') }}</ElButton>
        <ElButton :disabled="loading || saving" @click="preview">{{ $tr('预览 SQL') }}</ElButton>
        <ElButton type="primary" :loading="saving" :disabled="loading || saving || !!executionError" @click="save">{{ $tr('保存') }}</ElButton>
      </div>
    </template>
  </ElDialog>

  <ElDialog v-model="previewVisible" :title="$tr('SQL 预览')" width="820px" append-to-body destroy-on-close>
    <ElAlert v-if="previewResult.errors.length" :title="previewResult.errors.join('；')" type="error" :closable="false" show-icon class="preview-alert" />
    <ElAlert v-else-if="previewResult.warnings.length" :title="previewResult.warnings.join('；')" type="warning" :closable="false" show-icon class="preview-alert" />
    <pre class="sql-preview">{{ previewResult.sql || '-- 表结构没有变化' }}</pre>
    <template #footer><ElButton type="primary" @click="previewVisible = false">{{ $tr('关闭') }}</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.designer-body { min-height: 520px; }
.designer-alert { margin-bottom: 12px; }
.table-summary { padding: 12px 12px 0; background: var(--el-fill-color-lighter); border-radius: 6px; }
.designer-tabs { margin-top: 8px; }
.tab-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.toolbar-hint { color: var(--el-text-color-secondary); font-size: 12px; }
.option-form { max-width: 620px; padding: 18px 12px; }
.designer-footer { display: flex; justify-content: flex-end; gap: 8px; }
.preview-alert { margin-bottom: 10px; }
.sql-preview { max-height: 560px; min-height: 260px; overflow: auto; margin: 0; padding: 14px 16px; color: var(--el-text-color-primary); background: var(--el-fill-color-light); border-radius: 6px; font: 13px/1.65 Consolas, Monaco, monospace; white-space: pre-wrap; word-break: break-word; }
.column-error { color: var(--el-color-danger); font-size: 12px; line-height: 1.5; padding-bottom: 4px; }
.column-type-notice { color: var(--el-text-color-regular); font-size: 12px; line-height: 1.5; padding-bottom: 4px; }
.validation-summary { color: var(--el-color-danger); background: var(--el-color-danger-light-9); border: 1px solid var(--el-color-danger-light-5); padding: 10px 14px; margin-bottom: 12px; border-radius: 6px; }
.validation-summary ul { margin: 6px 0 0; padding-left: 20px; }
.validation-summary a { color: inherit; text-decoration: underline; }
.validation-summary:focus { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
:deep(.el-select) { width: 100%; }

/* 表格内联编辑：去掉输入框/下拉自带边框，与单元格贴合，避免双边框 */
:deep(.el-table .el-table__cell) {
  padding: 0;
}
:deep(.el-table .cell) {
  padding: 0 6px;
  line-height: 32px;
}
:deep(.el-table .el-input),
:deep(.el-table .el-select) {
  width: 100%;
  vertical-align: middle;
}
:deep(.el-table .el-input__wrapper),
:deep(.el-table .el-select__wrapper) {
  box-shadow: none;
  background-color: transparent;
  border-radius: 0;
  padding-left: 4px;
  padding-right: 4px;
  min-height: 32px;
}
:deep(.el-table .el-input__wrapper:hover),
:deep(.el-table .el-select__wrapper:hover) {
  box-shadow: none;
  background-color: var(--el-fill-color-light);
}
:deep(.el-table .el-input__wrapper.is-focus),
:deep(.el-table .el-select__wrapper.is-focused) {
  box-shadow: none;
  background-color: var(--el-color-primary-light-9);
}
:deep(.el-table .el-input.is-disabled .el-input__wrapper),
:deep(.el-table .el-select.is-disabled .el-select__wrapper) {
  background-color: transparent;
  box-shadow: none;
}
:deep(.el-table .el-checkbox) {
  height: 32px;
}
</style>
