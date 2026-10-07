<script lang="ts" setup>
/**
 * 已发布大屏查看页：按容器实际可用区域等比缩放，不受框架顶栏/侧栏有无影响。
 * <p>自动刷新：间隔取 URL `?refresh=秒`（0 关闭）> 大屏配置 viewRefreshSeconds > 快照模式的后台刷新间隔；
 * 实时模式默认关闭。页面不可见时暂停，失败时保留上一份数据并指数退避重试。</p>
 * <p>分享模式（公开路由 /visual/dashboard/share/:token）：免登录，只调用匿名分享接口；支持访问密码、
 * 过期/撤销等状态页，以及嵌入参数 theme / header / fit / refresh。被 iframe 加载时父页面必须是
 * 同源的后端嵌入网关（其响应头按链接配置限制 frame-ancestors），否则拒绝渲染。</p>
 * @author yanch
 */
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';
import type { DashboardMediaPolicy } from './mediaUrlPolicy';

import { useResizeObserver } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

import { runtimeScreen } from '#/api/visual/dashboard';
import { loadPublicShare } from '#/api/visual/dashboardShare';
import ChartRenderer from './components/ChartRenderer.vue';
import { normalizeWidgetLayout } from './assemblyTools';
import {
  clearGrant,
  computeFitTransform,
  formatDateTime,
  isEmbedParentAllowed,
  parseShareDisplayOptions,
  readGrant,
  saveGrant,
  SHARE_TOKEN_PATTERN,
  shareStateView,
} from './shareLink';
import { resolveViewRefreshSeconds } from './viewRefresh';
import { resolveDashboardMediaUrl, toCssUrl } from './mediaUrlPolicy';

defineOptions({ name: 'VisualDashboardView' });

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const bundle = ref<any>();
const viewerRef = ref<HTMLElement>();
/** 以查看容器自身尺寸为准，而不是 window，避免被布局顶栏遮挡后仍按全屏缩放。 */
const viewport = ref({ width: 1, height: 1 });
const loadError = ref('');
const statusVisible = ref(true);
const isFullscreen = ref(false);
let statusHideTimer: number | undefined;
/** 自动刷新：下一次刷新的时间戳、连续失败次数、页面是否被隐藏 */
const nextRefreshAt = ref(0);
const refreshFailures = ref(0);
const refreshError = ref('');
const pageHidden = ref(typeof document !== 'undefined' && document.hidden);
const nowTick = ref(Date.now());
let refreshTimer: number | undefined;
let countdownTimer: number | undefined;
let inFlight = false;
/**
 * 从查询参数读取当前大屏 ID，同时兼容历史动态路由链接中的 id 参数。
 * @author yanch
 */
const screenId = computed(() => {
  const paramId = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const queryId = Array.isArray(route.query.screenId) ? route.query.screenId[0] : route.query.screenId;
  const raw = paramId || queryId;
  const value = raw == null ? '' : String(raw).trim();
  return /^\d+$/.test(value) ? value : '';
});
// ------------------------------------------------------------------ 分享模式
/** 分享令牌（公开路由参数）；格式不对时按「链接不存在」处理，不发请求。 */
const shareToken = computed(() => {
  const raw = Array.isArray(route.params.token) ? route.params.token[0] : route.params.token;
  return raw == null ? '' : String(raw).trim();
});
const shareMode = computed(() => route.name === 'VisualDashboardShare' || route.params.token != null);
const display = computed(() => parseShareDisplayOptions(route.query as Record<string, unknown>));
/** 分享接口返回的状态；OK 以外的状态显示状态页或密码框 */
const shareState = ref('');
const shareMessage = ref('');
const shareRetryAfter = ref(0);
const shareInfo = ref<any>(null);
const password = ref('');
const passwordSubmitting = ref(false);
let memoryGrant = '';
const shareStateInfo = computed(() => shareStateView(shareState.value));
const needPassword = computed(() =>
  shareMode.value && (shareState.value === 'PASSWORD_REQUIRED' || shareState.value === 'PASSWORD_INVALID'),
);
const shareBlocked = computed(() =>
  shareMode.value && !!shareState.value && shareState.value !== 'OK' && !needPassword.value && !bundle.value,
);
const showChrome = computed(() => !shareMode.value || display.value.header);
const themeClass = computed(() => (shareMode.value && display.value.theme ? `theme-${display.value.theme}` : ''));

function grantStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const config = computed(() => bundle.value?.config || { width: 1200, height: 675, widgets: [] });
/** 缩放：普通查看页等比完整显示；分享 / 嵌入可通过 ?fit= 选择铺满、拉伸或按宽度适配。 */
const fit = computed(() => computeFitTransform(
  shareMode.value ? display.value.fit : 'contain',
  viewport.value,
  { width: config.value.width, height: config.value.height },
));
/** 查看页画布背景：背景色 + 可选背景图。 */
const screenStyle = computed(() => {
  const cfg = config.value;
  const { scaleX, scaleY, scroll } = fit.value;
  const style: Record<string, string> = {
    width: `${cfg.width}px`,
    height: `${cfg.height}px`,
    transform: scroll
      ? `translate(-50%, 0) scale(${scaleX}, ${scaleY})`
      : `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`,
    backgroundColor: cfg.background || '#0b1220',
  };
  if (scroll) {
    style.top = '0';
    style.transformOrigin = 'top center';
  }
  const image = resolveDashboardMediaUrl(cfg.backgroundImage, 'image').src;
  if (image) {
    style.backgroundImage = toCssUrl(image);
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center center';
    style.backgroundRepeat = 'no-repeat';
  }
  return style;
});
const letterboxStyle = computed(() => ({
  background: themeClass.value === 'theme-light' ? '#eef2f7' : (config.value.background || '#0b1220'),
}));
/** 按宽度适配时撑开滚动高度 */
const scrollSpacerStyle = computed(() => ({
  height: `${Math.ceil(config.value.height * fit.value.scaleY)}px`,
}));

/** 后端随运行数据下发的媒体策略（内嵌网页域名白名单）。 */
const mediaPolicy = computed<DashboardMediaPolicy | null>(() => bundle.value?.mediaPolicy || null);

/** 当前生效的自动刷新间隔（秒），0 表示关闭。 */
const refreshSeconds = computed(() => {
  const raw = Array.isArray(route.query.refresh) ? route.query.refresh[0] : route.query.refresh;
  return resolveViewRefreshSeconds({
    queryOverride: raw == null ? undefined : String(raw),
    viewRefreshSeconds: bundle.value?.config?.viewRefreshSeconds,
    refreshMode: bundle.value?.refreshMode,
    snapshotIntervalSeconds: bundle.value?.refreshIntervalSeconds,
  });
});

const refreshStatusText = computed(() => {
  if (!refreshSeconds.value) return '';
  if (pageHidden.value) return 'paused';
  const remain = Math.max(0, Math.round((nextRefreshAt.value - nowTick.value) / 1000));
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  return `${mm}:${ss}`;
});

function clearRefreshTimer() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
}

/** 按当前间隔（失败时指数退避，最长 5 分钟或一个间隔）安排下一次后台刷新。 */
function scheduleNextRefresh() {
  clearRefreshTimer();
  const seconds = refreshSeconds.value;
  if (!seconds || pageHidden.value) return;
  const backoff = refreshFailures.value > 0
    ? Math.min(Math.max(seconds, 300), seconds * 2 ** Math.min(refreshFailures.value, 5))
    : seconds;
  const delayMs = backoff * 1000;
  nextRefreshAt.value = Date.now() + delayMs;
  refreshTimer = window.setTimeout(() => void load({ silent: true }), delayMs);
}

function onVisibilityChange() {
  pageHidden.value = document.hidden;
  if (pageHidden.value) {
    clearRefreshTimer();
    return;
  }
  if (!refreshSeconds.value) return;
  // 回到前台时若已过期立即刷新，否则按剩余时间继续计时。
  if (Date.now() >= nextRefreshAt.value) void load({ silent: true });
  else {
    const remain = nextRefreshAt.value - Date.now();
    clearRefreshTimer();
    refreshTimer = window.setTimeout(() => void load({ silent: true }), remain);
  }
}

function resultFor(widgetId: string): QueryResult | undefined {
  const key = bundle.value?.widgetData?.[widgetId] || widgetId;
  return bundle.value?.datasets?.[key];
}

function widgetStyle(widget: any) {
  normalizeWidgetLayout(widget);
  return { left: `${widget.x}px`, top: `${widget.y}px`, width: `${widget.w}px`, height: `${widget.h}px` };
}

/** 测量查看容器的可视区域，有顶栏时只使用内容区高度。 */
function measureViewport() {
  const el = viewerRef.value;
  if (!el) return;
  const width = el.clientWidth || 1;
  const height = el.clientHeight || 1;
  viewport.value = { width, height };
}

