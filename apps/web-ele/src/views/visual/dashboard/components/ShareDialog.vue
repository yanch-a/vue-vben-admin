<script lang="ts" setup>
/**
 * 大屏分享链接管理：新建 / 编辑 / 停用 / 撤销，复制链接与 iframe 嵌入代码。
 * <p>匿名访问者看到的是已发布版本；数据以分享创建者（当前所有者）的身份和表级权限获取，默认展示快照。
 * 二维码依赖的库未在本应用中提供，暂不生成。</p>
 * @author yanch
 */
import type {
  ScreenShare,
  ScreenShareOptions,
  ShareDataMode,
} from '#/api/visual/dashboardShare';
import type { EmbedOptions, ExpiryPreset } from '../shareLink';

import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';

import { baseURL } from '#/config';
import {
  getScreenShareOptions,
  listScreenShares,
  refreshScreenShareSnapshot,
  revokeScreenShare,
  saveScreenShare,
  setScreenShareEnabled,
} from '#/api/visual/dashboardShare';
import { translateUiText } from '#/locales/ui-text';

import {
  appPrefixFromHref,
  buildEmbedCode,
  buildEmbedUrl,
  buildShareUrl,
  DEFAULT_EMBED_OPTIONS,
  EXPIRY_PRESETS,
  expiryFromPreset,
  formatDateTime,
  invalidHosts,
  parseHostsText,
  SHARE_FIT_OPTIONS,
  shareStatusMeta,
} from '../shareLink';

defineOptions({ name: 'DashboardShareDialog' });

const props = defineProps<{
  modelValue: boolean;
  screenId?: number | string;
  screenName?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const router = useRouter();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});
const loading = ref(false);
const saving = ref(false);
const shares = ref<ScreenShare[]>([]);
const options = ref<ScreenShareOptions | null>(null);
const showRevoked = ref(false);
const editing = ref(false);
const embedTarget = ref<ScreenShare | null>(null);
const embed = reactive<EmbedOptions>({ ...DEFAULT_EMBED_OPTIONS });
const embedRefreshMode = ref<'custom' | 'default' | 'off'>('default');
const embedRefreshSeconds = ref(60);

const form = reactive({
  allowedHostsText: '',
  clearPassword: false,
  customExpire: null as Date | null,
  dataMode: 'SNAPSHOT' as ShareDataMode,
  expiry: 'never' as ExpiryPreset,
  hasPassword: false,
  id: undefined as string | undefined,
  name: '',
  password: '',
});

const visibleShares = computed(() =>
  showRevoked.value ? shares.value : shares.value.filter((item) => item.status !== 'REVOKED'),
);
const revokedCount = computed(() => shares.value.filter((item) => item.status === 'REVOKED').length);
const screenFollowsSnapshot = computed(() => options.value?.screenRefreshMode === 'INTERVAL_SNAPSHOT');

function tr(text: string) {
  return translateUiText(text);
}

function unwrap<T>(response: any, fallback: T): T {
  const value = response?.data ?? response;
  return (value ?? fallback) as T;
}

async function reload() {
  if (!props.screenId) return;
  loading.value = true;
  try {
    const [list, opts] = await Promise.all([
      listScreenShares(props.screenId),
      getScreenShareOptions(props.screenId),
    ]);
    shares.value = unwrap<ScreenShare[]>(list, []);
    options.value = unwrap<ScreenShareOptions | null>(opts, null);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.screenId] as const,
  ([open]) => {
    if (open) {
      editing.value = false;
      embedTarget.value = null;
      void reload();
    }
  },
  { immediate: true },
);

function appPrefix(token: string) {
  const href = router.resolve({ name: 'VisualDashboardShare', params: { token } }).href;
  return appPrefixFromHref(href, token);
}

function shareUrl(row: ScreenShare) {
  return buildShareUrl(window.location.origin, appPrefix(row.token), row.token);
}

const embedUrl = computed(() => {
  const row = embedTarget.value;
  if (!row) return '';
  const refresh = embedRefreshMode.value === 'default' ? null
    : (embedRefreshMode.value === 'off' ? 0 : embedRefreshSeconds.value);
  return buildEmbedUrl({
    apiBase: baseURL,
    appPrefix: appPrefix(row.token),
    options: { ...embed, refresh },
    origin: window.location.origin,
    token: row.token,
  });
});
const embedCode = computed(() => (embedUrl.value ? buildEmbedCode(embedUrl.value, embed) : ''));

