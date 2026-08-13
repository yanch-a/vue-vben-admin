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
  ElPagination,
  ElSwitch,
  ElTable,
  ElTableColumn,
} from 'element-plus';

import {
  doDelete,
  doEdit,
  doUpdateStatus,
  getById,
  getPage,
} from '#/api/cms/cmsModelApi';

defineOptions({ name: 'CmsModelManage' });

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const dialogVisible = ref(false);
const dialogLoading = ref(false);
const queryForm = reactive({
  pageNum: 1,
  pageSize: 10,
  modelName: '',
});
const form = reactive<Record<string, any>>({
  id: undefined,
  modelName: '',
  modelPath: '',
  orderNum: 0,
  globalModel: 0,
});

function unwrapPage(res: any) {
  return {
    list: res?.data?.list ?? res?.list ?? res?.data?.rows ?? res?.rows ?? [],
    total: Number(res?.data?.total ?? res?.total ?? 0),
  };
}

async function fetchData() {
  loading.value = true;
  try {
    const page = unwrapPage(await getPage({ ...queryForm }));
    list.value = page.list;
    total.value = page.total;
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    id: undefined,
    modelName: '',
    modelPath: '',
    orderNum: 0,
    globalModel: 0,
  });
}

async function openEdit(row?: Record<string, any>) {
  resetForm();
  if (row?.id) {
    const res = await getById({ id: row.id });
    Object.assign(form, res?.data ?? row);
  }
  dialogVisible.value = true;
}

async function handleSave() {
  if (!form.modelName) {
    ElMessage.warning('请输入模型名称');
    return;
  }
  try {
    dialogLoading.value = true;
    const { msg } = await doEdit({ ...form });
    ElMessage.success(msg || '保存成功');
    dialogVisible.value = false;
    await fetchData();
  } finally {
    dialogLoading.value = false;
  }
}

async function handleDelete(row: Record<string, any>) {
  await ElMessageBox.confirm(`确认删除模型「${row.modelName}」？`, '提示', {
    type: 'warning',
  });
  const { msg } = await doDelete({ ids: [row.id] });
  ElMessage.success(msg || '删除成功');
  await fetchData();
}

async function updateGlobal(row: Record<string, any>) {
  const { msg } = await doUpdateStatus({
    id: row.id,
    globalModel: row.globalModel,
  });
  ElMessage.success(msg || '已更新');
}

function handleQuery() {
  queryForm.pageNum = 1;
  fetchData();
}

onMounted(fetchData);
</script>

<template>
  <Page auto-content-height title="模型管理">
    <template #extra>
      <ElButton type="primary" @click="openEdit()">新增模型</ElButton>
      <ElButton @click="fetchData">刷新</ElButton>
    </template>

    <div class="mb-3 flex flex-wrap gap-2">
      <ElInput
        v-model="queryForm.modelName"
        class="w-56"
        clearable
        placeholder="模型名称"
        @keyup.enter="handleQuery"
      />
      <ElButton type="primary" @click="handleQuery">查询</ElButton>
    </div>

    <ElTable v-loading="loading" :data="list" border>
      <ElTableColumn prop="id" label="主键" width="80" align="center" />
      <ElTableColumn prop="modelName" label="模型名称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <ElButton link type="primary" @click="openEdit(row)">
            {{ row.modelName }}
          </ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="modelPath" label="模型路径" min-width="160" show-overflow-tooltip />
      <ElTableColumn prop="orderNum" label="排序" width="80" align="center" />
      <ElTableColumn label="全站模型" width="100" align="center">
        <template #default="{ row }">
          <ElSwitch
            v-model="row.globalModel"
            :active-value="1"
            :inactive-value="0"
            @change="updateGlobal(row)"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="140" fixed="right" align="center">
        <template #default="{ row }">
          <ElButton link type="primary" @click="openEdit(row)">编辑</ElButton>
          <ElButton link type="danger" @click="handleDelete(row)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <div class="mt-3 flex justify-end">
      <ElPagination
        v-model:current-page="queryForm.pageNum"
        v-model:page-size="queryForm.pageSize"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @current-change="fetchData"
        @size-change="
          () => {
            queryForm.pageNum = 1;
            fetchData();
          }
        "
      />
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="form.id ? '编辑模型' : '新增模型'"
      width="520px"
      destroy-on-close
    >
      <ElForm label-width="100px">
        <ElFormItem label="模型名称" required>
          <ElInput v-model="form.modelName" maxlength="50" />
        </ElFormItem>
        <ElFormItem label="模型路径">
          <ElInput v-model="form.modelPath" maxlength="50" placeholder="模板文件名" />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="form.orderNum" :min="0" :max="999" />
        </ElFormItem>
        <ElFormItem label="全站模型">
          <ElSwitch v-model="form.globalModel" :active-value="1" :inactive-value="0" />
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