/**
 * 拉取运行数据。silent=true 为自动刷新：不盖加载遮罩，失败时保留上一份数据，只在状态条提示。
 */
async function load(options: { silent?: boolean } = {}) {
  if (shareMode.value) {
    await loadShare({ silent: options.silent });
    return;
  }
  const silent = !!options.silent && !!bundle.value;
  if (!screenId.value) {
    loadError.value = '大屏 ID 无效，请返回工作台重新打开';
    return;
  }
  if (inFlight) return;
  inFlight = true;
  clearRefreshTimer();
  if (!silent) {
    loading.value = true;
    loadError.value = '';
  }
  try {
    const response: any = await runtimeScreen(screenId.value);
    const next = response?.data ?? response;
    if (!next?.config) throw new Error('接口未返回有效的大屏配置');
    const widgets = next.config.widgets;
    if (Array.isArray(widgets)) widgets.forEach((item: any) => normalizeWidgetLayout(item));
    bundle.value = next;
    loadError.value = '';
    refreshError.value = '';
    refreshFailures.value = 0;
  }
  catch (error: any) {
    const message = error?.msg || error?.message || '大屏加载失败';
    if (silent) {
      refreshFailures.value += 1;
      refreshError.value = message;
    } else {
      loadError.value = message;
      ElMessage.error(loadError.value);
    }
  }
  finally {
    inFlight = false;
    loading.value = false;
    requestAnimationFrame(measureViewport);
    scheduleNextRefresh();
  }
}

function applyBundle(next: any) {
  if (!next?.config) throw new Error('接口未返回有效的大屏配置');
  const widgets = next.config.widgets;
  if (Array.isArray(widgets)) widgets.forEach((item: any) => normalizeWidgetLayout(item));
  bundle.value = next;
}

/**
 * 分享模式加载：匿名接口统一返回 state。密码验证通过后后端签发短期凭证，存 sessionStorage，
 * 自动刷新时带凭证而不是密码。撤销 / 停用 / 过期在下一次刷新时立即生效（清空画面显示状态页）。
 */
async function loadShare(options: { password?: string; silent?: boolean } = {}) {
  const token = shareToken.value;
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    shareState.value = 'NOT_FOUND';
    shareMessage.value = '';
    return;
  }
  if (shareState.value === 'EMBED_DENIED') return;
  const silent = !!options.silent && !!bundle.value;
  if (inFlight) return;
  inFlight = true;
  clearRefreshTimer();
  if (!silent) loading.value = true;
  let keepSchedule = true;
  try {
    const grant = memoryGrant || readGrant(grantStore(), token);
    const response: any = await loadPublicShare(token, {
      grant: grant || undefined,
      password: options.password || undefined,
      refresh: silent,
    });
    const result = response?.data ?? response;
    const state = String(result?.state || 'UNAVAILABLE');
    shareInfo.value = result?.share || shareInfo.value;
    shareMessage.value = result?.message || '';
    shareRetryAfter.value = Number(result?.retryAfterSeconds) || 0;
    if (state === 'OK') {
      if (result?.grant) {
        memoryGrant = result.grant;
        saveGrant(grantStore(), token, result.grant, Number(result.grantExpiresAt) || 0);
      }
      applyBundle(result.screen);
      shareState.value = 'OK';
      password.value = '';
      refreshError.value = '';
      refreshFailures.value = 0;
      loadError.value = '';
      return;
    }
    if (state === 'PASSWORD_REQUIRED' || state === 'PASSWORD_INVALID') {
      memoryGrant = '';
      clearGrant(grantStore(), token);
      bundle.value = undefined;
      shareState.value = state;
      keepSchedule = false;
      return;
    }
    // 限流 / 暂时不可用：自动刷新时保留上一份画面，只在状态条提示
    if (silent && (state === 'RATE_LIMITED' || state === 'UNAVAILABLE')) {
      refreshFailures.value += 1;
      refreshError.value = shareMessage.value || state;
      return;
    }
    bundle.value = undefined;
    shareState.value = state;
    keepSchedule = false;
  }
  catch (error: any) {
    if (silent) {
      refreshFailures.value += 1;
      refreshError.value = error?.msg || error?.message || '自动刷新失败，稍后重试';
    } else {
      bundle.value = undefined;
      shareState.value = 'UNAVAILABLE';
      shareMessage.value = '';
    }
  }
  finally {
    inFlight = false;
    loading.value = false;
    requestAnimationFrame(measureViewport);
    if (keepSchedule && bundle.value) scheduleNextRefresh();
  }
}

