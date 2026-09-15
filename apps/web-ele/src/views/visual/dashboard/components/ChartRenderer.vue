<script lang="ts" setup>
/**
 * 图表统一渲染器：AI 对话、图表库、大屏编辑器和大屏查看页共用相同表现。
 * @author yanch
 */
import type { EchartsUIType } from '@vben/plugins/echarts';
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
import { useDebounceFn, useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

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
const { renderEcharts, resize } = useEcharts(chartRef);
const columns = computed(() => props.result?.columns || []);
const rows = computed(() => props.result?.rows || []);
const isKpi = computed(() => props.spec.chartType === 'kpi');
const isTable = computed(() => props.spec.chartType === 'table');
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

/** 每次尺寸或配置变化均重算布局；高级 option 错误只影响当前图表，不阻断大屏。 */
async function render() {
  if (isKpi.value || isTable.value) return;
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
onMounted(() => nextTick(render));
watch(
  () => [props.spec, props.result],
  () => scheduleRender(),
  { deep: true },
);
</script>

<template>
  <div ref="rootRef" class="renderer">
    <div v-if="isKpi" class="kpi">{{ kpiValue ?? '—' }}</div>
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
      <div v-if="renderError" class="render-error">{{ renderError }}</div>
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
</style>
