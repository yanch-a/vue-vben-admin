<script lang="ts" setup>
/**
 * 服务端官方数据库客户端管理。
 * 客户端文件由管理员上传到后端指定目录，随后用版本命令验证可用性。
 */
import { computed, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import {
  getDatabaseToolCatalog,
  getDatabaseToolSettings,
  testDatabaseTool,
  updateDatabaseToolSettings,
  uploadDatabaseTool,
  type DatabaseToolCatalogVO,
  type DatabaseToolSettingsVO,
} from '#/api/visual/databaseTool';
import { DB_TYPE_REGISTRY } from '../dialect/dbTypes';

defineOptions({ name: 'DatabaseToolDialog' });

const visible = defineModel<boolean>({ default: false });
const rows = ref<DatabaseToolCatalogVO[]>([]);
const settings = ref<DatabaseToolSettingsVO | null>(null);
const baseDirectory = ref('');
const loading = ref(false);
const testing = ref<string>('');
const uploading = ref(false);
const savingDirectory = ref(false);
const uploadFile = ref<File | null>(null);
const uploadRef = ref<{ clearFiles: () => void } | null>(null);
const uploadDbType = ref('MY_SQL');
const uploadToolName = ref('');

const dbTypeOptions = computed(() =>
  Object.values(DB_TYPE_REGISTRY).map((item) => ({
    label: item.label,
    value: item.code,
  })),
);

const uploadToolOptions = computed(() =>
  rows.value
    .filter((item) => item.dbType === uploadDbType.value)
    .map((item) => ({
      label: `${item.toolName}（${item.toolLabel}）`,
      value: item.toolName,
    }))
    .filter(
      (item, index, list) =>
        list.findIndex((candidate) => candidate.value === item.value) === index,
    ),
);

function rowKey(row: DatabaseToolCatalogVO) {
  return `${row.dbType}:${row.toolName}:${row.operation}`;
}

function operationLabel(operation: string) {
  return { CLIENT: '执行', DUMP: '导出', RESTORE: '导入' }[operation] || operation;
}

async function loadCatalog() {
  loading.value = true;
  try {
    const res: any = await getDatabaseToolCatalog();
    rows.value = res?.data || res || [];
    syncUploadTool();
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '读取客户端工具列表失败');
  } finally {
    loading.value = false;
  }
}

async function loadSettings() {
  try {
    const res: any = await getDatabaseToolSettings();
    const value = (res?.data || res) as DatabaseToolSettingsVO;
    settings.value = value;
    baseDirectory.value = value?.baseDirectory || value?.defaultDirectory || '';
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '读取客户端目录设置失败');
  }
}

async function loadPage() {
  await Promise.all([loadCatalog(), loadSettings()]);
}

function syncUploadTool() {
  if (!uploadToolOptions.value.some((item) => item.value === uploadToolName.value)) {
    uploadToolName.value = uploadToolOptions.value[0]?.value || '';
  }
}

watch(visible, (open) => {
  if (open) {
    uploadFile.value = null;
    loadPage();
  }
});

watch(uploadDbType, syncUploadTool);

function onFileChange(file: { raw?: File } | undefined) {
  uploadFile.value = file?.raw || null;
}

function onFileRemove() {
  uploadFile.value = null;
}

function clearSelectedFile() {
  uploadRef.value?.clearFiles();
  uploadFile.value = null;
}

async function onSaveDirectory() {
  if (!baseDirectory.value.trim()) {
    ElMessage.warning('请输入客户端基础目录');
    return;
  }
  savingDirectory.value = true;
  try {
    const res: any = await updateDatabaseToolSettings({
      baseDirectory: baseDirectory.value.trim(),
    });
    const value = (res?.data || res) as DatabaseToolSettingsVO;
    settings.value = value;
    baseDirectory.value = value?.baseDirectory || baseDirectory.value.trim();
    await loadCatalog();
    ElMessage.success('基础目录已保存并完成扫描');
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '保存客户端目录失败');
  } finally {
    savingDirectory.value = false;
  }
}

async function onUpload() {
  if (!uploadToolName.value) {
    ElMessage.warning('请选择要上传的客户端类型');
    return;
  }
  if (!uploadFile.value) {
    ElMessage.warning('请选择客户端文件或 ZIP 包');
    return;
  }
  const form = new FormData();
  form.append('dbType', uploadDbType.value);
  form.append('toolName', uploadToolName.value);
  form.append('file', uploadFile.value);
  uploading.value = true;
  try {
    const res: any = await uploadDatabaseTool(form);
    rows.value = res?.data || res || [];
    clearSelectedFile();
    ElMessage.success('客户端已上传，请点击“测试”验证');
    syncUploadTool();
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '上传客户端失败');
  } finally {
    uploading.value = false;
  }
}