async function submitPassword() {
  const value = password.value;
  if (!value) return;
  passwordSubmitting.value = true;
  try {
    await loadShare({ password: value });
  } finally {
    passwordSubmitting.value = false;
  }
}

function retryShare() {
  shareState.value = '';
  void loadShare();
}

function bumpStatus() {
  statusVisible.value = true;
  if (statusHideTimer != null) window.clearTimeout(statusHideTimer);
  statusHideTimer = window.setTimeout(() => {
    statusVisible.value = false;
  }, 2800);
}

async function toggleFullscreen() {
  const el = viewerRef.value;
  if (!el) return;
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      isFullscreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullscreen.value = false;
    }
  } catch {
    ElMessage.warning('当前环境无法进入全屏');
  }
  bumpStatus();
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
  measureViewport();
}

function goWorkbench() {
  void router.push('/visualDashboard');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    void toggleFullscreen();
  } else if (event.key === 'r' || event.key === 'R') {
    void load({ silent: true });
  }
}

useResizeObserver(viewerRef, () => measureViewport());
onMounted(() => {
  measureViewport();
  // 被 iframe 加载时，只允许经由同源嵌入网关（其 CSP frame-ancestors 已按链接配置校验）
  if (shareMode.value && !isEmbedParentAllowed(window, shareToken.value)) {
    shareState.value = 'EMBED_DENIED';
  }
  void load();
  bumpStatus();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeydown);
  countdownTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeydown);
  if (statusHideTimer != null) window.clearTimeout(statusHideTimer);
  if (countdownTimer != null) window.clearInterval(countdownTimer);
  clearRefreshTimer();
});
</script>

