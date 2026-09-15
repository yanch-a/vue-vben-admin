<script lang="ts" setup>
/**
 * 已发布大屏查看页：不显示管理布局，按设计尺寸等比缩放到当前窗口。
 * @author yanch
 */
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';

import { runtimeScreen } from '#/api/visual/dashboard';
import ChartRenderer from './components/ChartRenderer.vue';

defineOptions({ name: 'VisualDashboardView' });

const route = useRoute();
const loading = ref(false);
const bundle = ref<any>();
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const loadError = ref('');
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
const scale = computed(() => Math.min(viewport.value.width / config.value.width, viewport.value.height / config.value.height));

function resultFor(widgetId: string): QueryResult | undefined {
  const key = bundle.value?.widgetData?.[widgetId] || widgetId;
  return bundle.value?.datasets?.[key];
}

function widgetStyle(widget: any) {
  return { left: `${widget.x}px`, top: `${widget.y}px`, width: `${widget.w}px`, height: `${widget.h}px` };
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
  }
  catch (error: any) {
    loadError.value = error?.msg || error?.message || '大屏加载失败';
    ElMessage.error(loadError.value);
  }
  finally { loading.value = false; }
}

function resize() { viewport.value = { width: window.innerWidth, height: window.innerHeight }; }
onMounted(() => { window.addEventListener('resize', resize); void load(); });
onBeforeUnmount(() => window.removeEventListener('resize', resize));
</script>

<template>
  <div class="viewer" v-loading="loading" :style="{ background: config.background || '#0b1220' }">
    <ElResult v-if="loadError" icon="error" title="大屏无法显示" :sub-title="loadError">
      <template #extra><ElButton type="primary" @click="load">重新加载</ElButton></template>
    </ElResult>
    <div v-if="bundle" class="screen" :style="{ width: `${config.width}px`, height: `${config.height}px`, transform: `translate(-50%, -50%) scale(${scale})` }">
      <article v-for="widget in config.widgets" :key="widget.id" class="widget" :style="widgetStyle(widget)">
        <header v-if="widget.chartSpec.appearance?.showTitle !== false">{{ widget.title }}</header>
        <div class="body"><ChartRenderer :spec="widget.chartSpec as ChartSpec" :result="resultFor(widget.id)" /></div>
      </article>
    </div>
    <div class="status">
      <span>{{ bundle?.refreshMode === 'LIVE' ? '实时数据' : `快照：${bundle?.generatedAt || '—'}` }}</span>
      <span v-if="bundle?.stale" class="warning" :title="bundle?.lastRefreshError">刷新失败，正在展示上一份数据</span>
      <button @click="load">{{ bundle?.refreshMode === 'LIVE' ? '刷新数据' : '重新加载' }}</button>
    </div>
  </div>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; display: grid; overflow: hidden; color: #dbeafe; place-items: center; }
.viewer :deep(.el-result) { position: relative; z-index: 2; padding: 32px; background: #ffffffee; border-radius: 10px; }
.screen { position: absolute; top: 50%; left: 50%; transform-origin: center center; }
.widget { position: absolute; display: flex; flex-direction: column; overflow: hidden; background: #101b2dcc; border: 1px solid #30435f; border-radius: 5px; }
.widget header { display: flex; flex: 0 0 30px; align-items: center; padding: 0 9px; font-size: 12px; font-weight: 600; background: #16243a; }.body { flex: 1; min-height: 0; padding: 4px; }
.status { position: fixed; right: 12px; bottom: 10px; display: flex; align-items: center; gap: 10px; padding: 5px 8px; color: #94a3b8; background: #0008; border-radius: 5px; font-size: 11px; }.status button { color: #bfdbfe; cursor: pointer; background: transparent; border: 0; }.warning { color: #fbbf24; }
</style>
