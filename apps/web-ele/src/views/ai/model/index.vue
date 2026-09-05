<script lang="ts" setup>
/**
 * AI 厂商 / 模型维护
 * 左侧厂商卡片，右侧该厂商下的模型版本
 * @author yanch
 */
import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { ElMessage, ElMessageBox } from 'element-plus';

import {
  batchSaveModels,
  deleteModel,
  deleteProvider,
  fetchProviderModels,
  initBuiltinProviders,
  listModels,
  listProviders,
  saveModel,
  saveProvider,
  setDefaultModel,
  testProvider,
} from '#/api/ai/model';

defineOptions({ name: 'AiModelManage' });

const loading = ref(false);
const providers = ref<any[]>([]);
const currentId = ref<number | string>();
const models = ref<any[]>([]);
const remoteModels = ref<{ modelCode: string; exists?: boolean }[]>([]);
const remoteVisible = ref(false);
const remotePicked = ref<string[]>([]);

const providerDlg = reactive({
  visible: false,
  saving: false,
  form: {
    id: undefined as number | string | undefined,
    providerCode: '',
    providerName: '',
    protocol: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    extraHeaders: '',
    timeoutSeconds: 120,
    supportsStreamUsage: 0,
    enabled: 1,
    isBuiltin: 0,
    scope: 'USER',
    orderNum: 0,
    apiKeyMasked: '',
  },
});

const modelDlg = reactive({
  visible: false,
  saving: false,
  form: {
    id: undefined as number | string | undefined,
    providerId: undefined as number | string | undefined,
    modelCode: '',
    displayName: '',
    supportsTools: 1,
    supportsReasoning: 0,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    defaultTemperature: 0.2,
    enabled: 1,
    orderNum: 0,
  },
});

const current = computed(
  () => providers.value.find((p) => String(p.id) === String(currentId.value)) || null,
);

const streamUsage = computed({
  get: () => providerDlg.form.supportsStreamUsage === 1,
  set: (v: boolean) => {
    providerDlg.form.supportsStreamUsage = v ? 1 : 0;
  },
});
const providerEnabled = computed({
  get: () => providerDlg.form.enabled === 1,
  set: (v: boolean) => {
    providerDlg.form.enabled = v ? 1 : 0;
  },
});
const modelTools = computed({
  get: () => modelDlg.form.supportsTools === 1,
  set: (v: boolean) => {
    modelDlg.form.supportsTools = v ? 1 : 0;
  },
});
const modelReasoning = computed({
  get: () => modelDlg.form.supportsReasoning === 1,
  set: (v: boolean) => {
    modelDlg.form.supportsReasoning = v ? 1 : 0;
  },
});
const modelEnabled = computed({
  get: () => modelDlg.form.enabled === 1,
  set: (v: boolean) => {
    modelDlg.form.enabled = v ? 1 : 0;
  },
});

function unwrap(res: any) {
  return res?.data ?? res;
}