async function copyText(text: string, okMessage: string) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // 内网 http 环境没有 Clipboard API，退回到选中文本复制
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) throw new Error('copy failed');
    }
    ElMessage.success(tr(okMessage));
  } catch {
    ElMessage.warning(tr('复制失败，请手动选中复制'));
  }
}

function openCreate() {
  Object.assign(form, {
    allowedHostsText: '',
    clearPassword: false,
    customExpire: null,
    dataMode: 'SNAPSHOT',
    expiry: 'never',
    hasPassword: false,
    id: undefined,
    name: '',
    password: '',
  });
  embedTarget.value = null;
  editing.value = true;
}

function openEdit(row: ScreenShare) {
  Object.assign(form, {
    allowedHostsText: (row.allowedHosts || []).join('\n'),
    clearPassword: false,
    customExpire: row.expireTime ? new Date(row.expireTime) : null,
    dataMode: row.dataMode,
    expiry: row.expireTime ? 'custom' : 'never',
    hasPassword: row.passwordProtected,
    id: row.id,
    name: row.name || '',
    password: '',
  });
  embedTarget.value = null;
  editing.value = true;
}

async function submit() {
  const hosts = parseHostsText(form.allowedHostsText);
  const bad = invalidHosts(hosts);
  if (bad.length > 0) {
    ElMessage.error(`${tr('允许嵌入的站点格式不正确')}: ${bad.join(', ')}`);
    return;
  }
  if (form.password && (form.password.length < 4 || form.password.length > 64)) {
    ElMessage.error(tr('访问密码长度需为 4~64 位'));
    return;
  }
  const expireTime = expiryFromPreset(form.expiry, Date.now(), form.customExpire?.getTime() ?? null);
  if (form.expiry === 'custom' && !expireTime) {
    ElMessage.error(tr('过期时间必须晚于当前时间'));
    return;
  }
  saving.value = true;
  try {
    await saveScreenShare({
      allowedHosts: hosts,
      clearPassword: form.clearPassword,
      dataMode: form.dataMode,
      expireTime,
      id: form.id,
      name: form.name.trim(),
      password: form.password || undefined,
      screenId: form.id ? undefined : String(props.screenId),
    });
    ElMessage.success(tr(form.id ? '分享链接已更新' : '分享链接已创建'));
    editing.value = false;
    await reload();
  } finally {
    saving.value = false;
  }
}

async function toggle(row: ScreenShare) {
  const enable = row.status !== 'ACTIVE';
  await setScreenShareEnabled(row.id, enable);
  ElMessage.success(tr(enable ? '分享链接已启用' : '分享链接已停用'));
  await reload();
}

async function revoke(row: ScreenShare) {
  await ElMessageBox.confirm(
    tr('撤销后该链接与已发出的嵌入代码立即失效且无法恢复，确定撤销？'),
    tr('撤销分享链接'),
    { type: 'warning', confirmButtonText: tr('撤销'), cancelButtonText: tr('取消') },
  );
  await revokeScreenShare(row.id);
  ElMessage.success(tr('分享链接已撤销'));
  if (embedTarget.value?.id === row.id) embedTarget.value = null;
  await reload();
}

async function refreshSnapshot(row: ScreenShare) {
  await refreshScreenShareSnapshot(row.id);
  ElMessage.success(tr('分享快照已更新'));
  await reload();
}

function openEmbed(row: ScreenShare) {
  editing.value = false;
  embedTarget.value = row;
}

