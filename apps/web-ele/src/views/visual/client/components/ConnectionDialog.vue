<script lang="ts" setup>
/**
 * 连接弹窗
 * - create：新建连接表单
 * - open：已有连接列表，支持打开 / 编辑 / 测试
 *
 * 表单按 dbTypes.ts 的产品档案动态渲染：文件型库不显示主机端口，
 * 切换类型自动带出默认端口，URL 预览与服务端 DbTypeProfile 同源。
 *
 * @author yanch
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import {
  getDbTypeProfiles,
  previewJdbcUrl,
  testConnection,
  testConnectionDraft,
} from '#/api/visual/database';
import { editDbConfig, getDbConfigById, getDbConfigList } from '#/api/visual/vq';

import {
  applyServerProfiles,
  buildJdbcUrl,
  DB_TYPE_REGISTRY,
  type DbTypeDescriptor,
  resolveDbType,
} from '../dialect/dbTypes';

defineOptions({ name: 'ConnectionDialog' });

const props = defineProps<{
  modelValue: boolean;
  mode?: 'create' | 'open';
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  created: [any];
  opened: [any];
  /** 编辑保存后通知父级同步已打开连接的显示信息 */
  updated: [any];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isOpenMode = computed(() => props.mode === 'open');
/** open 模式下：list 选连接，form 编辑选中连接 */
const openView = ref<'list' | 'form'>('list');

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const formRef = ref();
const existingList = ref<any[]>([]);
const selectedId = ref<number | string>();
const selectedRow = ref<any>(null);
/** 服务端档案是否已拉取，用于展示驱动缺失提示 */
const profilesLoaded = ref(false);
/**
 * 表单回填/重置期间抑制端口自动跟随，避免冲掉已保存连接的端口。
 * dbType 的 watch 是 pre-flush，会先于 nextTick 执行，故此处用 nextTick 复位。
 */
let syncingForm = false;
function beginFormSync() {
  syncingForm = true;
  nextTick(() => {
    syncingForm = false;
  });
}

const form = reactive({
  id: undefined as number | string | undefined,
  dbName: '',
  schemaName: '',
  dbType: 'MY_SQL',
  dbHost: '',
  dbPort: 3306,
  jdbcUrl: '',
  username: '',
  password: '',
  description: '',
  orderNum: 0,
  sshEnabled: 0,
  sshHost: '',
  sshPort: 22,
  sshUsername: '',
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
  /** 该连接是否允许 AI 助手（默认开） */
  aiEnabled: 1,
  /** 是否允许 AI 读取真实样例行（默认关） */
  aiAllowSampleData: 0,
});

/** SSH 认证方式：password | key */
const sshAuthMode = ref<'password' | 'key'>('password');
const sshEnabled = computed({
  get: () => form.sshEnabled === 1,
  set: (v: boolean) => {
    form.sshEnabled = v ? 1 : 0;
  },
});
const aiEnabled = computed({
  get: () => form.aiEnabled === 1,
  set: (v: boolean) => {
    form.aiEnabled = v ? 1 : 0;
  },
});
const aiAllowSampleData = computed({
  get: () => form.aiAllowSampleData === 1,
  set: (v: boolean) => {
    form.aiAllowSampleData = v ? 1 : 0;
  },
});

const descriptor = computed<DbTypeDescriptor>(() => resolveDbType(form.dbType));
/** 文件型（SQLite / H2 嵌入式）：无主机端口，库名即文件路径 */
const isFileForm = computed(() => descriptor.value.connectionForm === 'FILE');
const needsHost = computed(() => !isFileForm.value);
const credentialRequired = computed(() => descriptor.value.credentialRequired);
const isSchemaKind = computed(() => descriptor.value.instanceKind === 'SCHEMA');

/** 默认库/模式字段的标签随产品变化，避免 Oracle 下写「默认数据库」误导 */
const schemaLabel = computed(() => {
  if (isFileForm.value) return '数据库文件';
  return isSchemaKind.value ? '默认模式' : '默认数据库';
});

