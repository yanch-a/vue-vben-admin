<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
} from 'element-plus';

import {
  doDelete,
  doEdit,
  getById,
  getTree,
} from '#/api/cms/cmsChannelApi';
import { getList as getModelList } from '#/api/cms/cmsModelApi';
import { getList as getSiteList } from '#/api/cms/siteApi';

defineOptions({ name: 'CmsChannelManage' });

const loading = ref(false);
const treeData = ref<any[]>([]);
const modelOptions = ref<any[]>([]);
const siteOptions = ref<any[]>([]);
const dialogVisible = ref(false);
const dialogLoading = ref(false);
const siteId = ref<number | string | undefined>(
  localStorage.getItem('defaultSiteId')
    ? Number(localStorage.getItem('defaultSiteId'))
    : undefined,
);

const form = reactive<Record<string, any>>({
  id: undefined,
  parentId: 0,
  siteId: undefined,
  channelName: '',
  channelPath: '',
  modelId: undefined,
  display: 1,
  orderNum: 0,
  link: '',
  description: '',
});

function unwrapData(res: any) {
  return res?.data ?? res;
}

async function loadSites() {
  const res = await getSiteList({});
  const data = unwrapData(res);
  siteOptions.value = Array.isArray(data) ? data : data?.list || [];
  if (!siteId.value && siteOptions.value.length) {
    siteId.value = siteOptions.value[0].id;
    localStorage.setItem('defaultSiteId', String(siteId.value));
  }
}

async function loadModels() {
  const res = await getModelList({});
  const data = unwrapData(res);
  modelOptions.value = Array.isArray(data) ? data : data?.list || [];
}

async function loadTree() {
  loading.value = true;
  try {
    const res = await getTree({ siteId: siteId.value });
    const data = unwrapData(res);
    treeData.value = Array.isArray(data) ? data : data?.list || [];
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    id: undefined,
    parentId: 0,
    siteId: siteId.value,
    channelName: '',
    channelPath: '',
    modelId: undefined,
    display: 1,
    orderNum: 0,
    link: '',
    description: '',
  });
}

async function openEdit(row?: Record<string, any>, parent?: Record<string, any>) {
  resetForm();
  if (row?.id && row.id !== 'root') {
    const res = await getById({ id: row.id });
    Object.assign(form, unwrapData(res) ?? row);
  } else if (parent?.id && parent.id !== 'root') {
    form.parentId = parent.id;
  }
  form.siteId = siteId.value;
  dialogVisible.value = true;
}

async function handleSave() {
  if (!form.channelName) {
    ElMessage.warning('请输入栏目名称');
    return;
  }
  try {
    dialogLoading.value = true;
    const { msg } = await doEdit({ ...form });
    ElMessage.success(msg || '保存成功');
    dialogVisible.value = false;
    await loadTree();
  } finally {
    dialogLoading.value = false;
  }
}

async function handleDelete(row: Record<string, any>) {
  if (!row?.id || row.id === 'root') return;
  await ElMessageBox.confirm(`确认删除栏目「${row.channelName || row.label}」？`, '提示', {
    type: 'warning',
  });
  const { msg } = await doDelete({ ids: [row.id] });
  ElMessage.success(msg || '删除成功');
  await loadTree();
}

function onSiteChange(val: number | string) {
  localStorage.setItem('defaultSiteId', String(val));
  loadTree();
}

onMounted(async () => {
  await loadSites();
  await loadModels();
  await loadTree();
});
</script>

<template>
  <Page auto-content-height title="栏目管理">
    <template #extra>
      <ElSelect
        v-model="siteId"
        class="mr-2 w-48"
        placeholder="选择站点"
        @change="onSiteChange"
      >
        <ElOption
          v-for="item in siteOptions"
          :key="item.id"
          :label="item.siteName"
          :value="item.id"
        />
      </ElSelect>
      <ElButton type="primary" @click="openEdit()">新增栏目</ElButton>
      <ElButton @click="loadTree">刷新</ElButton>
    </template>

    <ElTable
      v-loading="loading"
      :data="treeData"
      row-key="id"
      border
      default-expand-all
      :tree-props="{ children: 'children' }"
    >
      <ElTableColumn
        prop="channelName"
        label="栏目名称"
        min-width="200"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{ row.channelName || row.label }}
        </template>
      </ElTableColumn>
      <ElTableColumn prop="channelPath" label="栏目路径" min-width="140" show-overflow-tooltip />
      <ElTableColumn prop="modelId" label="模型ID" width="90" align="center" />
      <ElTableColumn prop="orderNum" label="排序" width="80" align="center" />
      <ElTableColumn label="显示" width="80" align="center">
        <template #default="{ row }">
          {{ row.display === 1 ? '是' : '否' }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="220" fixed="right" align="center">
        <template #default="{ row }">
          <ElButton link type="primary" @click="openEdit(undefined, row)">
            新增子级
          </ElButton>
          <ElButton
            v-if="row.id !== 'root'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </ElButton>
          <ElButton
            v-if="row.id !== 'root'"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog
      v-model="dialogVisible"
      :title="form.id ? '编辑栏目' : '新增栏目'"
      width="560px"
      destroy-on-close
    >
      <ElForm label-width="100px">
        <ElFormItem label="上级栏目ID">
          <ElInputNumber v-model="form.parentId" :min="0" class="w-full" />
        </ElFormItem>
        <ElFormItem label="栏目名称" required>
          <ElInput v-model="form.channelName" maxlength="50" />
        </ElFormItem>
        <ElFormItem label="栏目路径">
          <ElInput v-model="form.channelPath" maxlength="30" />
        </ElFormItem>
        <ElFormItem label="栏目模型">
          <ElSelect v-model="form.modelId" clearable class="w-full" placeholder="请选择模型">
            <ElOption
              v-for="item in modelOptions"
              :key="item.id"
              :label="item.modelName"
              :value="item.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="form.orderNum" :min="0" :max="999" />
        </ElFormItem>
        <ElFormItem label="显示">
          <ElSwitch v-model="form.display" :active-value="1" :inactive-value="0" />
        </ElFormItem>
        <ElFormItem label="外部链接">
          <ElInput v-model="form.link" maxlength="100" />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput v-model="form.description" type="textarea" :rows="3" maxlength="500" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="dialogLoading" @click="handleSave">
          保存
        </ElButton>
      </template>
    </ElDialog>
  </Page>
</template>