async function onTest(row: DatabaseToolCatalogVO) {
  const key = rowKey(row);
  testing.value = key;
  try {
    const res: any = await testDatabaseTool({
      dbType: row.dbType,
      toolName: row.toolName,
    });
    const result = (res?.data || res) as any;
    row.available = !!result?.success;
    row.version = result?.version || '';
    row.executable = result?.executable || row.executable;
    row.message = result?.message || '';
    ElMessage[result?.success ? 'success' : 'error'](
      result?.message || '客户端测试完成',
    );
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || '客户端测试失败');
  } finally {
    testing.value = '';
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    title="官方数据库客户端"
    width="980px"
    destroy-on-close
    append-to-body
  >
    <ElAlert
      type="info"
      :closable="false"
      show-icon
      title="客户端由服务端进程调用。上传 ZIP 时请保持官方目录结构；上传和测试客户端需要系统管理员权限。"
      class="mb-3"
    />

    <div class="tool-directory">
      <div class="tool-directory-title">基础目录</div>
      <ElInput
        v-model="baseDirectory"
        class="directory-input"
        clearable
        placeholder="例如 /data/apps/lemonDb/dbClient"
      />
      <ElButton
        type="primary"
        plain
        :loading="savingDirectory"
        @click="onSaveDirectory"
      >
        保存并扫描
      </ElButton>
      <ElTag
        v-if="settings"
        :type="settings.exists && settings.directory && settings.readable ? 'success' : 'warning'"
        size="small"
      >
        {{ settings.availableTools }} / {{ settings.totalTools }} 个客户端可用
      </ElTag>
      <span v-if="settings?.message" class="directory-message">
        {{ settings.message }}
      </span>
    </div>

    <div class="tool-upload">
      <div class="tool-upload-title">上传客户端</div>
      <ElSelect v-model="uploadDbType" filterable class="type-select">
        <ElOption
          v-for="item in dbTypeOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </ElSelect>
      <ElSelect v-model="uploadToolName" filterable class="tool-select">
        <ElOption
          v-for="item in uploadToolOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </ElSelect>
      <div class="upload-picker">
        <ElUpload
          ref="uploadRef"
          class="upload-control"
          :auto-upload="false"
          :limit="1"
          :show-file-list="false"
          accept=".zip,.exe,.bin,.sh"
          :on-change="onFileChange"
          :on-remove="onFileRemove"
        >
          <ElButton>选择文件</ElButton>
        </ElUpload>
        <span v-if="uploadFile" class="selected-file" :title="uploadFile.name">
          {{ uploadFile.name }}
        </span>
        <ElButton v-if="uploadFile" link type="danger" @click="clearSelectedFile">
          清除
        </ElButton>
      </div>
      <ElButton class="upload-submit" type="primary" :loading="uploading" @click="onUpload">
        上传
      </ElButton>
    </div>

    <ElTable v-loading="loading" :data="rows" size="small" border height="460">
      <ElTableColumn prop="dbLabel" label="数据库" width="150" />
      <ElTableColumn prop="toolName" label="工具" width="130" />
      <ElTableColumn label="用途" width="90">
        <template #default="{ row }">
          {{ operationLabel(row.operation) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag :type="row.available ? 'success' : 'info'" size="small">
            {{ row.available ? '已发现' : '未发现' }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="source" label="来源" width="100" />
      <ElTableColumn prop="executable" label="执行文件" min-width="240" show-overflow-tooltip />
      <ElTableColumn label="版本 / 操作" min-width="220">
        <template #default="{ row }">
          <div class="version-cell">
            <span v-if="row.version" class="version">{{ row.version }}</span>
            <span v-else class="message">{{ row.message }}</span>
            <ElButton
              link
              type="primary"
              :loading="testing === rowKey(row)"
              @click="onTest(row)"
            >
              测试
            </ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>

    <template #footer>
      <ElButton :loading="loading" @click="loadCatalog">刷新</ElButton>
      <ElButton @click="visible = false">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.tool-upload {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.tool-directory {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.tool-directory-title {
  font-weight: 600;
  margin-right: 4px;
}
.directory-input {
  width: min(440px, 100%);
}
.directory-message {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.tool-upload-title {
  font-weight: 600;
  margin-right: 4px;
}
.type-select {
  width: 190px;
}
.tool-select {
  width: 260px;
}
.upload-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  min-width: 0;
}
.upload-control,
.upload-control :deep(.el-upload) {
  display: flex;
  align-items: center;
  height: 32px;
}
.selected-file {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.upload-submit {
  flex-shrink: 0;
}
.version-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.version,
.message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
}
.version {
  flex: 1;
}
</style>