const schemaPlaceholder = computed(() => {
  const d = descriptor.value;
  if (isFileForm.value) return d.fileExample || '数据库文件绝对路径';
  return d.maintenanceDatabase
    ? `留空则连接 ${d.maintenanceDatabase}`
    : '默认连接的库名';
});

/** 驱动未部署时给出可执行的提示，而不是等到测试连接才报 ClassNotFound */
const driverWarning = computed(() => {
  const d = descriptor.value;
  if (!profilesLoaded.value || d.driverAvailable !== false) return '';
  return d.driverHint || `服务端未部署 ${d.label} 驱动（${d.driverClassName}）`;
});

/** 未手填 jdbcUrl 时，展示按模板拼出的 URL */
const urlPreview = computed(() => {
  if (form.jdbcUrl?.trim()) return form.jdbcUrl.trim();
  return buildJdbcUrl(form.dbType, {
    host: form.dbHost,
    port: form.dbPort,
    database: form.schemaName,
  });
});

/** 按方言族分组的下拉项，便于在十几种产品里快速定位 */
const FAMILY_GROUP_LABEL: Record<string, string> = {
  MYSQL_LIKE: 'MySQL 及兼容',
  POSTGRES_LIKE: 'PostgreSQL 及兼容（含高斯/金仓/瀚高）',
  ORACLE_LIKE: 'Oracle 及兼容（含达梦）',
  SQLSERVER_LIKE: 'SQL Server',
  SQLITE_LIKE: '嵌入式 - SQLite',
  H2_LIKE: '嵌入式 - H2',
};

const dbTypeGroups = computed(() => {
  const groups = new Map<string, DbTypeDescriptor[]>();
  for (const d of Object.values(DB_TYPE_REGISTRY)) {
    const list = groups.get(d.family) || [];
    list.push(d);
    groups.set(d.family, list);
  }
  return [...groups.entries()].map(([family, items]) => ({
    family,
    label: FAMILY_GROUP_LABEL[family] || family,
    items,
  }));
});

