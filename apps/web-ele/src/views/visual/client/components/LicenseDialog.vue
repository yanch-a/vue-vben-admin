<script lang="ts" setup>
/**
 * License 状态 / 导入
 * - 试用期：仅提示剩余天数，不阻断
 * - 试用结束：强制导入 License
 * @author yanch
 */
import { computed, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import {
  getLicenseStatus,
  installLicense,
} from '#/api/visual/license';

defineOptions({ name: 'LicenseDialog' });

const visible = defineModel<boolean>({ default: false });

const props = defineProps<{
  /** 是否因未授权被强制打开（试用结束） */
  force?: boolean;
}>();

const emit = defineEmits<{
  activated: [];
}>();

const loading = ref(false);
const saving = ref(false);
const status = ref<Record<string, any> | null>(null);
const content = ref('');

const allowed = computed(() => !!status.value?.allowed);
const mode = computed(() => String(status.value?.mode || ''));
const isTrial = computed(() => mode.value === 'TRIAL');
const needLicense = computed(
  () => !allowed.value && (mode.value === 'EXPIRED' || mode.value === 'TAMPERED'),
);

async function refresh() {
  loading.value = true;
  try {
    const res: any = await getLicenseStatus();
    status.value = res?.data || res || null;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '获取授权状态失败');
  } finally {
    loading.value = false;
  }
}

async function onInstall() {
  const text = content.value.trim();
  if (!text) {
    ElMessage.warning('请粘贴 License 内容');
    return;
  }
  saving.value = true;
  try {
    const res: any = await installLicense(text);
    status.value = res?.data || res || null;
    if (status.value?.allowed) {
      ElMessage.success('授权已生效');
      content.value = '';
      emit('activated');
      if (!props.force) visible.value = false;
      else if (status.value.allowed) visible.value = false;
    } else {
      ElMessage.warning(status.value?.message || '授权未通过');
    }
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导入失败');
  } finally {
    saving.value = false;
  }
}

async function copyMachineId() {
  const id = String(status.value?.machineId || '');
  if (!id) {
    ElMessage.warning('暂无机器码');
    return;
  }
  try {
    await navigator.clipboard.writeText(id);
    ElMessage.success('机器码已复制');
  } catch {
    ElMessage.info(id);
  }
}

watch(visible, (v) => {
  if (v) void refresh();
});
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="needLicense ? '试用已结束，请导入 License' : '产品授权'"
    width="560px"
    :close-on-click-modal="!force && !needLicense"
    :close-on-press-escape="!force && !needLicense"
    :show-close="!force && !needLicense"
    append-to-body
    destroy-on-close
  >
    <div v-loading="loading" class="license-body">
      <ElAlert
        v-if="isTrial"
        type="info"
        :closable="false"
        show-icon
        :title="`试用中：剩余约 ${status?.trialRemainingDays ?? '-'} 天（无需 License，可直接使用）`"
      />
      <ElAlert
        v-else-if="mode === 'LICENSED'"
        type="success"
        :closable="false"
        show-icon
        :title="status?.message || '正式授权有效'"
      />
      <ElAlert
        v-else-if="needLicense"
        type="error"
        :closable="false"
        show-icon
        :title="status?.message || '试用已结束，请导入正式 License'"
      />
      <ElAlert
        v-else
        type="warning"
        :closable="false"
        show-icon
        :title="status?.message || '授权状态未知'"
      />

      <div class="row">
        <span class="label">机器码</span>
        <code class="mid">{{ status?.machineId || '-' }}</code>
        <ElButton link type="primary" @click="copyMachineId">复制</ElButton>
      </div>
      <p class="hint">
        试用期无需机器码。购买绑机授权时，把机器码发给厂商即可；也可申请不绑机 License。
      </p>

      <ElInput
        v-model="content"
        type="textarea"
        :rows="8"
        placeholder="粘贴厂商提供的 License JSON（.lic 文件内容）"
      />
    </div>
    <template #footer>
      <ElButton v-if="!force && !needLicense" @click="visible = false">关闭</ElButton>
      <ElButton :loading="loading" @click="refresh">刷新状态</ElButton>
      <ElButton type="primary" :loading="saving" @click="onInstall">导入并激活</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.license-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.label {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.mid {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