<template>
  <div
    ref="viewerRef"
    class="viewer"
    :class="[themeClass, { scrollable: fit.scroll, 'share-mode': shareMode }]"
    v-loading="loading"
    :style="letterboxStyle"
    @mousemove="bumpStatus"
  >
    <div v-if="needPassword" class="share-card">
      <h3>{{ $tr('该大屏需要访问密码') }}</h3>
      <p v-if="shareState === 'PASSWORD_INVALID'" class="share-error">{{ $tr('访问密码错误') }}</p>
      <form class="share-form" @submit.prevent="submitPassword">
        <ElInput
          v-model="password"
          type="password"
          show-password
          autocomplete="current-password"
          maxlength="64"
          :placeholder="$tr('请输入访问密码')"
        />
        <ElButton type="primary" native-type="submit" :loading="passwordSubmitting" :disabled="!password">{{ $tr('查看') }}</ElButton>
      </form>
    </div>
    <ElResult
      v-else-if="shareBlocked"
      :icon="shareStateInfo.icon"
      :title="$tr(shareStateInfo.title)"
      :sub-title="shareMessage && shareMessage !== shareStateInfo.title ? $tr(shareMessage) : ''"
    >
      <template #extra>
        <p v-if="shareState === 'RATE_LIMITED' && shareRetryAfter" class="share-hint">{{ $tr('请稍后重试，等待秒数') }}: {{ shareRetryAfter }}</p>
        <ElButton v-if="shareStateInfo.retryable" type="primary" @click="retryShare">{{ $tr('重新加载') }}</ElButton>
      </template>
    </ElResult>
    <ElResult v-else-if="loadError && !shareMode" icon="error" :title="$tr('大屏无法显示')" :sub-title="$tr(loadError)">
      <template #extra>
        <ElButton type="primary" @click="load()">{{ $tr('重新加载') }}</ElButton>
        <ElButton @click="goWorkbench">{{ $tr('返回工作台') }}</ElButton>
      </template>
    </ElResult>
    <header v-if="shareMode && showChrome && bundle" class="share-header" :class="{ hidden: !statusVisible }">
      <strong>{{ bundle.screenName || $tr('数据大屏') }}</strong>
      <span>{{ bundle.refreshMode === 'LIVE' ? $tr('实时数据') : $tr('快照数据') }}</span>
      <span v-if="shareInfo?.expireTime">{{ $tr('有效期至') }} {{ formatDateTime(shareInfo.expireTime) }}</span>
    </header>
    <div v-if="bundle && fit.scroll" class="scroll-spacer" :style="scrollSpacerStyle"></div>
    <div v-if="bundle" class="screen" :style="screenStyle">
      <article
        v-for="widget in config.widgets"
        :key="widget.id"
        class="widget"
        :class="{ 'text-like': ['text', 'clock'].includes(widget.chartSpec?.chartType) }"
        :style="widgetStyle(widget)"
      >
        <header v-if="widget.chartSpec.appearance?.showTitle !== false && !['text', 'clock', 'image', 'iframe'].includes(widget.chartSpec.chartType)">
          {{ widget.title }}
        </header>
        <div class="body"><ChartRenderer :spec="widget.chartSpec as ChartSpec" :result="resultFor(widget.id)" :media-policy="mediaPolicy" /></div>
      </article>
    </div>
    <div v-if="showChrome && (!shareMode || bundle)" class="status" :class="{ hidden: !statusVisible && !loadError }">
      <span>{{ bundle?.refreshMode === 'LIVE' ? $tr('实时数据') : ($tr('快照：') + (bundle?.generatedAt || '—')) }}</span>
      <span v-if="bundle?.stale" class="warning" :title="bundle?.lastRefreshError">{{ $tr('刷新失败，正在展示上一份数据') }}</span>
      <span v-if="refreshError" class="warning" :title="refreshError">{{ $tr('自动刷新失败，稍后重试') }}</span>
      <span v-if="refreshSeconds">
        {{ refreshStatusText === 'paused' ? $tr('自动刷新已暂停（页面不可见）') : ($tr('自动刷新') + ' ' + refreshSeconds + 's · ' + $tr('下次') + ' ' + refreshStatusText) }}
      </span>
      <button type="button" @click="load({ silent: true })">{{ bundle?.refreshMode === 'LIVE' ? $tr('刷新数据') : $tr('重新加载') }}</button>
      <button type="button" @click="toggleFullscreen">{{ isFullscreen ? $tr('退出全屏') : $tr('全屏 (F)') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* 填满路由内容区：有框架顶栏时只占内容区，无布局时占满视口，缩放均基于本容器。 */
.viewer {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100dvh;
  max-height: 100%;
  display: grid;
  overflow: hidden;
  color: #dbeafe;
  place-items: center;
  cursor: none;
}
.viewer:hover,
.viewer:focus-within {
  cursor: default;
}
.viewer :deep(.el-result) {
  position: relative;
  z-index: 2;
  padding: 32px;
  background: #ffffffee;
  border-radius: 10px;
}
.screen {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
}
.widget {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #101b2dcc;
  border: 1px solid #30435f;
  border-radius: 5px;
}
.widget.text-like {
  background: transparent;
  border: 0;
}
.widget header {
  display: flex;
  flex: 0 0 30px;
  align-items: center;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 600;
  background: #16243a;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 4px;
}
.widget.text-like .body {
  padding: 0;
}
.status {
  position: absolute;
  right: 12px;
  bottom: 10px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  color: #94a3b8;
  background: #0008;
  border-radius: 5px;
  font-size: 11px;
  transition: opacity 0.25s ease;
}
.status.hidden {
  opacity: 0;
  pointer-events: none;
}
.status button {
  color: #bfdbfe;
  cursor: pointer;
  background: transparent;
  border: 0;
}
.warning {
  color: #fbbf24;
}
/* ---------- 分享 / 嵌入 ---------- */
.viewer.scrollable {
  display: block;
  overflow-x: hidden;
  overflow-y: auto;
}
.scroll-spacer {
  width: 1px;
}
.share-header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  color: #cbd5e1;
  font-size: 12px;
  background: linear-gradient(180deg, #000a, #0000);
  transition: opacity 0.25s ease;
}
.share-header strong {
  color: #f8fafc;
  font-size: 14px;
}
.share-header.hidden {
  opacity: 0;
  pointer-events: none;
}
.share-card {
  position: relative;
  z-index: 4;
  width: min(360px, 90vw);
  padding: 24px;
  color: #1f2937;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px #0005;
  cursor: default;
}
.share-card h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.share-form {
  display: flex;
  gap: 8px;
}
.share-error {
  margin: 0 0 8px;
  color: #dc2626;
  font-size: 13px;
}
.share-hint {
  margin: 0 0 8px;
  color: #64748b;
  font-size: 13px;
}
.viewer.theme-light {
  color: #1e293b;
}
.viewer.theme-light .share-header {
  color: #334155;
  background: linear-gradient(180deg, #fffc, #fff0);
}
.viewer.theme-light .share-header strong {
  color: #0f172a;
}
.viewer.theme-light .status {
  color: #475569;
  background: #fffc;
}
.viewer.theme-light .status button {
  color: #1d4ed8;
}
.viewer.theme-dark .share-card {
  color: #e2e8f0;
  background: #111827;
}
</style>
