<script lang="ts" setup>
/**
 * 自动优先官方客户端导入，缺少工具时使用 Java；共用后台任务进度。
 * @author yanch
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
  engine: 'auto',
  charset: 'UTF-8',
  sourceDatabase: '',
});

const isMongo = computed(() => props.dbType === 'MONGODB');
const isDm = computed(() => props.dbType === 'DM');
const isSqlServer = computed(() => props.dbType === 'SQL_SERVER');

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    form.file = null;
    form.collectionName = '';
    form.dropExisting = false;
    form.engine = 'auto';
    form.charset = 'UTF-8';
    form.sourceDatabase = '';
  },
);

/** 上传控件仅保存浏览器文件句柄，提交时才发送文件。 */
function onFileChange(file: { raw?: File } | undefined) {
  form.file = file?.raw || null;
}

function onFileRemove() {
  form.file = null;
}

function onExceed(files: UploadRawFile[]) {
  form.file = files?.[0] || null;
}

/** 按数据库显示可识别的备份格式；解包后的真实格式由服务端校验。 */
function acceptForDb() {
  if (isMongo.value) return '.archive,.bson,.json,.csv,.gz,.zip,.js';
  if (isSqlServer.value) return '.sql,.txt,.csv,.zip,.gz';
  return '.sql,.txt,.dump,.dmp,.backup,.tar,.gz,.zip';
}

function supportedFileHint() {
  if (isMongo.value) return '支持 archive、BSON、JSON、CSV、JS 和仅含一个备份文件的 ZIP';
  if (isSqlServer.value) return '支持 SQL 脚本；CSV 可通过 bcp 导入到指定表';
  return '支持 SQL、SQL.GZ、仅含一个备份文件的 ZIP；二进制备份需要对应官方恢复工具';
}

/** 提交异步任务，由客户端任务面板继续轮询进度和提供取消入口。 */
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
  if (isMongo.value && /\.(json|csv|bson)(\.gz)?$/i.test(form.file.name) && !form.collectionName.trim()) {
    ElMessage.warning('导入 MongoDB JSON / CSV / BSON 时请填写目标集合');
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
  data.append('engine', form.engine);
  data.append('charset', form.charset);
  if (form.sourceDatabase.trim()) data.append('sourceDatabase', form.sourceDatabase.trim());

  submitting.value = true;
  try {
    const res: any = await startNativeDatabaseImport(data);
    const task = (res?.data || res) as SqlScriptTaskVO;
    if (!task?.taskId) {
      ElMessage.error('任务创建失败');
      return;
    }
    ElMessage.success(`已提交${task.engine === 'NATIVE' ? '官方客户端' : 'Java'}导入：${form.file.name}`);
    visible.value = false;
    emit('started', task);
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '备份导入失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('导入数据库备份')"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <ElAlert
      type="info"
      :closable="false"
      show-icon
      :title="$tr('自动优先使用官方客户端，未安装时使用 Java。SQL 中显式库名和 Schema 按文件内容执行。遇错停止；已执行的操作可能已经写入数据库。')"
      class="mb-3"
    />
    <ElForm label-width="108px" @submit.prevent>
      <ElFormItem :label="$tr('目标实例')">
        <ElInput :model-value="instanceName" disabled />
      </ElFormItem>
      <ElFormItem :label="$tr('导入方式')">
        <ElSelect v-model="form.engine" style="width: 100%" :disabled="submitting">
          <ElOption :label="$tr('自动选择（推荐）')" value="auto" />
          <ElOption :label="$tr('官方客户端')" value="native" />
          <ElOption :label="$tr('Java')" value="managed" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem :label="$tr('脚本编码')">
        <ElSelect v-model="form.charset" style="width: 100%" :disabled="submitting">
          <ElOption label="UTF-8" value="UTF-8" />
          <ElOption label="GBK（Java）" value="GBK" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem :label="$tr('备份文件')" required>
        <ElUpload
          :auto-upload="false"
          :limit="1"
          :accept="acceptForDb()"
          :on-change="onFileChange"
          :on-remove="onFileRemove"
          :on-exceed="onExceed"
        >
          <ElButton>{{ $tr('选择文件') }}</ElButton>
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
      <ElFormItem v-if="isMongo || isDm" :label="isMongo ? $tr('归档源库名') : $tr('备份源模式')">
        <ElInput v-model="form.sourceDatabase" :placeholder="isMongo ? $tr('跨库恢复 archive 时填写；留空表示与目标库同名') : $tr('跨模式恢复 DMP 时填写；留空表示与目标模式同名')" />
      </ElFormItem>
      <ElFormItem v-if="isMongo" :label="$tr('覆盖已有数据')">
        <ElSwitch v-model="form.dropExisting" />
        <span class="tip inline">{{ $tr('适用于官方归档、BSON、JSON、CSV；JS 按脚本内容执行') }}</span>
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton @click="visible = false">{{ $tr('取消') }}</ElButton>
      <ElButton type="primary" :loading="submitting" @click="onSubmit">
        {{ $tr('开始导入') }}
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
