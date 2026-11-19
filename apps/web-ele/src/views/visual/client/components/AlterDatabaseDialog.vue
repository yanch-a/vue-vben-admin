<script lang="ts" setup>
/**
 * 改变数据库：修改库的默认字符集和排序规则。
 * 打开时先读取当前值；确定后执行 ALTER DATABASE。
 * 已有表和字段不会被这条语句转换。
 *
 * @author yanch
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import { executeDdl, executeSql } from '#/api/visual/database';

import {
  alterDatabaseExecuteInstance,
  buildAlterDatabaseSql,
  buildDatabaseCharsetQuery,
  charsetTokenError,
  readCharsetRow,
  supportsAlterDatabase,
} from '../dialect/alterDatabase';
import {
  MYSQL_CHARSETS,
  MYSQL_COLLATIONS,
  SQLSERVER_COLLATIONS,
} from '../dialect/createDatabase';
import { resolveDialectFamily, type SqlDialectFamily } from '../dialect/dbTypes';

defineOptions({ name: 'AlterDatabaseDialog' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId: number | string;
  dbType: string;
  /** 右键选中的库，名称本身不可在这里改 */
  databaseName: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 修改成功，父级可按需刷新 */
  updated: [databaseName: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const loading = ref(false);
const submitting = ref(false);
/** 正在把服务器读到的值写进表单时，不要按字符集联动改掉排序规则。 */
let hydrating = false;

const form = reactive({ charset: '', collation: '' });
const original = reactive({ charset: '', collation: '' });

const family = computed<SqlDialectFamily>(() => resolveDialectFamily(props.dbType));
const supported = computed(() => supportsAlterDatabase(props.dbType));
const mysql = computed(() => family.value === 'MYSQL_LIKE');

const charsetOptions = computed(() => {
  const list = [...MYSQL_CHARSETS] as string[];
  if (form.charset && !list.includes(form.charset)) list.unshift(form.charset);
  return list;
});

const collationOptions = computed(() => {
  const preset =
    family.value === 'SQLSERVER_LIKE'
      ? ([...SQLSERVER_COLLATIONS] as string[])
      : [...(MYSQL_COLLATIONS[form.charset] || MYSQL_COLLATIONS.utf8mb4 || [])];
  if (form.collation && !preset.includes(form.collation)) preset.unshift(form.collation);
  return preset;
});

const tokenError = computed(() => {
  const charsetError = charsetTokenError(form.charset);
  if (charsetError) return `字符集${charsetError}`;
  const collationError = charsetTokenError(form.collation);
  if (collationError) return `排序规则${collationError}`;
  return '';
});

const sqlPreview = computed(() =>
  buildAlterDatabaseSql(
    props.dbType,
    props.databaseName,
    mysql.value ? form.charset : '',
    form.collation,
  ),
);

const unchanged = computed(() => {
  if (family.value === 'SQLSERVER_LIKE') {
    return form.collation.trim() === original.collation.trim();
  }
  return (
    form.charset.trim() === original.charset.trim() &&
    form.collation.trim() === original.collation.trim()
  );
});

watch(
  () => form.charset,
  (charset) => {
    if (hydrating || !mysql.value) return;
    const list = MYSQL_COLLATIONS[charset || ''] || [];
    if (list.length && !list.includes(form.collation)) {
      form.collation = list[0] || '';
    }
  },
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) void loadCurrent();
  },
  { immediate: true },
);

/** 打开弹窗时读取当前库的字符集和排序规则，作为表单初值。 */
async function loadCurrent() {
  form.charset = '';
  form.collation = '';
  original.charset = '';
  original.collation = '';
  if (!supported.value || !props.databaseName || !props.dbConfigId) return;
  const sql = buildDatabaseCharsetQuery(props.dbType, props.databaseName);
  if (!sql) return;
  loading.value = true;
  try {
    const res: any = await executeSql({
      dbConfigId: props.dbConfigId,
      instanceName: props.databaseName,
      sql,
      maxRows: 1,
    });
    const row = (res?.data || res)?.rows?.[0];
    const current = readCharsetRow(props.dbType, row);
    // 字符集监听是异步刷新的。先写完两个字段并等它跑过，再结束 hydrating，
    // 否则会把库上已有的排序规则改成该字符集的第一项。
    hydrating = true;
    original.charset = current.charset;
    original.collation = current.collation;
    form.charset = current.charset || (mysql.value ? 'utf8mb4' : '');
    form.collation =
      current.collation || (mysql.value ? 'utf8mb4_general_ci' : '');
    await nextTick();
  } catch (error: any) {
    ElMessage.warning(error?.msg || error?.message || '读取当前字符集失败，请手动选择');
    if (mysql.value) {
      hydrating = true;
      form.charset = 'utf8mb4';
      form.collation = 'utf8mb4_general_ci';
      await nextTick();
    }
  } finally {
    hydrating = false;
    loading.value = false;
  }
}

