<script lang="ts" setup>
/**
 * 系统功能面板：配置包导入/导出
 * @author yanch
 */
import { computed, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import { getDbConfigList } from '#/api/visual/vq';
import {
  BUNDLE_SECTION_LABELS,
  exportVqBundle,
  importVqBundle,
  previewVqBundleImport,
  type VqBundleConflictStrategy,
  type VqBundleImportResult,
  type VqBundleSection,
} from '#/api/visual/vqBundle';

defineOptions({ name: 'SystemFunctionsDialog' });

const visible = defineModel<boolean>({ default: false });

const emit = defineEmits<{
  imported: [];
}>();

const ALL_SECTIONS: VqBundleSection[] = [
  'dbConfigs',
  'savedQueryGroups',
  'savedQueries',
  'queryConfigs',
];

const mode = ref<'export' | 'import' | 'menu'>('menu');
const loading = ref(false);
const dbConfigs = ref<any[]>([]);

const exportForm = reactive({
  password: '',
  confirmPassword: '',
  sections: [...ALL_SECTIONS] as VqBundleSection[],
  dbConfigIds: [] as Array<number | string>,
  allConnections: true,
});

const importForm = reactive({
  password: '',
  conflictStrategy: 'SKIP' as VqBundleConflictStrategy,
  file: null as File | null,
});

const previewResult = ref<VqBundleImportResult | null>(null);

const sectionOptions = computed(() =>
  ALL_SECTIONS.map((k) => ({ value: k, label: BUNDLE_SECTION_LABELS[k] })),
);

watch(visible, (v) => {
  if (v) {
    resetToMenu();
    loadDbConfigs();
  }
});

function resetToMenu() {
  mode.value = 'menu';
  exportForm.password = '';
  exportForm.confirmPassword = '';
  exportForm.sections = [...ALL_SECTIONS];
  exportForm.dbConfigIds = [];
  exportForm.allConnections = true;
  importForm.password = '';
  importForm.conflictStrategy = 'SKIP';
  importForm.file = null;
  previewResult.value = null;
}

async function loadDbConfigs() {
  try {
    const res: any = await getDbConfigList({});
    dbConfigs.value = res?.data || res || [];
  } catch {
    dbConfigs.value = [];
  }
}

function openExport() {
  mode.value = 'export';
}

function openImport() {
  mode.value = 'import';
}

function backToMenu() {
  mode.value = 'menu';
  previewResult.value = null;
}

function onFileChange(file: File | undefined) {
  importForm.file = file ?? null;
  previewResult.value = null;
}

async function doExport() {
  if (!exportForm.password || exportForm.password.length < 6) {
    ElMessage.warning('导出密码至少 6 位');
    return;
  }
  if (exportForm.password !== exportForm.confirmPassword) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  if (!exportForm.allConnections && exportForm.dbConfigIds.length === 0) {
    ElMessage.warning('请至少选择一个数据库连接');
    return;
  }
  loading.value = true;
  try {
    const blob: any = await exportVqBundle({
      password: exportForm.password,
      sections: exportForm.sections,
      dbConfigIds: exportForm.allConnections ? undefined : exportForm.dbConfigIds,
    });
    const fileBlob = blob instanceof Blob ? blob : blob?.data;
    if (!fileBlob || !(fileBlob instanceof Blob)) {
      ElMessage.error('导出失败：未收到有效文件');
      return;
    }
    if (fileBlob.type?.includes('application/json')) {
      const text = await fileBlob.text();
      let msg = '导出失败';
      try {
        msg = JSON.parse(text)?.msg || msg;
      } catch {
        /* ignore */
      }
      ElMessage.error(msg);
      return;
    }
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    link.href = url;
    link.download = `vq-config-${ts}.vqb`;
    link.click();
    window.URL.revokeObjectURL(url);
    ElMessage.success('配置包已导出');
    visible.value = false;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导出失败');
  } finally {
    loading.value = false;
  }
}

async function doPreviewImport() {
  if (!importForm.file) {
    ElMessage.warning('请选择配置包文件');
    return;
  }
  if (!importForm.password) {
    ElMessage.warning('请输入解密密码');
    return;
  }
  loading.value = true;
  try {
    const form = new FormData();
    form.append('file', importForm.file);
    form.append('password', importForm.password);
    form.append('conflictStrategy', importForm.conflictStrategy);
    const res: any = await previewVqBundleImport(form);
    previewResult.value = res?.data || res;
    ElMessage.success('预览完成');
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '预览失败');
  } finally {
    loading.value = false;
  }
}

async function doImport() {
  if (!importForm.file) {
    ElMessage.warning('请选择配置包文件');
    return;
  }
  if (!importForm.password) {
    ElMessage.warning('请输入解密密码');
    return;
  }
  loading.value = true;
  try {
    const form = new FormData();
    form.append('file', importForm.file);
    form.append('password', importForm.password);
    form.append('conflictStrategy', importForm.conflictStrategy);
    const res: any = await importVqBundle(form);
    previewResult.value = res?.data || res;
    ElMessage.success('导入完成');
    emit('imported');
    visible.value = false;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导入失败');
  } finally {
    loading.value = false;
  }
}

function statLine(key: string, stat: any) {
  const label = BUNDLE_SECTION_LABELS[key as VqBundleSection] || key;
  return `${label}：共 ${stat.total}，新增 ${stat.imported}，跳过 ${stat.skipped}，覆盖 ${stat.overwritten}，重命名 ${stat.renamed}，失败 ${stat.failed}`;
}
</script>

