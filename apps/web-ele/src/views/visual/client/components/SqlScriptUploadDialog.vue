<script lang="ts" setup>
/**
 * 上传 SQL 文件并提交后台执行任务
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import type { UploadRawFile } from 'element-plus';

import {
  startSqlScript,
  type SqlScriptTaskVO,
} from '#/api/visual/sqlScript';
import { startNativeDatabaseImport } from '#/api/visual/databaseTool';

defineOptions({ name: 'SqlScriptUploadDialog' });

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
  set: (v) => emit('update:modelValue', v),
});

const submitting = ref(false);
const form = reactive({
  file: null as File | null,
  continueOnError: true,
  charset: 'UTF-8',
  engine: 'managed' as 'managed' | 'native',
});

const isMongo = computed(() => props.dbType === 'MONGODB');
const fileAccept = computed(() => {
  if (form.engine === 'native') return isMongo.value ? '.js' : '.sql,.txt';
  return '.sql,.txt,.js';
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    form.file = null;
    form.continueOnError = true;
    form.charset = 'UTF-8';
    form.engine = 'managed';
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
    ElMessage.warning('请选择 SQL 文件');
    return;
  }
  const name = form.file.name.toLowerCase();
  const allowed =
    form.engine === 'native'
      ? isMongo.value
        ? name.endsWith('.js')
        : name.endsWith('.sql') || name.endsWith('.txt')
      : name.endsWith('.sql') || name.endsWith('.txt') || name.endsWith('.js');
  if (!allowed) {
    ElMessage.warning(
      form.engine === 'native'
        ? isMongo.value
          ? 'MongoDB 官方客户端脚本仅支持 .js'
          : '官方客户端脚本仅支持 .sql / .txt'
        : '仅支持 .sql / .txt / .js 文件',
    );
    return;
  }

  const data = new FormData();
  data.append('dbConfigId', String(props.dbConfigId));
  data.append('instanceName', props.instanceName);
  data.append('file', form.file);
  submitting.value = true;
  let starter: Promise<any>;
  if (form.engine === 'native') {
    data.append('dropExisting', 'false');
    starter = startNativeDatabaseImport(data);
  } else {
    data.append('continueOnError', form.continueOnError ? 'true' : 'false');
    data.append('charset', form.charset);
    starter = startSqlScript(data);
  }

  try {
    const res: any = await starter;
    const task = (res?.data || res) as SqlScriptTaskVO;
    if (!task?.taskId) {
      ElMessage.error('任务创建失败');
      return;
    }
    ElMessage.success(
      form.engine === 'native'
        ? `已提交官方客户端执行：${form.file.name}`
        : `已提交后台执行：${form.file.name}`,
    );
    visible.value = false;
    emit('started', task);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '上传失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('上传 SQL 文件')"
    width="520px"
    destroy-on-close
    append-to-body
  >
    <ElForm label-width="108px" @submit.prevent>
      <ElFormItem :label="$tr('目标实例')">
        <ElInput :model-value="instanceName" disabled />
      </ElFormItem>
      <ElFormItem :label="$tr('SQL 文件')" required>
        <ElUpload
          :auto-upload="false"
          :limit="1"
          :accept="fileAccept"
          :on-change="onFileChange"
          :on-remove="onFileRemove"
          :on-exceed="onExceed"
        >
          <ElButton>{{ $tr('选择文件') }}</ElButton>
          <template #tip>
            <div class="tip">
              {{ $tr(form.engine === 'native' && isMongo ? 'MongoDB mongosh 脚本' : '支持 .sql / .txt / .js') }}
            </div>
          </template>
        </ElUpload>
      </ElFormItem>
      <ElFormItem :label="$tr('执行方式')">
        <ElRadioGroup v-model="form.engine" size="small">
          <ElRadioButton label="managed">{{ $tr('逐条校验') }}</ElRadioButton>
          <ElRadioButton label="native">{{ $tr('官方客户端') }}</ElRadioButton>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem :label="$tr('文件编码')">
        <ElSelect v-model="form.charset" class="w-full">
          <ElOption label="UTF-8" value="UTF-8" />
          <ElOption label="GBK" value="GBK" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="form.engine === 'managed'" :label="$tr('遇错继续')">
        <ElSwitch v-model="form.continueOnError" />
        <span class="tip inline">{{ $tr('关闭则第一条失败即停止') }}</span>
      </ElFormItem>
      <ElAlert
        v-else
        type="info"
        :closable="false"
        :title="$tr('官方客户端由服务端执行；脚本错误会按厂商客户端返回失败。')"
      />
    </ElForm>
    <template #footer>
      <ElButton @click="visible = false">{{ $tr('取消') }}</ElButton>
      <ElButton type="primary" :loading="submitting" @click="onSubmit">
        {{ $tr('开始执行') }}
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.w-full {
  width: 100%;
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
