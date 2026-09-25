<script lang="ts" setup>
/**
 * 图表统一渲染器：AI 对话、图表库、大屏编辑器和大屏查看页共用相同表现。
 * @author yanch
 */
import type { EchartsUIType } from '@vben/plugins/echarts';
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
import { useDebounceFn, useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { resolveBackendAssetUrl } from '#/config';
import { chartSpecToOption } from '../../client/utils/chartSpecToOption';

defineOptions({ name: 'DashboardChartRenderer' });
const emit = defineEmits<{
  error: [message: string];
  rendering: [value: boolean];
}>();

const props = defineProps<{
  result?: Partial<QueryResult>;
  spec: ChartSpec;
}>();

const chartRef = ref<EchartsUIType>();
const rootRef = ref<HTMLElement>();
const chartSize = ref({ width: 420, height: 230 });
const renderError = ref('');
const clockText = ref('');
let clockTimer: number | undefined;
const { renderEcharts, resize } = useEcharts(chartRef);
const columns = computed(() => props.result?.columns || []);
const rows = computed(() => props.result?.rows || []);
/**
 * Soft-fail 才应盖住图表：后端成功也会写 message（如 Query OK / row(s) returned），
 * 不能当成错误遮罩。
 */
function isBenignQueryMessage(message: string): boolean {
  const s = message.trim();
  if (!s) return true;
  if (/^Query OK\b/i.test(s)) return true;
  if (/\brow\(s\) returned\b/i.test(s)) return true;
  return false;
}
const dataError = computed(() => {
  const msg = (props.result?.message || '').trim();
  if (!msg || isBenignQueryMessage(msg)) return '';
  return msg;
});
const isKpi = computed(() => props.spec.chartType === 'kpi');
const isTable = computed(() => props.spec.chartType === 'table');
const isText = computed(() => props.spec.chartType === 'text');
const isClock = computed(() => props.spec.chartType === 'clock');
const isImage = computed(() => props.spec.chartType === 'image');
const isIframe = computed(() => props.spec.chartType === 'iframe');
const isStaticWidget = computed(
  () => isKpi.value || isTable.value || isText.value || isClock.value || isImage.value || isIframe.value,
);
const kpiValue = computed(() => {
  const field = props.spec.yFields?.[0];
  const value = field ? rows.value[0]?.[field] : undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? '—';
  if (props.spec.valueFormat === 'percent')
    return `${(numeric * 100).toFixed(2)}%`;
  if (props.spec.valueFormat === 'currency')
    return `¥${numeric.toLocaleString()}`;
  return numeric.toLocaleString();
});
/** 文本/时钟样式：字号与首个配色来自 appearance。 */
const textStyle = computed(() => {
  const appearance = props.spec.appearance || {};
  const color = appearance.colors?.[0] || '#e2e8f0';
  return {
    color,
    fontSize: `${appearance.fontSize || (isClock.value ? 36 : 24)}px`,
    fontWeight: 600,
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  };
});
const mediaBroken = ref(false);
const mediaSrc = computed(() => {
  mediaBroken.value = false;
  return resolveBackendAssetUrl(props.spec.mediaUrl || props.spec.textContent || '');
});

function onMediaError() {
  mediaBroken.value = true;
}

function tickClock() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  clockText.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function startClock() {
  stopClock();
  if (!isClock.value) return;
  tickClock();
  clockTimer = window.setInterval(tickClock, 1000);
}

function stopClock() {
  if (clockTimer != null) {
    window.clearInterval(clockTimer);
    clockTimer = undefined;
  }
}

/** 每次尺寸或配置变化均重算布局；高级 option 错误只影响当前图表，不阻断大屏。 */
async function render() {
  if (isStaticWidget.value) return;
  emit('rendering', true);
  try {
    await renderEcharts(
      chartSpecToOption(
        props.spec,
        columns.value,
        rows.value,
        chartSize.value,
      ) as any,
    );
    renderError.value = '';
    emit('error', '');
    resize();
  } catch (error: any) {
    renderError.value = error?.message || '图表 option 配置无效';
    emit('error', renderError.value);
  } finally {
    emit('rendering', false);
  }
}

const scheduleRender = useDebounceFn(() => nextTick(render), 80);
// EchartsUI 默认 300px，必须改成 100% 并观察容器，拖动缩放时才能严格适配组件。
useResizeObserver(rootRef, ([entry]) => {
  if (!entry || !entry.contentRect.width || !entry.contentRect.height) return;
  chartSize.value = {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  };
  void scheduleRender();
});
onMounted(() => {
  nextTick(render);
  startClock();
});
onBeforeUnmount(stopClock);
watch(
  () => [props.spec, props.result],
  () => {
    scheduleRender();
    startClock();
  },
  { deep: true },
);
</script>

<template>
  <div ref="rootRef" class="renderer">
    <div v-if="isText" class="text-widget" :style="textStyle">
      {{ spec.textContent || $tr('请输入文本内容') }}
    </div>
    <div v-else-if="isClock" class="text-widget clock-widget" :style="textStyle">
      {{ clockText }}
    </div>
    <div v-else-if="isImage" class="media-widget">
      <img v-if="mediaSrc && !mediaBroken" :src="mediaSrc" alt="" @error="onMediaError" />
      <div v-else class="media-empty">
        <span class="media-empty-icon" aria-hidden="true">IMG</span>
        <strong>{{ mediaBroken ? $tr('图片加载失败') : $tr('图片组件') }}</strong>
        <span>{{ mediaBroken ? $tr('请检查地址是否可访问') : $tr('请在右侧填写或上传图片地址') }}</span>
      </div>
    </div>
    <div v-else-if="isIframe" class="media-widget">
      <iframe v-if="mediaSrc" :src="mediaSrc" title="embed" frameborder="0" />
      <div v-else class="media-empty">
        <strong>{{ $tr('网页组件') }}</strong>
        <span>{{ $tr('请在右侧填写网页地址') }}</span>
      </div>
    </div>
    <div v-else-if="isKpi" class="kpi">{{ kpiValue ?? '—' }}</div>
    <ElTable
      v-else-if="isTable"
      :data="rows.slice(0, 100)"
      height="100%"
      size="small"
    >
      <ElTableColumn
        v-for="column in columns"
        :key="column"
        :label="column"
        :prop="column"
        min-width="100"
      />
    </ElTable>
    <template v-else>
      <EchartsUI ref="chartRef" height="100%" width="100%" />
      <div v-if="dataError" class="render-error">{{ dataError }}</div>
      <div v-else-if="renderError" class="render-error">{{ renderError }}</div>
    </template>
  </div>
</template>

<style scoped>
.renderer {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.render-error {
  position: absolute;
  inset: 0;
  display: grid;
  padding: 12px;
  place-items: center;
  color: #f87171;
  background: #0b1220ee;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.kpi {
  display: grid;
  height: 100%;
  place-items: center;
  font-size: clamp(28px, 4vw, 64px);
  font-weight: 700;
  color: var(--el-color-primary);
}
.text-widget {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  box-sizing: border-box;
  text-align: center;
  overflow: hidden;
  pointer-events: none;
}
.clock-widget {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.media-widget {
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
.media-widget img,
.media-widget iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
  pointer-events: none;
}
.media-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: #cbd5e1;
  background:
    linear-gradient(45deg, #1e293b 25%, transparent 25%) 0 0 / 16px 16px,
    linear-gradient(-45deg, #1e293b 25%, transparent 25%) 0 8px / 16px 16px,
    #0f172a;
  border: 1px dashed #64748b;
  font-size: 12px;
  text-align: center;
}
.media-empty strong {
  color: #e2e8f0;
  font-size: 13px;
}
.media-empty-icon {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  color: #93c5fd;
  background: #1e3a5f;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
</style>
