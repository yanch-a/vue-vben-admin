<script lang="ts" setup>
/**
 * 连接弹窗
 * - create：新建连接表单
 * - open：已有连接列表，支持打开 / 编辑 / 测试
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { editDbConfig, getDbConfigById, getDbConfigList, getVqDict } from '#/api/visual/vq';
import { testConnection } from '#/api/visual/database';

import { ElMessage } from 'element-plus';

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
const formRef = ref();
const dataBaseType = ref<any[]>([]);
const existingList = ref<any[]>([]);
const selectedId = ref<number | string>();
const selectedRow = ref<any>(null);

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
});

const rules = {
  dbName: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  schemaName: [{ required: true, message: '请输入默认数据库', trigger: 'blur' }],
  dbType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  dbHost: [{ required: true, message: '请输入主机', trigger: 'blur' }],
  dbPort: [{ required: true, message: '请输入端口', trigger: 'blur' }],
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

const dialogTitle = computed(() => {
  if (props.mode === 'create') return '新建连接';
  if (openView.value === 'form') return '编辑连接';
  return '打开连接';
});

function resetForm() {
  Object.assign(form, {
    id: undefined,
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
  });
}

function fillForm(row: any) {
  Object.assign(form, {
    id: row.id,
    dbName: row.dbName || '',
    schemaName: row.schemaName || '',
    dbType: row.dbType || 'MY_SQL',
    dbHost: row.dbHost || '',
    dbPort: row.dbPort != null ? Number(row.dbPort) : 3306,
    jdbcUrl: row.jdbcUrl || '',
    username: row.username || '',
    password: row.password || '',
    description: row.description || '',
    orderNum: row.orderNum != null ? Number(row.orderNum) : 0,
  });
}

async function loadDict() {
  try {
    const res: any = await getVqDict();
    dataBaseType.value = res?.data?.dataBaseType || res?.dataBaseType || [];
  } catch {
    dataBaseType.value = [
      { code: 'MY_SQL', label: 'MySQL' },
      { code: 'POSTGRE_SQL', label: 'PostgreSQL' },
      { code: 'ORACLE', label: 'Oracle' },
      { code: 'SQL_SERVER', label: 'SQL Server' },
    ];
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
      await editDbConfig({ ...form });
      ElMessage.success(form.id ? '保存成功' : '创建成功');
      await loadList();
      const saved =
        existingList.value.find((r) => r.id === form.id) ||
        existingList.value.find((r) => r.dbName === form.dbName) ||
        { ...form };

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
    } catch (e: any) {
      ElMessage.error(e?.msg || e?.message || '保存失败');
    } finally {
      saving.value = false;
    }
  });
}

async function handleTest() {
  const id = form.id || selectedId.value;
  if (!id) {
    ElMessage.info(
      isOpenMode.value && openView.value === 'list'
        ? '请先选择连接'
        : '请先保存连接后再测试',
    );
    return;
  }
  try {
    const res: any = await testConnection(id);
    const data = res?.data ?? res;
    if (data?.success) ElMessage.success('连接成功');
    else ElMessage.error(data?.message || '连接失败');
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '连接失败');
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
  () => props.modelValue,
  async (val) => {
    if (!val) return;
    openView.value = 'list';
    selectedId.value = undefined;
    selectedRow.value = null;
    resetForm();
    await loadDict();
    if (isOpenMode.value) await loadList();
  },
);
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="dialogTitle"
    width="720px"
    destroy-on-close
  >
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
        <ElTableColumn prop="dbType" label="类型" width="110" />
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
      <ElFormItem label="默认数据库" prop="schemaName">
        <ElInput v-model="form.schemaName" />
      </ElFormItem>
      <ElFormItem label="数据库类型" prop="dbType">
        <ElSelect v-model="form.dbType" class="w-full">
          <ElOption
            v-for="item in dataBaseType"
            :key="item.code"
            :label="item.label"
            :value="item.code"
          />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="主机" prop="dbHost">
        <ElInput v-model="form.dbHost" />
      </ElFormItem>
      <ElFormItem label="端口" prop="dbPort">
        <ElInputNumber v-model="form.dbPort" :min="1" :max="65535" />
      </ElFormItem>
      <ElFormItem label="JDBC URL" prop="jdbcUrl">
        <ElInput v-model="form.jdbcUrl" placeholder="可选，优先使用" />
      </ElFormItem>
      <ElFormItem label="用户名" prop="username">
        <ElInput v-model="form.username" />
      </ElFormItem>
      <ElFormItem label="密码" prop="password">
        <ElInput v-model="form.password" type="password" show-password />
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
      <ElButton @click="handleTest">测试连接</ElButton>
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
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.w-full {
  width: 100%;
}
</style>
