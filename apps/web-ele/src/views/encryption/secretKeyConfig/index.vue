<script lang="ts" setup>
/** 传输加密管理：复用旧菜单组件路径与权限编码。 @author yanch */
import type { EncryptionSettings } from '#/api/system/transportEncryption';

import { computed, onMounted, ref } from 'vue';
import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getEncryptionSettings,
  rotateEncryptionKey,
  setEncryptionEnabled,
} from '#/api/system/transportEncryption';
import { translateUiText as tr } from '#/locales/ui-text';

defineOptions({ name: 'SecretKeyConfig' });

const { hasAccessByCodes } = useAccess();
const settings = ref<EncryptionSettings>();
const enabled = ref(false);
const loading = ref(false);
const saving = ref(false);
const rotating = ref(false);
const loadFailed = ref(false);
const supportsCrypto = !!globalThis.crypto?.subtle;
const busy = computed(() => loading.value || saving.value || rotating.value);
const dirty = computed(
  () =>
    settings.value !== undefined && enabled.value !== settings.value.enabled,
);
const canView = computed(() => hasAccessByCodes(['SecretKeyConfig:info']));
const canUpdate = computed(() => hasAccessByCodes(['SecretKeyConfig:update']));
const canRotate = computed(() =>
  hasAccessByCodes(['SecretKeyConfig:rotateKey']),
);

/** 只有服务端保存成功后才更新已生效状态。 */
function applySettings(value: EncryptionSettings) {
  settings.value = value;
  enabled.value = value.enabled;
  loadFailed.value = false;
}