async function loadProviders() {
  loading.value = true;
  try {
    const res: any = await listProviders();
    providers.value = unwrap(res) || [];
    if (!currentId.value && providers.value.length) {
      currentId.value = providers.value[0].id;
    }
    if (currentId.value && !providers.value.some((p) => String(p.id) === String(currentId.value))) {
      currentId.value = providers.value[0]?.id;
    }
    if (currentId.value) await loadModels();
    else models.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadModels() {
  if (!currentId.value) {
    models.value = [];
    return;
  }
  const res: any = await listModels(currentId.value);
  models.value = unwrap(res) || [];
}

onMounted(loadProviders);

async function onInitBuiltin() {
  const res: any = await initBuiltinProviders();
  ElMessage.success(`已初始化内置厂商（新增 ${unwrap(res)?.providers ?? 0}）`);
  await loadProviders();
}

function openProvider(row?: any) {
  Object.assign(providerDlg.form, {
    id: row?.id,
    providerCode: row?.providerCode || '',
    providerName: row?.providerName || '',
    protocol: row?.protocol || 'openai_compatible',
    baseUrl: row?.baseUrl || '',
    apiKey: '',
    extraHeaders: row?.extraHeaders || '',
    timeoutSeconds: row?.timeoutSeconds ?? 120,
    supportsStreamUsage: row?.supportsStreamUsage ?? 0,
    enabled: row?.enabled ?? 1,
    isBuiltin: row?.isBuiltin ?? 0,
    scope: row?.scope || 'USER',
    orderNum: row?.orderNum ?? 0,
    apiKeyMasked: row?.apiKeyMasked || '',
  });
  providerDlg.visible = true;
}

async function saveProviderDlg() {
  if (!providerDlg.form.providerCode || !providerDlg.form.providerName || !providerDlg.form.baseUrl) {
    ElMessage.warning('请填写编码、名称和 Base URL');
    return;
  }
  providerDlg.saving = true;
  try {
    const payload: Record<string, unknown> = { ...providerDlg.form };
    if (!payload.apiKey) delete payload.apiKey;
    delete payload.apiKeyMasked;
    const res: any = await saveProvider(payload);
    const saved = unwrap(res);
    ElMessage.success('已保存');
    providerDlg.visible = false;
    await loadProviders();
    if (saved?.id) currentId.value = saved.id;
  } finally {
    providerDlg.saving = false;
  }
}

async function onDelProvider(row: any) {
  if (row.isBuiltin === 1) {
    ElMessage.warning('内置厂商不可删除，可停用');
    return;
  }
  await ElMessageBox.confirm(`确认删除厂商「${row.providerName}」？`);
  await deleteProvider(row.id);
  ElMessage.success('已删除');
  if (String(currentId.value) === String(row.id)) currentId.value = undefined;
  await loadProviders();
}

async function toggleProvider(row: any) {
  await saveProvider({
    id: row.id,
    providerCode: row.providerCode,
    providerName: row.providerName,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    extraHeaders: row.extraHeaders,
    timeoutSeconds: row.timeoutSeconds,
    supportsStreamUsage: row.supportsStreamUsage,
    enabled: row.enabled === 1 ? 0 : 1,
    scope: row.scope,
    orderNum: row.orderNum,
  });
  await loadProviders();
}

async function onTest(row?: any) {
  const p = row || current.value;
  if (!p?.id) {
    ElMessage.warning('请先选择厂商');
    return;
  }
  const res: any = await testProvider({ providerId: p.id });
  const data = unwrap(res) || {};
  if (data.ok) {
    ElMessage.success(`连通成功${data.reply ? '：' + String(data.reply).slice(0, 80) : ''}`);
  } else {
    ElMessage.error(data.error || '连通失败');
  }
}

async function onFetchRemote() {
  if (!current.value?.id) {
    ElMessage.warning('请先选择厂商');
    return;
  }
  const res: any = await fetchProviderModels({ providerId: current.value.id });
  remoteModels.value = unwrap(res) || [];
  remotePicked.value = remoteModels.value.filter((m) => !m.exists).map((m) => m.modelCode);
  remoteVisible.value = true;
}

async function importRemote() {
  if (!current.value?.id || !remotePicked.value.length) return;
  await batchSaveModels({ providerId: current.value.id, modelCodes: remotePicked.value });
  ElMessage.success('已导入所选模型');
  remoteVisible.value = false;
  await loadModels();
  await loadProviders();
}

function openModel(row?: any) {
  Object.assign(modelDlg.form, {
    id: row?.id,
    providerId: currentId.value,
    modelCode: row?.modelCode || '',
    displayName: row?.displayName || '',
    supportsTools: row?.supportsTools ?? 1,
    supportsReasoning: row?.supportsReasoning ?? 0,
    contextWindow: row?.contextWindow ?? 128000,
    maxOutputTokens: row?.maxOutputTokens ?? 8192,
    defaultTemperature: Number(row?.defaultTemperature ?? 0.2),
    enabled: row?.enabled ?? 1,
    orderNum: row?.orderNum ?? 0,
  });
  modelDlg.visible = true;
}

async function saveModelDlg() {
  if (!modelDlg.form.modelCode || !modelDlg.form.displayName) {
    ElMessage.warning('请填写模型编码和显示名');
    return;
  }
  modelDlg.saving = true;
  try {
    await saveModel({ ...modelDlg.form });
    ElMessage.success('已保存');
    modelDlg.visible = false;
    await loadModels();
  } finally {
    modelDlg.saving = false;
  }
}

async function onDelModel(row: any) {
  await ElMessageBox.confirm(`确认删除模型「${row.displayName}」？`);
  await deleteModel(row.id);
  ElMessage.success('已删除');
  await loadModels();
}

async function onSetDefault(row: any) {
  await setDefaultModel(row.id);
  ElMessage.success('已设为默认模型');
  await loadModels();
}

async function onSelectProvider(row: any) {
  currentId.value = row.id;
  await loadModels();
}
</script>

<template>
  <Page auto-content-height>
    <div class="ai-model-page">
      <div class="bar">
        <ElButton type="primary" @click="onInitBuiltin">初始化内置厂商</ElButton>
        <ElButton @click="openProvider()">新增厂商</ElButton>
        <ElButton :disabled="!current" @click="onFetchRemote">从厂商拉取模型列表</ElButton>
        <ElButton :disabled="!current" @click="onTest()">测试连通</ElButton>
      </div>
      <div class="body">
        <aside v-loading="loading" class="left">
          <div
            v-for="p in providers"
            :key="p.id"
            class="card"
            :class="{ active: String(p.id) === String(currentId) }"
            @click="onSelectProvider(p)"
          >
            <div class="card-title">
              <strong>{{ p.providerName }}</strong>
              <ElTag size="small" :type="p.enabled === 1 ? 'success' : 'info'">
                {{ p.enabled === 1 ? '启用' : '停用' }}
              </ElTag>
            </div>
            <div class="meta">
              {{ p.providerCode }} · {{ p.modelCount || 0 }} 个模型
              <span v-if="p.hasApiKey"> · Key {{ p.apiKeyMasked }}</span>
              <span v-else class="warn"> · 未配置 Key</span>
            </div>
            <div class="ops" @click.stop>
              <ElButton link size="small" @click="openProvider(p)">编辑</ElButton>
              <ElButton link size="small" @click="toggleProvider(p)">
                {{ p.enabled === 1 ? '停用' : '启用' }}
              </ElButton>
              <ElButton link size="small" @click="onTest(p)">测试</ElButton>
              <ElButton
                v-if="p.isBuiltin !== 1"
                link
                size="small"
                type="danger"
                @click="onDelProvider(p)"
              >
                删除
              </ElButton>
            </div>
          </div>
          <ElEmpty v-if="!providers.length" description="暂无厂商，请先初始化或新增" />
        </aside>
        <section class="right">
          <div class="right-bar">
            <span>{{ current?.providerName || '请选择厂商' }}</span>
            <ElButton size="small" type="primary" :disabled="!current" @click="openModel()">
              新增模型
            </ElButton>
          </div>
          <ElTable :data="models" size="small" height="100%" border>
            <ElTableColumn prop="modelCode" label="模型编码" min-width="160" />
            <ElTableColumn prop="displayName" label="显示名" min-width="140" />
            <ElTableColumn label="工具调用" width="90">
              <template #default="{ row }">{{ row.supportsTools === 1 ? '是' : '否' }}</template>
            </ElTableColumn>
            <ElTableColumn label="思考模型" width="90">
              <template #default="{ row }">{{ row.supportsReasoning === 1 ? '是' : '否' }}</template>
            </ElTableColumn>
            <ElTableColumn prop="contextWindow" label="上下文" width="100" />
            <ElTableColumn label="默认" width="70">
              <template #default="{ row }">
                <ElTag v-if="row.isDefault === 1" type="success" size="small">默认</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn label="启用" width="70">
              <template #default="{ row }">{{ row.enabled === 1 ? '是' : '否' }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <ElButton link size="small" @click="openModel(row)">编辑</ElButton>
                <ElButton
                  v-if="row.isDefault !== 1"
                  link
                  size="small"
                  @click="onSetDefault(row)"
                >
                  设为默认
                </ElButton>
                <ElButton link size="small" type="danger" @click="onDelModel(row)">删除</ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
        </section>
      </div>
    </div>

    <ElDialog v-model="providerDlg.visible" :title="providerDlg.form.id ? '编辑厂商' : '新增厂商'" width="560px">
      <ElForm label-width="120px">
        <ElFormItem label="编码" required>
          <ElInput
            v-model="providerDlg.form.providerCode"
            :disabled="providerDlg.form.isBuiltin === 1 || !!providerDlg.form.id"
            placeholder="如 qwen / custom_xxx"
          />
        </ElFormItem>
        <ElFormItem label="名称" required>
          <ElInput v-model="providerDlg.form.providerName" />
        </ElFormItem>
        <ElFormItem label="Base URL" required>
          <ElInput v-model="providerDlg.form.baseUrl" placeholder="https://api.example.com/v1" />
        </ElFormItem>
        <ElFormItem label="API Key">
          <ElInput
            v-model="providerDlg.form.apiKey"
            type="password"
            show-password
            :placeholder="providerDlg.form.apiKeyMasked || '留空则不修改'"
          />
        </ElFormItem>
        <ElFormItem label="额外 Header">
          <ElInput
            v-model="providerDlg.form.extraHeaders"
            type="textarea"
            :rows="2"
            placeholder='JSON 对象，如 {"X-Foo":"bar"}'
          />
        </ElFormItem>
        <ElFormItem label="超时(秒)">
          <ElInputNumber v-model="providerDlg.form.timeoutSeconds" :min="10" :max="600" />
        </ElFormItem>
        <ElFormItem label="stream usage">
          <ElSwitch v-model="streamUsage" />
        </ElFormItem>
        <ElFormItem label="启用">
          <ElSwitch v-model="providerEnabled" />
        </ElFormItem>
        <ElFormItem label="可见范围">
          <ElRadioGroup v-model="providerDlg.form.scope">
            <ElRadio label="USER" value="USER">仅本人</ElRadio>
            <ElRadio label="GLOBAL" value="GLOBAL">全局（需管理员）</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="providerDlg.form.orderNum" :min="0" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="providerDlg.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="providerDlg.saving" @click="saveProviderDlg">保存</ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="modelDlg.visible" :title="modelDlg.form.id ? '编辑模型' : '新增模型'" width="520px">
      <ElForm label-width="120px">
        <ElFormItem label="模型编码" required>
          <ElInput v-model="modelDlg.form.modelCode" :disabled="!!modelDlg.form.id" />
        </ElFormItem>
        <ElFormItem label="显示名" required>
          <ElInput v-model="modelDlg.form.displayName" />
        </ElFormItem>
        <ElFormItem label="支持工具调用">
          <ElSwitch v-model="modelTools" />
        </ElFormItem>
        <ElFormItem label="思考模型">
          <ElSwitch v-model="modelReasoning" />
        </ElFormItem>
        <ElFormItem label="上下文窗口">
          <ElInputNumber v-model="modelDlg.form.contextWindow" :min="1000" :step="1000" />
        </ElFormItem>
        <ElFormItem label="最大输出">
          <ElInputNumber v-model="modelDlg.form.maxOutputTokens" :min="256" />
        </ElFormItem>
        <ElFormItem label="温度">
          <ElInputNumber v-model="modelDlg.form.defaultTemperature" :min="0" :max="2" :step="0.1" />
        </ElFormItem>
        <ElFormItem label="启用">
          <ElSwitch v-model="modelEnabled" />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="modelDlg.form.orderNum" :min="0" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="modelDlg.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="modelDlg.saving" @click="saveModelDlg">保存</ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="remoteVisible" title="从厂商拉取模型" width="480px">
      <ElCheckboxGroup v-model="remotePicked">
        <div v-for="m in remoteModels" :key="m.modelCode" class="remote-row">
          <ElCheckbox :label="m.modelCode" :value="m.modelCode" :disabled="m.exists">
            {{ m.modelCode }}
            <ElTag v-if="m.exists" size="small" type="info">已存在</ElTag>
          </ElCheckbox>
        </div>
      </ElCheckboxGroup>
      <template #footer>
        <ElButton @click="remoteVisible = false">取消</ElButton>
        <ElButton type="primary" :disabled="!remotePicked.length" @click="importRemote">导入所选</ElButton>
      </template>
    </ElDialog>
  </Page>
</template>

<style scoped>
.ai-model-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 480px;
}
.bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  min-height: 0;
}
.left {
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px;
}
.card {
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 8px;
  border: 1px solid var(--el-border-color-lighter);
}
.card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 4px 0;
}
.warn {
  color: var(--el-color-warning);
}
.ops {
  display: flex;
  gap: 4px;
}
.right {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.right-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.remote-row {
  margin: 6px 0;
}
</style>