const rules = computed(() => ({
  dbName: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  schemaName: [
    {
      required: isFileForm.value,
      message: '请输入数据库文件路径',
      trigger: 'blur',
    },
  ],
  dbType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  dbHost: [
    { required: needsHost.value, message: '请输入主机', trigger: 'blur' },
  ],
  dbPort: [
    { required: needsHost.value, message: '请输入端口', trigger: 'blur' },
  ],
  username: [
    {
      required: credentialRequired.value,
      message: '请输入用户名',
      trigger: 'blur',
    },
  ],
  password: [
    {
      required: credentialRequired.value,
      message: '请输入密码',
      trigger: 'blur',
    },
  ],
  sshHost: [
    {
      validator: (_r: unknown, v: string, cb: (e?: Error) => void) => {
        if (sshEnabled.value && needsHost.value && !v?.trim()) {
          cb(new Error('请输入 SSH 主机'));
        } else cb();
      },
      trigger: 'blur',
    },
  ],
  sshUsername: [
    {
      validator: (_r: unknown, v: string, cb: (e?: Error) => void) => {
        if (sshEnabled.value && !v?.trim()) cb(new Error('请输入 SSH 用户名'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
}));

const dialogTitle = computed(() => {
  if (props.mode === 'create') return '新建连接';
  if (openView.value === 'form') return '编辑连接';
  return '打开连接';
});

function resetForm() {
  beginFormSync();
  Object.assign(form, {
    id: undefined,
    dbName: '',
    schemaName: '',
    dbType: 'MY_SQL',
    dbHost: '',
    dbPort: DB_TYPE_REGISTRY.MY_SQL?.defaultPort ?? 3306,
    jdbcUrl: '',
    username: '',
    password: '',
    description: '',
    orderNum: 0,
    sshEnabled: 0,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    aiEnabled: 1,
    aiAllowSampleData: 0,
  });
  sshAuthMode.value = 'password';
}

function fillForm(row: any) {
  beginFormSync();
  Object.assign(form, {
    id: row.id,
    dbName: row.dbName || '',
    schemaName: row.schemaName || '',
    dbType: row.dbType || 'MY_SQL',
    dbHost: row.dbHost || '',
    dbPort:
      row.dbPort == null
        ? resolveDbType(row.dbType).defaultPort
        : Number(row.dbPort),
    jdbcUrl: row.jdbcUrl || '',
    username: row.username || '',
    password: row.password || '',
    description: row.description || '',
    orderNum: row.orderNum == null ? 0 : Number(row.orderNum),
    sshEnabled: row.sshEnabled == null ? 0 : Number(row.sshEnabled),
    sshHost: row.sshHost || '',
    sshPort: row.sshPort == null ? 22 : Number(row.sshPort),
    sshUsername: row.sshUsername || '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    aiEnabled: row.aiEnabled == null ? 1 : Number(row.aiEnabled),
    aiAllowSampleData:
      row.aiAllowSampleData == null ? 0 : Number(row.aiAllowSampleData),
  });
  sshAuthMode.value = row.sshPrivateKey ? 'key' : 'password';
}

/**
 * 切换产品：端口跟随默认值。
 * 只在端口仍是「上一个产品的默认值」或为空时覆盖，避免冲掉用户手填的端口。
 */
function onDbTypeChange(next: string, previous?: string) {
  if (syncingForm) return;
  const nextProfile = resolveDbType(next);
  const prevDefault = previous ? resolveDbType(previous).defaultPort : null;
  const untouched =
    !form.dbPort || form.dbPort === 0 || form.dbPort === prevDefault;
  if (untouched) {
    form.dbPort = nextProfile.defaultPort;
  }
  if (nextProfile.connectionForm === 'FILE') {
    form.dbHost = '';
  }
  formRef.value?.clearValidate?.(['dbHost', 'dbPort', 'username', 'password']);
}

/** 拉取服务端档案，回填驱动可用性 / URL 模板 */
async function loadProfiles() {
  try {
    const res: any = await getDbTypeProfiles();
    const list = res?.data || res || [];
    if (Array.isArray(list) && list.length > 0) {
      applyServerProfiles(list);
      profilesLoaded.value = true;
    }
  } catch {
    // 服务端不可用时退回本地注册表，连接表单仍可使用
    profilesLoaded.value = false;
  }
}

async function loadList() {
  loading.value = true;
  try {
    const res: any = await getDbConfigList({});
    const list = res?.data || res?.list || res || [];
    existingList.value = Array.isArray(list) ? list : [];
  } finally {
    loading.value = false;
  }
}

function onCurrentChange(row: any) {
  selectedRow.value = row || null;
  selectedId.value = row?.id;
}

/** 双击行：直接打开连接（与底部「打开」一致） */
function openByRow(row: any) {
  if (!row?.id) {
    ElMessage.warning('请选择一个连接');
    return;
  }
  selectedRow.value = row;
  selectedId.value = row.id;
  emit('opened', row);
  visible.value = false;
}

/** 进入编辑：优先拉详情（含密码等完整字段） */
async function startEdit(row?: any) {
  const target = row || selectedRow.value;
  if (!target?.id) {
    ElMessage.warning('请先选择要编辑的连接');
    return;
  }
  loading.value = true;
  try {
    let detail = target;
    try {
      const res: any = await getDbConfigById({ id: target.id });
      detail = res?.data || res || target;
    } catch {
      // 详情失败时用列表行数据兜底
      detail = target;
    }
    fillForm(detail);
    selectedId.value = target.id;
    selectedRow.value = target;
    openView.value = 'form';
  } finally {
    loading.value = false;
  }
}

/** 编辑态返回列表，不关闭弹窗 */
function backToList() {
  openView.value = 'list';
  resetForm();
}

async function handleSubmit() {
  // 打开模式且在列表：打开选中连接
  if (isOpenMode.value && openView.value === 'list') {
    const row = existingList.value.find((r) => r.id === selectedId.value);
    if (!row) {
      ElMessage.warning('请选择一个连接');
      return;
    }
    emit('opened', row);
    visible.value = false;
    return;
  }

  // 新建 / 编辑保存
  await formRef.value?.validate(async (valid: boolean) => {
    if (!valid) return;
    saving.value = true;
    try {
      const payload: Record<string, unknown> = { ...form };
      if (form.id && !form.password) delete payload.password;
      if (form.id && !form.sshPassword) delete payload.sshPassword;
      if (form.id && !form.sshPrivateKey) delete payload.sshPrivateKey;
      if (form.id && !form.sshPassphrase) delete payload.sshPassphrase;
      if (sshAuthMode.value === 'password') {
        payload.sshPrivateKey = '';
      } else if (form.id) {
        payload.sshPassword = '';
      } else {
        payload.sshPassword = '';
      }
      await editDbConfig(payload);
      ElMessage.success(form.id ? '保存成功' : '创建成功');
      await loadList();
      const saved = existingList.value.find((r) => r.id === form.id) ||
        existingList.value.find((r) => r.dbName === form.dbName) || {
          ...form,
        };

      if (isOpenMode.value && form.id) {
        // 编辑后回到列表，并通知父级刷新已打开连接信息
        emit('updated', saved);
        openView.value = 'list';
        selectedId.value = saved.id;
        selectedRow.value =
          existingList.value.find((r) => r.id === saved.id) || saved;
        return;
      }

      emit('created', saved);
      visible.value = false;
    } catch (error: any) {
      ElMessage.error(error?.msg || error?.message || '保存失败');
    } finally {
      saving.value = false;
    }
  });
}

/**
 * 测试连接。
 * 列表态测已保存连接；表单态直接用当前录入内容测试草稿，无需先保存。
 */
async function handleTest() {
  if (isOpenMode.value && openView.value === 'list') {
    if (!selectedId.value) {
      ElMessage.info('请先选择连接');
      return;
    }
    await runTest(() => testConnection(selectedId.value as number | string));
    return;
  }
  await runTest(() =>
    testConnectionDraft({
      id: form.id,
      dbType: form.dbType,
      dbHost: form.dbHost,
      dbPort: form.dbPort,
      schemaName: form.schemaName,
      jdbcUrl: form.jdbcUrl,
      username: form.username,
      password: form.password,
      sshEnabled: form.sshEnabled,
      sshHost: form.sshHost,
      sshPort: form.sshPort,
      sshUsername: form.sshUsername,
      sshPassword: sshAuthMode.value === 'password' ? form.sshPassword : '',
      sshPrivateKey: sshAuthMode.value === 'key' ? form.sshPrivateKey : '',
      sshPassphrase: form.sshPassphrase,
      aiEnabled: form.aiEnabled,
      aiAllowSampleData: form.aiAllowSampleData,
    }),
  );
}

async function runTest(invoke: () => Promise<any>) {
  testing.value = true;
  try {
    const res: any = await invoke();
    const data = res?.data ?? res;
    if (data?.success) {
      ElMessage.success(data?.message || '连接成功');
    } else {
      ElMessage.error(data?.message || '连接失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '连接失败');
  } finally {
    testing.value = false;
  }
}

/** 用服务端拼好的 URL 填入输入框，便于用户在此基础上加参数 */
async function fillUrlFromServer() {
  try {
    const res: any = await previewJdbcUrl({
      dbType: form.dbType,
      dbHost: form.dbHost,
      dbPort: form.dbPort,
      schemaName: form.schemaName,
      jdbcUrl: form.jdbcUrl,
    });
    const url = res?.data?.jdbcUrl ?? res?.data ?? res?.jdbcUrl;
    if (typeof url === 'string' && url) {
      form.jdbcUrl = url;
      return;
    }
    form.jdbcUrl = urlPreview.value;
  } catch {
    // 服务端不可用时用本地模板兜底
    form.jdbcUrl = urlPreview.value;
  }
}

function handleCancel() {
  if (isOpenMode.value && openView.value === 'form') {
    backToList();
    return;
  }
  visible.value = false;
}

watch(
  () => form.dbType,
  (next, previous) => onDbTypeChange(next, previous),
);

watch(
  () => props.modelValue,
  async (val) => {
    if (!val) return;
    openView.value = 'list';
    selectedId.value = undefined;
    selectedRow.value = null;
    resetForm();
    await loadProfiles();
    if (isOpenMode.value) await loadList();
  },
);
</script>

<template>
  <ElDialog v-model="visible" :title="dialogTitle" width="720px" destroy-on-close>
    <!-- 打开连接：列表 -->
    <div v-if="isOpenMode && openView === 'list'" v-loading="loading">
      <ElTable
        :data="existingList"
        highlight-current-row
        height="360"
        @current-change="onCurrentChange"
        @row-dblclick="(row: any) => openByRow(row)"
      >
        <ElTableColumn prop="dbName" label="名称" min-width="120" />
        <ElTableColumn label="类型" width="150">
          <template #default="{ row }">
            {{ resolveDbType(row.dbType).label }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="dbHost" label="主机" min-width="120" />
        <ElTableColumn prop="schemaName" label="默认库" min-width="100" />
        <ElTableColumn label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" @click.stop="startEdit(row)">
              编辑
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="hint">提示：双击行即可打开连接；编辑请点「编辑」按钮</div>
    </div>

    <!-- 新建 / 编辑表单 -->
    <ElForm
      v-else
      ref="formRef"
      v-loading="loading"
      :model="form"
      :rules="rules"
      label-width="120px"
    >
      <ElFormItem label="连接名称" prop="dbName">
        <ElInput v-model="form.dbName" placeholder="显示名称" />
      </ElFormItem>
      <ElFormItem label="数据库类型" prop="dbType">
        <ElSelect v-model="form.dbType" class="w-full" filterable>
          <ElOptionGroup
            v-for="group in dbTypeGroups"
            :key="group.family"
            :label="group.label"
          >
            <ElOption
              v-for="item in group.items"
              :key="item.code"
              :label="item.label"
              :value="item.code"
            />
          </ElOptionGroup>
        </ElSelect>
        <div v-if="driverWarning" class="warn">{{ driverWarning }}</div>
      </ElFormItem>
      <ElFormItem :label="schemaLabel" prop="schemaName">
        <ElInput v-model="form.schemaName" :placeholder="schemaPlaceholder" />
      </ElFormItem>
      <template v-if="needsHost">
        <ElFormItem label="主机" prop="dbHost">
          <ElInput v-model="form.dbHost" placeholder="127.0.0.1" />
        </ElFormItem>
        <ElFormItem label="端口" prop="dbPort">
          <ElInputNumber
            v-model="form.dbPort"
            :min="1"
            :max="65535"
            controls-position="right"
          />
          <span class="tip">默认 {{ descriptor.defaultPort }}</span>
        </ElFormItem>
      </template>
      <ElFormItem label="JDBC URL" prop="jdbcUrl">
        <div class="url-row">
          <ElInput
            v-model="form.jdbcUrl"
            placeholder="留空按类型自动生成，填写后优先使用"
          />
          <ElButton @click="fillUrlFromServer">按当前配置生成</ElButton>
        </div>
        <div class="tip preview">实际使用：{{ urlPreview }}</div>
      </ElFormItem>
      <ElFormItem label="用户名" prop="username">
        <ElInput
          v-model="form.username"
          :placeholder="credentialRequired ? '' : '可留空'"
        />
      </ElFormItem>
      <ElFormItem label="密码" prop="password">
        <ElInput
          v-model="form.password"
          type="password"
          show-password
          :placeholder="credentialRequired ? '' : '可留空'"
        />
      </ElFormItem>

      <template v-if="needsHost">
        <ElDivider content-position="left">SSH 隧道（可选）</ElDivider>
        <ElFormItem label="启用 SSH">
          <ElSwitch v-model="sshEnabled" />
          <span class="tip">经跳板机转发到上方数据库主机</span>
        </ElFormItem>
        <template v-if="sshEnabled">
          <ElFormItem label="SSH 主机" prop="sshHost">
            <ElInput v-model="form.sshHost" placeholder="跳板机 IP 或域名" />
          </ElFormItem>
          <ElFormItem label="SSH 端口" prop="sshPort">
            <ElInputNumber
              v-model="form.sshPort"
              :min="1"
              :max="65535"
              controls-position="right"
            />
          </ElFormItem>
          <ElFormItem label="SSH 用户" prop="sshUsername">
            <ElInput v-model="form.sshUsername" />
          </ElFormItem>
          <ElFormItem label="SSH 认证">
            <ElRadioGroup v-model="sshAuthMode">
              <ElRadio value="password">密码</ElRadio>
              <ElRadio value="key">私钥</ElRadio>
            </ElRadioGroup>
          </ElFormItem>
          <ElFormItem v-if="sshAuthMode === 'password'" label="SSH 密码">
            <ElInput
              v-model="form.sshPassword"
              type="password"
              show-password
              :placeholder="form.id ? '留空则沿用已保存' : ''"
            />
          </ElFormItem>
          <template v-else>
            <ElFormItem label="SSH 私钥">
              <ElInput
                v-model="form.sshPrivateKey"
                type="textarea"
                :rows="4"
                placeholder="粘贴 PEM 私钥；留空则沿用已保存"
              />
            </ElFormItem>
            <ElFormItem label="私钥口令">
              <ElInput
                v-model="form.sshPassphrase"
                type="password"
                show-password
                placeholder="可选"
              />
            </ElFormItem>
          </template>
        </template>
      </template>

      <ElDivider content-position="left">AI 助手</ElDivider>
      <ElFormItem label="启用 AI">
        <ElSwitch v-model="aiEnabled" />
        <span class="tip">关闭后该连接不可唤出 AI 助手</span>
      </ElFormItem>
      <ElFormItem label="允许样例数据">
        <ElSwitch v-model="aiAllowSampleData" />
        <span class="tip">开启后 Agent 可读取少量真实行（默认关闭）</span>
      </ElFormItem>

      <ElFormItem label="描述" prop="description">
        <ElInput v-model="form.description" type="textarea" :rows="2" />
      </ElFormItem>
    </ElForm>

    <template #footer>
      <ElButton @click="handleCancel">
        {{ isOpenMode && openView === 'form' ? '返回列表' : '取消' }}
      </ElButton>
      <ElButton
        v-if="isOpenMode && openView === 'list'"
        :disabled="!selectedId"
        @click="startEdit()"
      >
        编辑
      </ElButton>
      <ElButton :loading="testing" @click="handleTest">测试连接</ElButton>
      <ElButton type="primary" :loading="saving" @click="handleSubmit">
        <template v-if="isOpenMode && openView === 'list'">打开</template>
        <template v-else-if="form.id">保存</template>
        <template v-else>保存并打开</template>
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.hint {
  margin-top: 8px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}

.tip {
  margin-left: 8px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}

.preview {
  width: 100%;
  margin-left: 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.warn {
  width: 100%;
  font-size: var(--vc-ui-font-size-sm, 12px);
  line-height: 1.5;
  color: var(--el-color-warning);
}

.url-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.w-full {
  width: 100%;
}
</style>
