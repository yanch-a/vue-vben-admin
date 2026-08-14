<script lang="ts" setup>
defineOptions({ name: 'ClientToolbar' });

defineProps<{
  hasConnection: boolean;
}>();

const emit = defineEmits<{
  create: [];
  open: [];
  refresh: [];
  group: [];
  relation: [];
  smart: [];
}>();
</script>

<template>
  <div class="client-toolbar">
    <ElButton type="primary" size="small" @click="emit('create')">新建连接</ElButton>
    <ElButton size="small" @click="emit('open')">打开连接</ElButton>
    <ElDivider direction="vertical" />
    <ElButton size="small" :disabled="!hasConnection" @click="emit('refresh')">
      刷新
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('group')">
      表分组
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('relation')">
      关系画布
    </ElButton>
    <ElButton size="small" type="success" :disabled="!hasConnection" @click="emit('smart')">
      智能生成 SQL
    </ElButton>
  </div>
</template>

<style scoped>
.client-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
</style>
