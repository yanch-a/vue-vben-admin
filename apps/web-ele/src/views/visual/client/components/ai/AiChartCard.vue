<script lang="ts" setup>
/**
 * AI 图表卡片
 * @author yanch
 */
import { ElMessage } from 'element-plus';

import { saveChart } from '#/api/ai/agent';
import ChartRenderer from '../../../dashboard/components/ChartRenderer.vue';

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
  <div class="ai-chart">
    <div class="head">
      <strong>{{ title }}</strong>
      <div class="btns">
        <ElButton size="small" @click="emit('openSql', sql)">{{ $tr('打开 SQL') }}</ElButton>
        <ElButton size="small" @click="onSave">{{ $tr('保存') }}</ElButton>
        <ElButton size="small" @click="copyOption">{{ $tr('复制 option') }}</ElButton>
      </div>
    </div>
    <div class="chart-box">
      <ChartRenderer :spec="spec" :result="{ columns, rows, rowCount: rows.length }" />
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
.chart-box {
  height: 320px;
}
</style>