async function onSubmit() {
  if (!supported.value) {
    ElMessage.warning('当前数据库类型不支持修改字符集或排序规则');
    return;
  }
  if (!props.databaseName.trim()) {
    ElMessage.warning('请先选择数据库');
    return;
  }
  if (tokenError.value) {
    ElMessage.warning(tokenError.value);
    return;
  }
  if (!sqlPreview.value) {
    ElMessage.warning(mysql.value ? '请选择字符集或排序规则' : '请选择排序规则');
    return;
  }
  if (unchanged.value) {
    ElMessage.warning(
      mysql.value ? '字符集和排序规则没有变化' : '排序规则没有变化',
    );
    return;
  }
  submitting.value = true;
  try {
    await executeDdl({
      dbConfigId: props.dbConfigId,
      instanceName: alterDatabaseExecuteInstance(props.dbType, props.databaseName),
      sql: sqlPreview.value,
    });
    ElMessage.success(
      mysql.value
        ? `已修改数据库「${props.databaseName}」的字符集和排序规则`
        : `已修改数据库「${props.databaseName}」的排序规则`,
    );
    visible.value = false;
    emit('updated', props.databaseName);
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '修改失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('改变数据库')"
    width="640px"
    destroy-on-close
    append-to-body
  >
    <ElAlert
      v-if="!supported"
      type="info"
      :closable="false"
      show-icon
      :title="$tr('当前数据库类型不支持修改字符集或排序规则')"
      class="mb"
    />
    <ElForm v-else v-loading="loading" label-width="120px" @submit.prevent>
      <ElFormItem :label="$tr('数据库名')">
        <ElInput :model-value="databaseName" disabled />
      </ElFormItem>
      <template v-if="mysql">
        <ElFormItem :label="$tr('字符集')">
          <ElSelect v-model="form.charset" filterable allow-create class="w-full">
            <ElOption
              v-for="item in charsetOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="$tr('排序规则')">
          <ElSelect
            v-model="form.collation"
            filterable
            allow-create
            clearable
            class="w-full"
          >
            <ElOption
              v-for="item in collationOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </ElSelect>
        </ElFormItem>
        <div class="tip block">
          {{
            $tr(
              '只修改该库以后新建对象的默认字符集和排序规则，已有表和字段不会自动转换。',
            )
          }}
        </div>
      </template>
      <template v-else>
        <ElFormItem :label="$tr('排序规则')">
          <ElSelect
            v-model="form.collation"
            filterable
            allow-create
            class="w-full"
          >
            <ElOption
              v-for="item in collationOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </ElSelect>
        </ElFormItem>
        <div class="tip block">
          {{
            $tr(
              'SQL Server 没有单独的库字符集，这里修改默认排序规则。已有列不会自动转换，并且修改时不能有其它会话正在使用该库。',
            )
          }}
        </div>
      </template>
      <ElAlert
        v-if="tokenError"
        type="warning"
        :closable="false"
        show-icon
        :title="tokenError"
        class="mb"
      />
      <ElFormItem v-if="sqlPreview" :label="$tr('SQL 预览')">
        <pre class="sql-preview">{{ sqlPreview }}</pre>
      </ElFormItem>
      <div v-else-if="loading" class="tip block">
        {{ $tr('正在读取当前字符集和排序规则') }}
      </div>
    </ElForm>
    <template #footer>
      <ElButton @click="visible = false">{{ $tr('取消') }}</ElButton>
      <ElButton
        type="primary"
        :loading="submitting"
        :disabled="!supported || loading || !!tokenError || !sqlPreview"
        @click="onSubmit"
      >
        {{ $tr('确定修改') }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.w-full {
  width: 100%;
}

.mb {
  margin-bottom: 12px;
}

.tip {
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}

.tip.block {
  margin: 0 0 12px 120px;
  line-height: 1.5;
}

.sql-preview {
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--vc-ui-font-size-sm, 12px);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  color: var(--el-text-color-primary);
}
</style>
