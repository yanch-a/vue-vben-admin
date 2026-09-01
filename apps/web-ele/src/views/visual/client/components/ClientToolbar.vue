<script lang="ts" setup>
/**
 * 客户端顶栏工具条
 * @author yanch
 */
defineOptions({ name: 'ClientToolbar' });

defineProps<{
  hasConnection: boolean;
  /** 运行中的复制任务数（角标） */
  copyTaskCount?: number;
}>();

const emit = defineEmits<{
  create: [];
  open: [];
  refresh: [];
  group: [];
  relation: [];
  /** 已保存查询文件管理 */
  savedQueries: [];
  smart: [];
  copyTasks: [];
  /** 系统功能（导入/导出配置等） */
  system: [];
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
    <ElButton size="small" @click="emit('savedQueries')">
      查询文件
    </ElButton>
    <ElButton size="small" type="success" :disabled="!hasConnection" @click="emit('smart')">
      智能生成 SQL
    </ElButton>
    <ElBadge
      :value="copyTaskCount || 0"
      :hidden="!copyTaskCount"
      class="copy-badge"
    >
      <ElButton
        size="small"
        :type="copyTaskCount ? 'warning' : 'default'"
        @click="emit('copyTasks')"
      >
        复制任务
      </ElButton>
    </ElBadge>
    <ElDivider direction="vertical" />
    <ElButton size="small" @click="emit('system')">
      系统功能
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
.copy-badge {
  margin-left: 4px;
}
</style>
