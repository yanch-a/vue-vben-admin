<script lang="ts" setup>
/**
 * 按方言族渲染的「创建数据库 / Schema / 用户」对话框。
 * 选项齐全后点确定直接执行 DDL，不再只生成到编辑器。
 *
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import { executeDdl } from '#/api/visual/database';

import {
  buildCreateDatabaseStatements,
  createDatabaseMeta,
  defaultCreateDatabaseForm,
  MYSQL_CHARSETS,
  MYSQL_COLLATIONS,
  PG_ENCODINGS,
  PG_TEMPLATES,
  SQLSERVER_COLLATIONS,
  type CreateDatabaseForm,
} from '../dialect/createDatabase';
import { resolveDialectFamily, type SqlDialectFamily } from '../dialect/dbTypes';

defineOptions({ name: 'CreateDatabaseDialog' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId: number | string;
  dbType: string;
  /**
   * 执行 DDL 时连到的已有实例（维护库 / 当前库）。
   * PG 建库须连已有库；勿传即将创建的新库名。
   */
  connectInstance: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  /** 创建成功，payload 为新实例名 */
  created: [instanceName: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const submitting = ref(false);
const form = reactive<CreateDatabaseForm>(defaultCreateDatabaseForm('MYSQL_LIKE'));

const family = computed<SqlDialectFamily>(() =>
  resolveDialectFamily(props.dbType),
);

const meta = computed(() => createDatabaseMeta(family.value));

const statements = computed(() =>
  buildCreateDatabaseStatements(family.value, form),
);

const sqlPreview = computed(() => {
  const main = statements.value.sql?.trim() || '';
  const follow = (statements.value.followUps || []).join(';\n');
  if (!main && !follow) return '';
  return follow ? `${main}\n${follow};` : main;
});

const collationOptions = computed(() => {
  const cs = form.charset || 'utf8mb4';
  return MYSQL_COLLATIONS[cs] || MYSQL_COLLATIONS.utf8mb4 || [];
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    Object.assign(form, defaultCreateDatabaseForm(family.value));
  },
);

watch(
  () => form.charset,
  (cs) => {
    if (family.value !== 'MYSQL_LIKE') return;
    const list = MYSQL_COLLATIONS[cs || ''] || [];
    if (list.length && !list.includes(form.collation || '')) {
      form.collation = list[0];
    }
  },
);

async function onSubmit() {
  if (meta.value.unsupportedHint) {
    ElMessage.warning(meta.value.unsupportedHint);
    return;
  }
  const name = form.name.trim();
  if (!name) {
    ElMessage.warning(`请输入${meta.value.nameLabel}`);
    return;
  }
  if (family.value === 'ORACLE_LIKE' && !form.password?.trim()) {
    ElMessage.warning('请输入用户密码');
    return;
  }
  if (!props.connectInstance) {
    ElMessage.warning('缺少可用的连接实例，请先在对象树选中一个库');
    return;
  }
  const built = buildCreateDatabaseStatements(family.value, form);
  if (!built.sql?.trim()) {
    ElMessage.warning('无法生成建库语句，请检查输入');
    return;
  }

  submitting.value = true;
  try {
    await executeDdl({
      dbConfigId: props.dbConfigId,
      instanceName: props.connectInstance,
      sql: built.sql,
    });
    for (const follow of built.followUps || []) {
      await executeDdl({
        dbConfigId: props.dbConfigId,
        instanceName: props.connectInstance,
        sql: follow,
      });
    }
    ElMessage.success(`${meta.value.title}成功：${name}`);
    visible.value = false;
    emit('created', name);
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '创建失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="meta.title"
    width="640px"
    destroy-on-close
    append-to-body
  >
    <ElAlert
      v-if="meta.unsupportedHint"
      type="info"
      :closable="false"
      show-icon
      :title="meta.unsupportedHint"
      class="mb"
    />

    <ElForm v-else label-width="120px" @submit.prevent>
      <ElFormItem :label="meta.nameLabel" required>
        <ElInput
          v-model="form.name"
          clearable
          :placeholder="`请输入${meta.nameLabel}`"
        />
      </ElFormItem>

      <!-- MySQL 族 -->
      <template v-if="family === 'MYSQL_LIKE'">
        <ElFormItem label="字符集">
          <ElSelect v-model="form.charset" filterable allow-create class="w-full">
            <ElOption
              v-for="c in MYSQL_CHARSETS"
              :key="c"
              :label="c"
              :value="c"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="排序规则">
          <ElSelect
            v-model="form.collation"
            filterable
            allow-create
            clearable
            class="w-full"
            placeholder="可选"
          >
            <ElOption
              v-for="c in collationOptions"
              :key="c"
              :label="c"
              :value="c"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="IF NOT EXISTS">
          <ElSwitch v-model="form.ifNotExists" />
        </ElFormItem>
      </template>

      <!-- PostgreSQL 族 -->
      <template v-else-if="family === 'POSTGRES_LIKE'">
        <ElFormItem label="Owner">
          <ElInput
            v-model="form.owner"
            clearable
            placeholder="留空则使用当前用户"
          />
        </ElFormItem>
        <ElFormItem label="Encoding">
          <ElSelect v-model="form.encoding" filterable allow-create class="w-full">
            <ElOption
              v-for="e in PG_ENCODINGS"
              :key="e"
              :label="e"
              :value="e"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="Template">
          <ElSelect v-model="form.template" clearable class="w-full">
            <ElOption
              v-for="t in PG_TEMPLATES"
              :key="t"
              :label="t"
              :value="t"
            />
          </ElSelect>
          <div class="tip">自定义 Encoding / Locale 时请用 template0</div>
        </ElFormItem>
        <ElFormItem label="LC_COLLATE">
          <ElInput
            v-model="form.lcCollate"
            clearable
            placeholder="如 C、en_US.UTF-8、zh_CN.UTF-8"
          />
        </ElFormItem>
        <ElFormItem label="LC_CTYPE">
          <ElInput
            v-model="form.lcCtype"
            clearable
            placeholder="如 C、en_US.UTF-8、zh_CN.UTF-8"
          />
        </ElFormItem>
        <ElFormItem label="Tablespace">
          <ElInput
            v-model="form.tablespace"
            clearable
            placeholder="留空使用默认表空间"
          />
        </ElFormItem>
        <ElFormItem label="连接数限制">
          <ElInputNumber
            v-model="form.connectionLimit"
            :min="-1"
            controls-position="right"
            clearable
          />
          <span class="tip">留空不限制；-1 也表示不限制</span>
        </ElFormItem>
      </template>

      <!-- Oracle / 达梦：创建用户 -->
      <template v-else-if="family === 'ORACLE_LIKE'">
        <ElFormItem label="密码" required>
          <ElInput
            v-model="form.password"
            type="password"
            show-password
            placeholder="新用户登录密码"
          />
        </ElFormItem>
        <ElFormItem label="默认表空间">
          <ElInput v-model="form.defaultTablespace" clearable placeholder="USERS" />
        </ElFormItem>
        <ElFormItem label="临时表空间">
          <ElInput
            v-model="form.temporaryTablespace"
            clearable
            placeholder="TEMP"
          />
        </ElFormItem>
        <ElFormItem label="配额">
          <ElSelect v-model="form.quota" filterable allow-create class="w-full">
            <ElOption label="UNLIMITED" value="UNLIMITED" />
            <ElOption label="100M" value="100M" />
            <ElOption label="500M" value="500M" />
            <ElOption label="1G" value="1G" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="授权">
          <ElCheckbox v-model="form.grantConnect">CONNECT</ElCheckbox>
          <ElCheckbox v-model="form.grantResource">RESOURCE</ElCheckbox>
        </ElFormItem>
        <div class="tip block">
          Oracle / 达梦的「库」对应为用户 Schema，需当前连接具备 CREATE USER 权限。
        </div>
      </template>

      <!-- SQL Server -->
      <template v-else-if="family === 'SQLSERVER_LIKE'">
        <ElFormItem label="排序规则">
          <ElSelect
            v-model="form.sqlServerCollation"
            filterable
            allow-create
            clearable
            class="w-full"
            placeholder="留空使用服务器默认"
          >
            <ElOption
              v-for="c in SQLSERVER_COLLATIONS"
              :key="c"
              :label="c"
              :value="c"
            />
          </ElSelect>
        </ElFormItem>
      </template>

      <!-- H2 -->
      <template v-else-if="family === 'H2_LIKE'">
        <ElFormItem label="AUTHORIZATION">
          <ElInput
            v-model="form.authorization"
            clearable
            placeholder="留空则当前用户"
          />
        </ElFormItem>
      </template>

      <ElFormItem v-if="sqlPreview" label="SQL 预览">
        <pre class="sql-preview">{{ sqlPreview }}</pre>
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton
        type="primary"
        :loading="submitting"
        :disabled="!!meta.unsupportedHint"
        @click="onSubmit"
      >
        确定创建
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
  margin-left: 8px;
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
