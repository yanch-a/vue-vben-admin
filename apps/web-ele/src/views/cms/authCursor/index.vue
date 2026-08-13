<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  ElButton,
  ElCol,
  ElDatePicker,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElRow,
  ElSelect,
  ElTable,
  ElTableColumn,
} from 'element-plus';

import {
  doDelete,
  doEdit,
  genOne,
  getById,
  getPage,
} from '#/api/cms/authCursorApi';

defineOptions({ name: 'AuthCursorManage' });

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const selectedRows = ref<any[]>([]);
const dialogVisible = ref(false);
const dialogLoading = ref(false);
const queryForm = reactive({
  pageNum: 1,
  pageSize: 20,
  name: '',
  code: '',
});
const form = reactive<Record<string, any>>({
  id: undefined,
  name: '',
  code: '',
  deviceId: '',
  dayNum: 30,
  deviceNum: 1,
  useNum: 0,
  startTime: '',
  osType: 'Windows',
  ext: '',
  description: '',
});

const osTypeOptions = ['Windows', 'Mac', 'Linux'];

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
    name: '',
    code: '',
    deviceId: '',
    dayNum: 30,
    deviceNum: 1,
    useNum: 0,
    startTime: '',
    osType: 'Windows',
    ext: '',
    description: '',
  });
}

async function openEdit(row?: Record<string, any>) {
  resetForm();
  if (row?.id) {
    const res = await getById({ id: row.id });
    Object.assign(form, res?.data ?? row);
  } else {
    const res = await genOne({
      name: '新增账号',
      dayNum: 30,
      osType: 'Windows',
    });
    Object.assign(form, res?.data ?? {});
  }
  dialogVisible.value = true;
}

async function handleSave() {
  if (!form.name || !form.code) {
    ElMessage.warning('请填写购买人名称和认证码');
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

async function handleDelete(row?: Record<string, any>) {
  if (row?.id) {
    await ElMessageBox.confirm(`确认删除「${row.name}」？`, '提示', {
      type: 'warning',
    });
    const { msg } = await doDelete({ ids: [row.id] });
    ElMessage.success(msg || '删除成功');
    await fetchData();
    return;
  }
  if (!selectedRows.value.length) {
    ElMessage.warning('未选中任何行');
    return;
  }
  await ElMessageBox.confirm('确认删除选中项？', '提示', { type: 'warning' });
  const ids = selectedRows.value.map((item) => item.id).join(',');
  const { msg } = await doDelete({ ids });
  ElMessage.success(msg || '删除成功');
  await fetchData();
}

function handleQuery() {
  queryForm.pageNum = 1;
  fetchData();
}

function onSelectionChange(rows: any[]) {
  selectedRows.value = rows;
}

onMounted(fetchData);
</script>

<template>
  <Page auto-content-height title="认证码管理">
    <template #extra>
      <ElButton type="primary" @click="openEdit()">新增</ElButton>
      <ElButton type="danger" @click="handleDelete()">批量删除</ElButton>
      <ElButton @click="fetchData">刷新</ElButton>
    </template>

    <div class="mb-3 flex flex-wrap gap-2">
      <ElInput
        v-model="queryForm.name"
        class="w-40"
        clearable
        placeholder="购买人名称"
        @keyup.enter="handleQuery"
      />
      <ElInput
        v-model="queryForm.code"
        class="w-40"
        clearable
        placeholder="认证码"
        @keyup.enter="handleQuery"
      />
      <ElButton type="primary" @click="handleQuery">查询</ElButton>
    </div>

    <ElTable
      v-loading="loading"
      :data="list"
      border
      @selection-change="onSelectionChange"
    >
      <ElTableColumn type="selection" width="48" align="center" />
      <ElTableColumn type="index" label="序号" width="55" align="center" />
      <ElTableColumn prop="name" label="购买人名称" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">
          <ElButton link type="primary" @click="openEdit(row)">
            {{ row.name }}
          </ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="code" label="认证码" min-width="140" show-overflow-tooltip />
      <ElTableColumn prop="deviceId" label="设备码" min-width="120" show-overflow-tooltip />
      <ElTableColumn prop="dayNum" label="有效天数" width="90" align="center" />
      <ElTableColumn prop="deviceNum" label="设备数量" width="90" align="center" />
      <ElTableColumn prop="useNum" label="已用设备" width="90" align="center" />
      <ElTableColumn prop="startTime" label="生效日期" min-width="160" show-overflow-tooltip />
      <ElTableColumn prop="osType" label="系统类别" width="100" align="center" />
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
      :title="form.id ? '编辑认证码' : '新增认证码'"
      width="720px"
      destroy-on-close
    >
      <ElForm label-width="120px">
        <ElFormItem label="购买人名称" required>
          <ElInput v-model="form.name" maxlength="50" />
        </ElFormItem>
        <ElRow :gutter="12">
          <ElCol :span="12">
            <ElFormItem label="认证码" required>
              <ElInput v-model="form.code" maxlength="50" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="设备码">
              <ElInput v-model="form.deviceId" maxlength="50" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="有效天数" required>
              <ElInputNumber v-model="form.dayNum" :min="1" class="w-full" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="生效日期" required>
              <ElDatePicker
                v-model="form.startTime"
                class="w-full"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="选择生效日期"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="设备数量" required>
              <ElInputNumber v-model="form.deviceNum" :min="1" :max="10" class="w-full" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="已用设备">
              <ElInputNumber v-model="form.useNum" :min="0" :max="10" class="w-full" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="8">
            <ElFormItem label="系统类别" required>
              <ElSelect v-model="form.osType" class="w-full">
                <ElOption
                  v-for="item in osTypeOptions"
                  :key="item"
                  :label="item"
                  :value="item"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>
        <ElFormItem label="扩展字段">
          <ElInput v-model="form.ext" maxlength="100" />
        </ElFormItem>
        <ElFormItem label="结果">
          <ElInput v-model="form.description" type="textarea" :rows="6" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="dialogLoading" @click="handleSave">
          确定
        </ElButton>
      </template>
    </ElDialog>
  </Page>
</template>
