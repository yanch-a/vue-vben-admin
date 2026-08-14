<script lang="ts" setup>
import type { DbConnection } from '../composables/useConnectionStore';

defineOptions({ name: 'ConnectionTabs' });

defineProps<{
  connections: DbConnection[];
  activeId: number | string | null;
}>();

const emit = defineEmits<{
  change: [id: number | string];
  close: [id: number | string];
}>();
</script>

<template>
  <div class="connection-tabs">
    <div
      v-for="c in connections"
      :key="c.id"
      class="conn-tab"
      :class="{ active: c.id === activeId }"
      @click="emit('change', c.id)"
    >
      <span class="name">{{ c.dbName }}</span>
      <span class="meta">{{ c.dbType }} · {{ c.dbHost || '' }}</span>
      <button class="close" type="button" @click.stop="emit('close', c.id)">×</button>
    </div>
    <div v-if="!connections.length" class="empty">请新建或打开数据库连接</div>
  </div>
</template>

<style scoped>
.connection-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 0 8px;
  min-height: 36px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  overflow-x: auto;
}
.conn-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
  font-size: 13px;
}
.conn-tab.active {
  background: var(--el-bg-color);
  border-color: var(--el-border-color);
}
.name {
  font-weight: 600;
}
.meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--el-text-color-secondary);
}
.empty {
  padding: 8px 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
