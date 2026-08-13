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
  ElPagination,
  ElSelect,
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
} from '#/api/cms/siteApi';

defineOptions({ name: 'SiteManage' });

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const dialogVisible = ref(false);
const dialogLoading = ref(false);
const queryForm = reactive({
  pageNum: 1,
  pageSize: 10,
  siteName: '',
});
const form = reactive<Record<string, any>>({
  id: undefined,
  siteName: '',
  siteKey: '',
  sitePath: '',
  domain: '',
  protocol: 'https',
  domainAlias: '',
  orderNum: 0,
  siteStatus: 1,
  pcTpl: '',
  mobileTpl: '',
  description: '',
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
    siteName: '',
    siteKey: '',
    sitePath: '',
    domain: '',
    protocol: 'https',
    domainAlias: '',
    orderNum: 0,
    siteStatus: 1,
    pcTpl: '',
    mobileTpl: '',
    description: '',
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
  if (!form.siteName) {
    ElMessage.warning('请输入站点名称');
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
  await ElMessageBox.confirm(`确认删除站点「${row.siteName}」？`, '提示', {
    type: 'warning',
  });
  const { msg } = await doDelete({ ids: [row.id] });
  ElMessage.success(msg || '删除成功');
  await fetchData();
}

async function updateStatus(row: Record<string, any>) {
  const { msg } = await doUpdateStatus({
    id: row.id,
    siteStatus: row.siteStatus,
  });
  ElMessage.success(msg || '状态已更新');
}

function handleQuery() {
  queryForm.pageNum = 1;
  fetchData();
}

onMounted(fetchData);
</script>

<template>
  <Page auto-content-height title="站点管理">
    <template #extra>
      <ElButton type="primary" @click="openEdit()">新增站点</ElButton>
      <ElButton @click="fetchData">刷新</ElButton>
    </template>

    <div class="mb-3 flex flex-wrap gap-2">
      <ElInput
        v-model="queryForm.siteName"
        clearable
        class="w-56"
        placeholder="站点名称"
        @keyup.enter="handleQuery"
      />
      <ElButton type="primary" @click="handleQuery">查询</ElButton>
    </div>

    <ElTable v-loading="loading" :data="list" border>
      <ElTableColumn type="index" label="序号" width="55" align="center" />
      <ElTableColumn prop="id" label="站点ID" width="80" align="center" />
      <ElTableColumn prop="siteName" label="站点名称" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <ElButton link type="primary" @click="openEdit(row)">
            {{ row.siteName }}
          </ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="siteKey" label="站点标识" min-width="120" show-overflow-tooltip />
      <ElTableColumn prop="sitePath" label="站点路径" min-width="120" show-overflow-tooltip />
      <ElTableColumn prop="domain" label="域名" min-width="140" show-overflow-tooltip />
      <ElTableColumn label="状态" width="100" align="center">
        <template #default="{ row }">
          <ElSwitch
            v-model="row.siteStatus"
            :active-value="1"
            :inactive-value="0"
            @change="updateStatus(row)"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn prop="description" label="描述" min-width="140" show-overflow-tooltip />
      <ElTableColumn prop="createTime" label="创建时间" min-width="160" show-overflow-tooltip />
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
      :title="form.id ? '编辑站点' : '新增站点'"
      width="640px"
      destroy-on-close
    >
      <ElForm label-width="100px">
        <ElFormItem label="站点名称" required>
          <ElInput v-model="form.siteName" maxlength="50" />
        </ElFormItem>
        <ElFormItem label="站点编码">
          <ElInput v-model="form.siteKey" maxlength="30" />
        </ElFormItem>
        <ElFormItem label="域名">
          <ElInput v-model="form.domain" maxlength="50">
            <template #prepend>
              <ElSelect v-model="form.protocol" style="width: 100px">
                <ElOption label="http" value="http" />
                <ElOption label="https" value="https" />
              </ElSelect>
            </template>
          </ElInput>
        </ElFormItem>
        <ElFormItem label="站点路径">
          <ElInput v-model="form.sitePath" maxlength="30" />
        </ElFormItem>
        <ElFormItem label="域名别名">
          <ElInput v-model="form.domainAlias" maxlength="150" />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="form.orderNum" :min="0" :max="999" />
        </ElFormItem>
        <ElFormItem label="状态">
          <ElSwitch v-model="form.siteStatus" :active-value="1" :inactive-value="0" />
        </ElFormItem>
        <ElFormItem label="PC模板">
          <ElInput v-model="form.pcTpl" maxlength="30" />
        </ElFormItem>
        <ElFormItem label="移动模板">
          <ElInput v-model="form.mobileTpl" maxlength="30" />
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