<template>
  <ElDialog
    v-model="visible"
    title="系统功能"
    width="560px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <!-- 主菜单 -->
    <div v-if="mode === 'menu'" class="sys-menu">
      <div class="sys-item" @click="openExport">
        <div class="sys-item-title">导出配置</div>
        <div class="sys-item-desc">
          将数据库连接、已保存查询、可视化查询配置导出为加密 .vqb 文件
        </div>
      </div>
      <div class="sys-item" @click="openImport">
        <div class="sys-item-title">导入配置</div>
        <div class="sys-item-desc">
          解析加密配置包并写入当前账号（支持冲突策略）
        </div>
      </div>
    </div>

    <!-- 导出 -->
    <div v-else-if="mode === 'export'" class="sys-form">
      <ElAlert
        type="info"
        :closable="false"
        show-icon
        title="仅导出您拥有管理权限的数据库连接；查询类数据按当前登录用户隔离。"
        class="mb-3"
      />
      <ElForm label-width="100px" @submit.prevent>
        <ElFormItem label="导出范围">
          <ElCheckboxGroup v-model="exportForm.sections">
            <ElCheckbox
              v-for="opt in sectionOptions"
              :key="opt.value"
              :value="opt.value"
              :label="opt.value"
            >
              {{ opt.label }}
            </ElCheckbox>
          </ElCheckboxGroup>
        </ElFormItem>
        <ElFormItem label="连接范围">
          <ElRadioGroup v-model="exportForm.allConnections">
            <ElRadio :value="true">全部可管理连接</ElRadio>
            <ElRadio :value="false">指定连接</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem v-if="!exportForm.allConnections" label="选择连接">
          <ElSelect
            v-model="exportForm.dbConfigIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择要导出的连接"
            style="width: 100%"
          >
            <ElOption
              v-for="c in dbConfigs"
              :key="c.id"
              :label="c.dbName"
              :value="c.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="加密密码" required>
          <ElInput
            v-model="exportForm.password"
            type="password"
            show-password
            placeholder="至少 6 位，用于保护配置包"
            autocomplete="new-password"
          />
        </ElFormItem>
        <ElFormItem label="确认密码" required>
          <ElInput
            v-model="exportForm.confirmPassword"
            type="password"
            show-password
            placeholder="再次输入密码"
            autocomplete="new-password"
          />
        </ElFormItem>
      </ElForm>
    </div>

    <!-- 导入 -->
    <div v-else class="sys-form">
      <ElAlert
        type="warning"
        :closable="false"
        show-icon
        title="导入的连接将归属当前用户；同名冲突可按策略跳过、覆盖或重命名。"
        class="mb-3"
      />
      <ElForm label-width="100px" @submit.prevent>
        <ElFormItem label="配置文件" required>
          <ElUpload
            :auto-upload="false"
            :limit="1"
            accept=".vqb"
            :on-change="(f: any) => onFileChange(f?.raw)"
            :on-remove="() => onFileChange(undefined)"
          >
            <ElButton size="small">选择 .vqb 文件</ElButton>
          </ElUpload>
        </ElFormItem>
        <ElFormItem label="解密密码" required>
          <ElInput
            v-model="importForm.password"
            type="password"
            show-password
            placeholder="导出时设置的密码"
            autocomplete="current-password"
          />
        </ElFormItem>
        <ElFormItem label="冲突策略">
          <ElRadioGroup v-model="importForm.conflictStrategy">
            <ElRadio value="SKIP">跳过已存在</ElRadio>
            <ElRadio value="OVERWRITE">覆盖已存在</ElRadio>
            <ElRadio value="RENAME">重命名新建</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem v-if="previewResult" label="预览结果">
          <div class="preview-box">
            <div
              v-for="(stat, key) in previewResult.stats || {}"
              :key="key"
              class="preview-line"
            >
              {{ statLine(String(key), stat) }}
            </div>
            <div
              v-for="(msg, i) in previewResult.messages || []"
              :key="'m' + i"
              class="preview-warn"
            >
              {{ msg }}
            </div>
          </div>
        </ElFormItem>
      </ElForm>
    </div>

    <template #footer>
      <template v-if="mode === 'menu'">
        <ElButton @click="visible = false">关闭</ElButton>
      </template>
      <template v-else-if="mode === 'export'">
        <ElButton @click="backToMenu">返回</ElButton>
        <ElButton type="primary" :loading="loading" @click="doExport">
          导出
        </ElButton>
      </template>
      <template v-else>
        <ElButton @click="backToMenu">返回</ElButton>
        <ElButton :loading="loading" @click="doPreviewImport">预览</ElButton>
        <ElButton type="primary" :loading="loading" @click="doImport">
          确认导入
        </ElButton>
      </template>
    </template>
  </ElDialog>
</template>

<style scoped>
.sys-menu {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sys-item {
  padding: 14px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.sys-item:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.sys-item-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.sys-item-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.mb-3 {
  margin-bottom: 12px;
}
.preview-box {
  width: 100%;
  font-size: 13px;
  line-height: 1.6;
}
.preview-line {
  color: var(--el-text-color-regular);
}
.preview-warn {
  color: var(--el-color-warning);
  margin-top: 4px;
}
</style>
