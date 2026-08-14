<script lang="ts" setup>
import type { QueryTab } from '../../composables/useQueryTabs';

defineOptions({ name: 'QueryTabs' });

defineProps<{
  tabs: QueryTab[];
  activeId: string;
  maxTabs: number;
}>();

const emit = defineEmits<{
  change: [id: string];
  add: [];
  close: [id: string];
}>();
</script>

<template>
  <div class="query-tabs">
    <div
      v-for="t in tabs"
      :key="t.id"
      class="q-tab"
      :class="{ active: t.id === activeId }"
      @click="emit('change', t.id)"
    >
      <span>{{ t.title }}</span>
      <button type="button" class="close" @click.stop="emit('close', t.id)">×</button>
    </div>
    <button
      type="button"
      class="add"
      :disabled="tabs.length >= maxTabs"
      title="新建查询"
      @click="emit('add')"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.query-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-fill-color-lighter);
  overflow-x: auto;
}
.q-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
}
.q-tab.active {
  background: var(--el-bg-color);
  border-color: var(--el-border-color);
}
.close,
.add {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}
.add {
  padding: 4px 8px;
  font-size: 18px;
}
.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