/** 加载失败保留重试入口，不把未加载状态显示为已关闭。 */
async function loadSettings() {
  if (!canView.value || busy.value) return;
  loading.value = true;
  try {
    applySettings(await getEncryptionSettings());
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

/** 开关先编辑后保存，关闭操作给出明文传输影响说明。 */
async function saveSettings() {
  if (!settings.value || !dirty.value || busy.value || !canUpdate.value) return;
  if (!enabled.value) {
    try {
      await ElMessageBox.confirm(
        tr('关闭后，后续普通接口将恢复明文传输。是否继续？'),
        tr('关闭传输加密'),
        {
          type: 'warning',
          confirmButtonText: tr('确认关闭'),
          cancelButtonText: tr('取消'),
        },
      );
    } catch {
      return;
    }
  }
  saving.value = true;
  try {
    applySettings(await setEncryptionEnabled(enabled.value));
    ElMessage.success(tr('加密配置已生效'));
  } catch {
    // 请求拦截器统一提示失败；保留未保存状态，允许重试。
  } finally {
    saving.value = false;
  }
}

/** 轮换先确认；已编辑但未保存的开关不能被轮换响应静默覆盖。 */
async function rotateKey() {
  if (!settings.value || busy.value || dirty.value || !canRotate.value) return;
  try {
    await ElMessageBox.confirm(
      tr(
        '新密钥将立即替换当前密钥，开关状态保持不变。在途旧密钥请求可能需要重试。',
      ),
      tr(settings.value.keyReady ? '轮换传输密钥' : '生成传输密钥'),
      {
        type: 'warning',
        confirmButtonText: tr('确认生成'),
        cancelButtonText: tr('取消'),
      },
    );
  } catch {
    return;
  }
  rotating.value = true;
  try {
    applySettings(await rotateEncryptionKey());
    ElMessage.success(tr('传输密钥已更新'));
  } catch {
    // 请求拦截器统一提示失败，不更新页面中的现有密钥信息。
  } finally {
    rotating.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <Page
    :title="$tr('传输加密')"
    :description="$tr('管理普通接口的请求参数和响应加密，配置保存后自动生效。')"
  >
    <div class="encryption-settings" v-loading="loading">
      <el-result
        v-if="!canView"
        icon="warning"
        :title="$tr('无权查看加密配置')"
      />
      <el-result
        v-else-if="loadFailed"
        icon="error"
        :title="$tr('加载加密配置失败')"
      >
        <template #extra
          ><el-button @click="loadSettings">{{
            $tr('重试')
          }}</el-button></template
        >
      </el-result>
      <template v-else-if="settings">
        <div class="settings-heading">
          <div>
            <h2>{{ $tr('传输状态') }}</h2>
            <p>
              {{ $tr('上传、下载、附件、表单和流式请求始终保持原传输方式。') }}
            </p>
          </div>
          <el-tag :type="settings.enabled ? 'success' : 'info'">
            {{ $tr(settings.enabled ? '加密已启用' : '加密已关闭') }}
          </el-tag>
        </div>
        <el-form label-position="top" class="settings-form">
          <el-alert
            v-if="!supportsCrypto"
            :title="
              $tr(
                '当前浏览器无法启用安全加密，请通过 HTTPS 或 localhost 打开后再启用。',
              )
            "
            type="warning"
            :closable="false"
            show-icon
          />
          <el-form-item :label="$tr('启用传输加密')">
            <div>
              <el-switch
                v-model="enabled"
                :disabled="
                  busy ||
                  !canUpdate ||
                  (!settings.keyReady && !settings.enabled) ||
                  (!supportsCrypto && !settings.enabled)
                "
                :aria-label="$tr('启用传输加密')"
              />
              <p class="field-help">
                {{ $tr('浏览器启用加密需要 HTTPS 或 localhost 安全环境。') }}
              </p>
            </div>
          </el-form-item>
          <el-alert
            v-if="!settings.keyReady"
            :title="$tr('尚未配置密钥，请先生成传输密钥。')"
            type="warning"
            :closable="false"
            show-icon
          />
          <div class="settings-actions">
            <el-button
              v-if="canUpdate"
              type="primary"
              :loading="saving"
              :disabled="busy || !dirty || (!settings.keyReady && enabled)"
              @click="saveSettings"
            >
              {{ $tr('保存配置') }}
            </el-button>
            <el-button :disabled="busy" @click="loadSettings">{{
              $tr('刷新状态')
            }}</el-button>
            <span v-if="dirty" class="field-help" role="status">{{
              $tr('有未保存的修改')
            }}</span>
          </div>
        </el-form>
        <el-divider />
        <div class="settings-heading">
          <div>
            <h2>{{ $tr('传输密钥') }}</h2>
            <p>
              {{ $tr('私钥仅保存在服务器，页面只展示公钥及 SHA-256 指纹。') }}
            </p>
          </div>
          <el-button
            v-if="canRotate"
            :loading="rotating"
            :disabled="busy || dirty"
            @click="rotateKey"
          >
            {{ $tr(settings.keyReady ? '轮换密钥' : '生成密钥') }}
          </el-button>
        </div>
        <el-descriptions :column="1" :label-width="100" border>
          <el-descriptions-item :label="$tr('加密算法')">{{
            settings.algorithm
          }}</el-descriptions-item>
          <el-descriptions-item :label="$tr('公钥指纹')"
            ><code class="key-fingerprint">{{
              settings.keyId || '—'
            }}</code></el-descriptions-item
          >
          <el-descriptions-item :label="$tr('更新时间')">{{
            settings.updatedAt || '—'
          }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-position="top" class="public-key-form">
          <el-form-item :label="$tr('服务端公钥')">
            <el-input
              :model-value="settings.publicKey || ''"
              type="textarea"
              :rows="5"
              resize="vertical"
              readonly
              :aria-label="$tr('服务端公钥')"
            />
          </el-form-item>
        </el-form>
      </template>
    </div>
  </Page>
</template>

<style scoped>
.encryption-settings {
  max-width: 960px;
  padding: 24px;
  border-radius: 8px;
  background: var(--el-bg-color);
}
.settings-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.settings-heading h2 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}
.settings-heading > :deep(.el-tag),
.settings-heading > :deep(.el-button) {
  flex-shrink: 0;
}
.settings-heading p,
.field-help {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.settings-heading p {
  margin: 0 0 20px;
}
.settings-form {
  margin-top: 8px;
}
.settings-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}
.settings-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.public-key-form {
  margin-top: 24px;
}
.key-fingerprint {
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .encryption-settings {
    padding: 16px;
  }
  .settings-heading {
    flex-wrap: wrap;
  }
}
</style>
