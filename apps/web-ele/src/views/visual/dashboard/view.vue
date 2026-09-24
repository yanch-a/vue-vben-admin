<script lang="ts" setup>
/**
 * 已发布大屏查看页：按容器实际可用区域等比缩放，不受框架顶栏/侧栏有无影响。
 * @author yanch
 */
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';

import { useResizeObserver } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

import { runtimeScreen } from '#/api/visual/dashboard';
import { resolveBackendAssetUrl } from '#/config';
import ChartRenderer from './components/ChartRenderer.vue';
import { normalizeWidgetLayout } from './assemblyTools';

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
const config = computed(() => bundle.value?.config || { width: 1200, height: 675, widgets: [] });
const scale = computed(() =>
  Math.min(viewport.value.width / config.value.width, viewport.value.height / config.value.height),
);
/** 查看页画布背景：背景色 + 可选背景图。 */
const screenStyle = computed(() => {
  const cfg = config.value;
  const style: Record<string, string> = {
    width: `${cfg.width}px`,
    height: `${cfg.height}px`,
    transform: `translate(-50%, -50%) scale(${scale.value})`,
    backgroundColor: cfg.background || '#0b1220',
  };
  const image = resolveBackendAssetUrl(cfg.backgroundImage);
  if (image) {
    style.backgroundImage = `url("${image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center center';
    style.backgroundRepeat = 'no-repeat';
  }
  return style;
});
const letterboxStyle = computed(() => ({
  background: config.value.background || '#0b1220',
}));

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

async function load() {
  if (!screenId.value) {
    loadError.value = '大屏 ID 无效，请返回工作台重新打开';
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    const response: any = await runtimeScreen(screenId.value);
    bundle.value = response?.data ?? response;
    if (!bundle.value?.config) throw new Error('接口未返回有效的大屏配置');
    const widgets = bundle.value.config.widgets;
    if (Array.isArray(widgets)) widgets.forEach((item: any) => normalizeWidgetLayout(item));
  }
  catch (error: any) {
    loadError.value = error?.msg || error?.message || '大屏加载失败';
    ElMessage.error(loadError.value);
  }
  finally {
    loading.value = false;
    requestAnimationFrame(measureViewport);
  }
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
    void load();
  }
}

useResizeObserver(viewerRef, () => measureViewport());
onMounted(() => {
  measureViewport();
  void load();
  bumpStatus();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('keydown', onKeydown);
  if (statusHideTimer != null) window.clearTimeout(statusHideTimer);
});
</script>

<template>
  <div
    ref="viewerRef"
    class="viewer"
    v-loading="loading"
    :style="letterboxStyle"
    @mousemove="bumpStatus"
  >
    <ElResult v-if="loadError" icon="error" title="大屏无法显示" :sub-title="loadError">
      <template #extra>
        <ElButton type="primary" @click="load">重新加载</ElButton>
        <ElButton @click="goWorkbench">返回工作台</ElButton>
      </template>
    </ElResult>
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
        <div class="body"><ChartRenderer :spec="widget.chartSpec as ChartSpec" :result="resultFor(widget.id)" /></div>
      </article>
    </div>
    <div class="status" :class="{ hidden: !statusVisible && !loadError }">
      <span>{{ bundle?.refreshMode === 'LIVE' ? '实时数据' : `快照：${bundle?.generatedAt || '—'}` }}</span>
      <span v-if="bundle?.stale" class="warning" :title="bundle?.lastRefreshError">刷新失败，正在展示上一份数据</span>
      <button type="button" @click="load">{{ bundle?.refreshMode === 'LIVE' ? '刷新数据' : '重新加载' }}</button>
      <button type="button" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏 (F)' }}</button>
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
</style>
