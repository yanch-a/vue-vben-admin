<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
} from 'element-plus';

import { doEdit, getOne } from '#/api/cms/cmsGlobalConfigApi';

defineOptions({ name: 'CmsGlobalConfigManage' });

const loading = ref(false);
const saving = ref(false);
const form = reactive<Record<string, any>>({
  id: undefined,
  contextPath: '',
  sysPort: 0,
  defaultCode: '',
});

async function fetchData() {
  loading.value = true;
  try {
    const res = await getOne();
    const data = res?.data ?? res;
    if (data) Object.assign(form, data);
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!form.contextPath) {
    ElMessage.warning('请输入项目路径');
    return;
  }
  saving.value = true;
  try {
    const { msg } = await doEdit({ ...form });
    ElMessage.success(msg || '保存成功');
    await fetchData();
  } finally {
    saving.value = false;
  }
}

onMounted(fetchData);
</script>

<template>
  <Page auto-content-height title="全局配置">
    <template #extra>
      <ElButton type="primary" :loading="saving" @click="handleSave">保存</ElButton>
      <ElButton @click="fetchData">刷新</ElButton>
    </template>

    <ElForm v-loading="loading" label-width="140px" class="max-w-xl">
      <ElFormItem label="项目路径" required>
        <ElInput v-model="form.contextPath" maxlength="10" placeholder="请输入项目路径" />
      </ElFormItem>
      <ElFormItem label="端口号" required>
        <ElInputNumber v-model="form.sysPort" :controls="false" :max="999999" class="w-full" />
      </ElFormItem>
      <ElFormItem label="系统所属地区编码">
        <ElInput v-model="form.defaultCode" maxlength="50" placeholder="请输入地区编码" />
      </ElFormItem>
    </ElForm>
  </Page>
</template>
