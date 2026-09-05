<script lang="ts" setup>
/**
 * AI 图表卡片
 * @author yanch
 */
import type { EchartsUIType } from '@vben/plugins/echarts';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { saveChart } from '#/api/ai/agent';

import { chartSpecToOption, type ChartSpec } from '../../utils/chartSpecToOption';

defineOptions({ name: 'AiChartCard' });

const props = defineProps<{
  title: string;
  sql: string;
  spec: ChartSpec;
  columns: string[];
  rows: any[];
  dbConfigId?: number | string;
  instanceName?: string;
}>();

const emit = defineEmits<{
  openSql: [string];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);
const wrap = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;

const isKpi = computed(() => props.spec?.chartType === 'kpi');
const isTable = computed(() => props.spec?.chartType === 'table');
const kpiValue = computed(() => {
  const y = props.spec?.yFields?.[0];
  return y && props.rows?.[0] ? props.rows[0][y] : '';
});

function render() {
  if (isKpi.value || isTable.value) return;
  renderEcharts(chartSpecToOption(props.spec, props.columns, props.rows) as any);
}

onMounted(() => {
  nextTick(render);
  if (wrap.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => render());
    ro.observe(wrap.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());
watch(() => [props.spec, props.rows], () => nextTick(render), { deep: true });

async function onSave() {
  if (!props.dbConfigId) {
    ElMessage.warning('未绑定连接');
    return;
  }
  await saveChart({
    title: props.title,
    sqlText: props.sql,
    chartSpec: JSON.stringify(props.spec),
    dbConfigId: props.dbConfigId,
    instanceName: props.instanceName,
  });
  ElMessage.success('已保存到我的图表');
}

async function copyOption() {
  const opt = chartSpecToOption(props.spec, props.columns, props.rows);
  await navigator.clipboard.writeText(JSON.stringify(opt, null, 2));
  ElMessage.success('已复制 option JSON');
}
</script>

<template>
  <div ref="wrap" class="ai-chart">
    <div class="head">
      <strong>{{ title }}</strong>
      <div class="btns">
        <ElButton size="small" @click="emit('openSql', sql)">打开 SQL</ElButton>
        <ElButton size="small" @click="onSave">保存</ElButton>
        <ElButton size="small" @click="copyOption">复制 option</ElButton>
      </div>
    </div>
    <div v-if="isKpi" class="kpi">{{ kpiValue }}</div>
    <ElTable v-else-if="isTable" :data="rows.slice(0, 50)" size="small" max-height="280" border>
      <ElTableColumn v-for="c in columns" :key="c" :prop="c" :label="c" min-width="90" />
    </ElTable>
    <div v-else class="chart-box">
      <EchartsUI ref="chartRef" />
    </div>
  </div>
</template>

<style scoped>
.ai-chart {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 8px;
  margin: 8px 0;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: var(--vc-ai-font-size, 13px);
}
.kpi {
  font-size: calc(var(--vc-ai-font-size, 13px) * 2.75);
  font-weight: 700;
  padding: 16px 0;
  text-align: center;
}
.chart-box {
  height: 320px;
}
</style>
