<script lang="ts" setup>
/**
 * 使用服务端官方客户端导入 SQL / 备份文件。
 * SQL 脚本仍可走逐条权限校验的执行入口；这里专门处理原生备份和批量导入。
 */
import { computed, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import type { UploadRawFile } from 'element-plus';

import {
  startNativeDatabaseImport,
} from '#/api/visual/databaseTool';
import type { SqlScriptTaskVO } from '#/api/visual/sqlScript';

defineOptions({ name: 'NativeImportDialog' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string;
  dbType?: string;
  instanceName: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  started: [task: SqlScriptTaskVO];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const submitting = ref(false);
const form = reactive({
  file: null as File | null,
  collectionName: '',
  dropExisting: false,
});

const isMongo = computed(() => props.dbType === 'MONGODB');
const isSqlServer = computed(() => props.dbType === 'SQL_SERVER');

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    form.file = null;
    form.collectionName = '';
    form.dropExisting = false;
  },
);

function onFileChange(file: { raw?: File } | undefined) {
  form.file = file?.raw || null;
}

function onFileRemove() {
  form.file = null;
}

function onExceed(files: UploadRawFile[]) {
  form.file = files?.[0] || null;
}

function acceptForDb() {
  if (isMongo.value) return '.archive,.bson,.json,.csv,.gz';
  if (isSqlServer.value) return '.sql,.txt,.csv';
  return '.sql,.txt,.dump,.backup,.tar,.gz';
}

function supportedFileHint() {
  if (isMongo.value) return '支持 MongoDB archive、BSON、JSON、CSV 或 GZ 文件';
  if (isSqlServer.value) return '支持 SQL 脚本；CSV 可通过 bcp 导入到指定表';
  return '支持 SQL 脚本以及当前数据库官方客户端认可的备份格式';
}

async function onSubmit() {
  if (!props.dbConfigId) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  if (!props.instanceName) {
    ElMessage.warning('请先选择数据库实例');
    return;
  }
  if (!form.file) {
    ElMessage.warning('请选择备份文件');
    return;
  }
  if (isMongo.value && form.file.name.toLowerCase().endsWith('.json') && !form.collectionName.trim()) {
    ElMessage.warning('导入 MongoDB JSON 时请填写目标集合');
    return;
  }
  if (isSqlServer.value && form.file.name.toLowerCase().endsWith('.csv') && !form.collectionName.trim()) {
    ElMessage.warning('导入 SQL Server CSV 时请填写目标表');
    return;
  }

  const data = new FormData();
  data.append('dbConfigId', String(props.dbConfigId));
  data.append('instanceName', props.instanceName);
  data.append('file', form.file);
  if (form.collectionName.trim()) data.append('collectionName', form.collectionName.trim());
  data.append('dropExisting', form.dropExisting ? 'true' : 'false');

  submitting.value = true;
  try {
    const res: any = await startNativeDatabaseImport(data);
    const task = (res?.data || res) as SqlScriptTaskVO;
    if (!task?.taskId) {
      ElMessage.error('任务创建失败');
      return;
    }
    ElMessage.success(`已提交官方客户端导入：${form.file.name}`);
    visible.value = false;
    emit('started', task);
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '官方客户端导入失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    title="官方客户端导入"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <ElAlert
      type="info"
      :closable="false"
      show-icon
      title="导入任务在服务端执行，客户端必须已在“客户端工具”中测试可用。"
      class="mb-3"
    />
    <ElForm label-width="108px" @submit.prevent>
      <ElFormItem label="目标实例">
        <ElInput :model-value="instanceName" disabled />
      </ElFormItem>
      <ElFormItem label="备份文件" required>
        <ElUpload
          :auto-upload="false"
          :limit="1"
          :accept="acceptForDb()"
          :on-change="onFileChange"
          :on-remove="onFileRemove"
          :on-exceed="onExceed"
        >
          <ElButton>选择文件</ElButton>
          <template #tip>
            <div class="tip">{{ supportedFileHint() }}</div>
          </template>
        </ElUpload>
      </ElFormItem>
      <ElFormItem v-if="isMongo || isSqlServer" :label="isMongo ? '目标集合' : '目标表'">
        <ElInput
          v-model="form.collectionName"
          clearable
          :placeholder="isMongo ? 'JSON / CSV 导入时必填' : 'CSV 导入时必填'"
        />
      </ElFormItem>
      <ElFormItem v-if="isMongo" label="覆盖已有数据">
        <ElSwitch v-model="form.dropExisting" />
        <span class="tip inline">使用官方工具的 drop 选项</span>
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" :loading="submitting" @click="onSubmit">
        开始导入
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.mb-3 {
  margin-bottom: 12px;
}
.tip {
  margin-top: 4px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
.tip.inline {
  margin-top: 0;
  margin-left: 8px;
}
</style>
