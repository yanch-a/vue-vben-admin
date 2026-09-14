<script lang="ts" setup>
/**
 * 图表统一渲染器：AI 对话、图表库、大屏编辑器和大屏查看页共用相同表现。
 * @author yanch
 */
import type { EchartsUIType } from '@vben/plugins/echarts';
import type { ChartSpec, QueryResult } from '#/api/visual/dashboard';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { chartSpecToOption } from '../../client/utils/chartSpecToOption';

defineOptions({ name: 'DashboardChartRenderer' });

const props = defineProps<{
  result?: Partial<QueryResult>;
  spec: ChartSpec;
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);
const columns = computed(() => props.result?.columns || []);
const rows = computed(() => props.result?.rows || []);
const isKpi = computed(() => props.spec.chartType === 'kpi');
const isTable = computed(() => props.spec.chartType === 'table');
const kpiValue = computed(() => {
  const field = props.spec.yFields?.[0];
  const value = field ? rows.value[0]?.[field] : undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? '—';
  if (props.spec.valueFormat === 'percent') return `${(numeric * 100).toFixed(2)}%`;
  if (props.spec.valueFormat === 'currency') return `¥${numeric.toLocaleString()}`;
  return numeric.toLocaleString();
});

function render() {
  if (isKpi.value || isTable.value) return;
  renderEcharts(chartSpecToOption(props.spec, columns.value, rows.value) as any);
}

onMounted(() => nextTick(render));
watch(() => [props.spec, props.result], () => nextTick(render), { deep: true });
</script>

<template>
  <div class="renderer">
    <div v-if="isKpi" class="kpi">{{ kpiValue ?? '—' }}</div>
    <ElTable v-else-if="isTable" :data="rows.slice(0, 100)" height="100%" size="small">
      <ElTableColumn v-for="column in columns" :key="column" :label="column" :prop="column" min-width="100" />
    </ElTable>
    <EchartsUI v-else ref="chartRef" />
  </div>
</template>

<style scoped>
.renderer { width: 100%; height: 100%; min-height: 80px; }
.kpi { display: grid; height: 100%; place-items: center; font-size: clamp(28px, 4vw, 64px); font-weight: 700; color: var(--el-color-primary); }
</style>