function dataModeText(row: ScreenShare) {
  if (row.dataMode === 'LIVE') return tr('实时数据');
  return screenFollowsSnapshot.value ? tr('快照（跟随大屏）') : tr('快照');
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('分享大屏') + (screenName ? ' · ' + screenName : '')"
    width="min(1080px, 96vw)"
    destroy-on-close
  >
    <div v-loading="loading" class="share-dialog">
      <ElAlert type="info" :closable="false" show-icon class="intro">
        <template #title>
          {{ $tr('任何拿到链接的人无需登录即可查看已发布版本；数据以你的身份和表级权限获取，默认展示快照，不会暴露 SQL 与连接信息。') }}
        </template>
      </ElAlert>
      <ElAlert v-if="options && !options.enabled" type="warning" :closable="false" show-icon :title="$tr('系统未开启大屏分享')" />
      <ElAlert v-else-if="options && !options.published" type="warning" :closable="false" show-icon :title="$tr('大屏尚未发布，不能分享')" />

      <div class="toolbar">
        <ElButton type="primary" :disabled="!options?.enabled || !options?.published" @click="openCreate">{{ $tr('新建分享链接') }}</ElButton>
        <ElCheckbox v-if="revokedCount" v-model="showRevoked">{{ $tr('显示已撤销') }} ({{ revokedCount }})</ElCheckbox>
        <span class="muted">{{ $tr('二维码：当前环境未提供二维码组件，可复制链接后自行生成') }}</span>
      </div>

      <ElTable :data="visibleShares" size="small" :empty-text="$tr('还没有分享链接')" class="share-table">
        <ElTableColumn :label="$tr('名称')" min-width="150">
          <template #default="{ row }">
            <div class="name-cell">
              <span>{{ row.name || $tr('未命名链接') }}</span>
              <ElTag size="small" :type="shareStatusMeta(row.effectiveStatus).type">{{ $tr(shareStatusMeta(row.effectiveStatus).label) }}</ElTag>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('数据')" width="130">
          <template #default="{ row }">
            <div>{{ dataModeText(row) }}</div>
            <small v-if="row.dataMode === 'SNAPSHOT' && row.snapshotTime" class="muted">{{ formatDateTime(row.snapshotTime) }}</small>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('访问密码')" width="90">
          <template #default="{ row }">{{ row.passwordProtected ? $tr('已设置') : $tr('无') }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('过期时间')" width="140">
          <template #default="{ row }">{{ row.expireTime ? formatDateTime(row.expireTime) : $tr('永久有效') }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('浏览 / 拒绝')" width="100">
          <template #default="{ row }">{{ row.viewCount }} / {{ row.deniedCount }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('最后访问')" width="140">
          <template #default="{ row }">{{ formatDateTime(row.lastAccessTime) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('操作')" min-width="250" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status !== 'REVOKED'">
              <ElButton link type="primary" @click="copyText(shareUrl(row), '链接已复制')">{{ $tr('复制链接') }}</ElButton>
              <ElButton link type="primary" @click="openEmbed(row)">{{ $tr('嵌入代码') }}</ElButton>
              <ElButton link @click="openEdit(row)">{{ $tr('编辑') }}</ElButton>
              <ElButton link @click="toggle(row)">{{ row.status === 'ACTIVE' ? $tr('停用链接') : $tr('启用链接') }}</ElButton>
              <ElButton v-if="row.dataMode === 'SNAPSHOT' && !screenFollowsSnapshot" link @click="refreshSnapshot(row)">{{ $tr('更新分享快照') }}</ElButton>
              <ElButton link type="danger" @click="revoke(row)">{{ $tr('撤销') }}</ElButton>
            </template>
            <span v-else class="muted">{{ $tr('已撤销') }} {{ formatDateTime(row.revokeTime) }}</span>
          </template>
        </ElTableColumn>
      </ElTable>

      <section v-if="editing" class="panel">
        <h4>{{ form.id ? $tr('编辑分享链接') : $tr('新建分享链接') }}</h4>
        <ElForm label-width="120px" size="small">
          <ElFormItem :label="$tr('链接名称')">
            <ElInput v-model="form.name" maxlength="64" show-word-limit :placeholder="$tr('例如：大厅投屏 / 合作方门户')" />
          </ElFormItem>
          <ElFormItem :label="$tr('数据')">
            <ElRadioGroup v-model="form.dataMode">
              <ElRadio value="SNAPSHOT">{{ screenFollowsSnapshot ? $tr('快照（跟随大屏定时快照）') : $tr('快照（创建时生成，可手动更新）') }}</ElRadio>
              <ElRadio value="LIVE" :disabled="!options?.allowLive">{{ $tr('实时数据（以你的身份查询）') }}</ElRadio>
            </ElRadioGroup>
            <div v-if="options && !options.allowLive && options.liveRefusedReason" class="muted">{{ $tr(options.liveRefusedReason) }}</div>
          </ElFormItem>
          <ElFormItem :label="$tr('有效期')">
            <ElSelect v-model="form.expiry" style="width: 160px">
              <ElOption v-for="item in EXPIRY_PRESETS" :key="item.value" :label="$tr(item.label)" :value="item.value" />
            </ElSelect>
            <ElDatePicker v-if="form.expiry === 'custom'" v-model="form.customExpire" type="datetime" class="ml" :placeholder="$tr('选择过期时间')" />
          </ElFormItem>
          <ElFormItem :label="$tr('访问密码')">
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              autocomplete="new-password"
              style="width: 260px"
              :placeholder="form.hasPassword ? $tr('留空则保持原密码') : $tr('可选，4~64 位')"
            />
            <ElCheckbox v-if="form.hasPassword" v-model="form.clearPassword" class="ml">{{ $tr('取消密码') }}</ElCheckbox>
          </ElFormItem>
          <ElFormItem :label="$tr('允许嵌入的站点')">
            <ElInput
              v-model="form.allowedHostsText"
              type="textarea"
              :rows="3"
              :placeholder="$tr('每行一个，例如 portal.example.com、*.corp.local、https://bi.example.com:8443；留空则不允许外站嵌入')"
            />
          </ElFormItem>
          <ElFormItem>
            <ElButton type="primary" :loading="saving" @click="submit">{{ $tr('保存') }}</ElButton>
            <ElButton @click="editing = false">{{ $tr('取消') }}</ElButton>
          </ElFormItem>
        </ElForm>
      </section>

      <section v-if="embedTarget" class="panel">
        <h4>{{ $tr('嵌入代码') }} · {{ embedTarget.name || $tr('未命名链接') }}</h4>
        <ElAlert
          v-if="!embedTarget.allowedHosts?.length"
          type="warning"
          :closable="false"
          show-icon
          :title="$tr('该链接未配置允许嵌入的站点，外站 iframe 会被浏览器拦截；请先编辑链接添加站点。')"
        />
        <ElForm label-width="120px" size="small" class="embed-form">
          <ElFormItem :label="$tr('主题')">
            <ElRadioGroup v-model="embed.theme">
              <ElRadio value="">{{ $tr('默认') }}</ElRadio>
              <ElRadio value="dark">{{ $tr('深色') }}</ElRadio>
              <ElRadio value="light">{{ $tr('浅色') }}</ElRadio>
            </ElRadioGroup>
          </ElFormItem>
          <ElFormItem :label="$tr('显示标题栏')">
            <ElSwitch v-model="embed.header" />
          </ElFormItem>
          <ElFormItem :label="$tr('自动刷新')">
            <ElRadioGroup v-model="embedRefreshMode">
              <ElRadio value="default">{{ $tr('跟随大屏配置') }}</ElRadio>
              <ElRadio value="off">{{ $tr('不自动刷新') }}</ElRadio>
              <ElRadio value="custom">{{ $tr('自定义') }}</ElRadio>
            </ElRadioGroup>
            <ElInputNumber v-if="embedRefreshMode === 'custom'" v-model="embedRefreshSeconds" :min="10" :max="86400" class="ml" />
            <span v-if="embedRefreshMode === 'custom'" class="muted ml">{{ $tr('秒') }}</span>
          </ElFormItem>
          <ElFormItem :label="$tr('缩放方式')">
            <ElSelect v-model="embed.fit" style="width: 220px">
              <ElOption v-for="item in SHARE_FIT_OPTIONS" :key="item.value" :label="$tr(item.label)" :value="item.value" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem :label="$tr('宽 / 高')">
            <ElInput v-model="embed.width" style="width: 110px" />
            <span class="ml">×</span>
            <ElInput v-model="embed.height" style="width: 110px" class="ml" />
          </ElFormItem>
          <ElFormItem :label="$tr('嵌入代码')">
            <ElInput :model-value="embedCode" type="textarea" :rows="3" readonly />
          </ElFormItem>
          <ElFormItem>
            <ElButton type="primary" @click="copyText(embedCode, '嵌入代码已复制')">{{ $tr('复制嵌入代码') }}</ElButton>
            <ElButton @click="copyText(embedUrl, '链接已复制')">{{ $tr('复制嵌入地址') }}</ElButton>
            <ElButton @click="embedTarget = null">{{ $tr('关闭') }}</ElButton>
          </ElFormItem>
        </ElForm>
      </section>
    </div>
  </ElDialog>
</template>

<style scoped>
.share-dialog { display: flex; flex-direction: column; gap: 10px; min-height: 240px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.name-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.panel { padding: 12px 14px; background: var(--el-fill-color-lighter); border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.panel h4 { margin: 0 0 10px; font-size: 14px; }
.ml { margin-left: 8px; }
.embed-form { margin-top: 10px; }
</style>
