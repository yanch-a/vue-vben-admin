<script lang="ts" setup>
/**
 * 单个工具调用步骤
 * @author yanch
 */
import { computed, ref } from 'vue';

import type { AiToolStep } from '../../composables/useAiChat';

defineOptions({ name: 'AiToolStep' });

const props = defineProps<{ step: AiToolStep }>();
const open = ref(false);

const summary = computed(() => {
  const a = props.step.arguments;
  if (!a || typeof a !== 'object') return '';
  return Object.values(a)
    .slice(0, 3)
    .map((v) => String(v))
    .join(', ');
});

const tableRows = computed(() => {
  const d = props.step.data;
  if (d && Array.isArray(d.rows) && Array.isArray(d.columns)) {
    return { columns: d.columns as string[], rows: d.rows.slice(0, 20) };
  }
  return null;
});
</script>

<template>
  <div class="step">
    <div class="line" @click="open = !open">
      🔧 {{ step.name }}({{ summary }})
      <span v-if="step.elapsedMs != null"> · {{ step.elapsedMs }}ms</span>
      <span v-if="step.ok === true"> ✓</span>
      <span v-else-if="step.ok === false"> ✗</span>
    </div>
    <div v-if="open" class="detail">
      <pre>{{ JSON.stringify(step.arguments, null, 2) }}</pre>
      <ElTable v-if="tableRows" :data="tableRows.rows" size="small" max-height="220" border>
        <ElTableColumn
          v-for="c in tableRows.columns"
          :key="c"
          :prop="c"
          :label="c"
          min-width="90"
          show-overflow-tooltip
        />
      </ElTable>
      <pre v-else-if="step.data">{{ typeof step.data === 'string' ? step.data : JSON.stringify(step.data, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.line {
  cursor: pointer;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 2px 0;
}
.detail pre {
  font-size: 11px;
  white-space: pre-wrap;
  margin: 4px 0;
  max-height: 160px;
  overflow: auto;
}
</style>
