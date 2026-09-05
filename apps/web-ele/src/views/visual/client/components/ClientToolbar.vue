<script lang="ts" setup>
/**
 * 客户端顶栏工具条
 * @author yanch
 */
import { Refresh } from '@element-plus/icons-vue';

defineOptions({ name: 'ClientToolbar' });

defineProps<{
  hasConnection: boolean;
  /** 运行中的复制任务数（角标） */
  copyTaskCount?: number;
  /** 授权状态短提示（试用剩余 / 已授权） */
  licenseHint?: string;
}>();

const emit = defineEmits<{
  create: [];
  open: [];
  refresh: [];
  group: [];
  relation: [];
  /** 已保存查询文件管理 */
  savedQueries: [];
  copyTasks: [];
  /** 系统功能（导入/导出配置等） */
  system: [];
  /** 偏好设置（Tabs 位置等） */
  preferences: [];
  /** 产品授权 */
  license: [];
  /** 打开 AI 助手浮窗 */
  ai: [];
  /** 打开 Schema 结构文档 */
  schemaDoc: [];
  /** 打开查询历史 */
  history: [];
}>();
</script>

<template>
  <div class="client-toolbar">
    <ElButton type="primary" size="small" @click="emit('create')">新建连接</ElButton>
    <ElButton size="small" @click="emit('open')">打开连接</ElButton>
    <ElDivider direction="vertical" />
    <ElButton
      size="small"
      :icon="Refresh"
      title="刷新当前浏览对象"
      :disabled="!hasConnection"
      @click="emit('refresh')"
    />
    <ElButton size="small" :disabled="!hasConnection" @click="emit('group')">
      表分组
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('relation')">
      关系画布
    </ElButton>
    <ElButton size="small" @click="emit('savedQueries')">
      查询文件
    </ElButton>
    <ElButton size="small" type="primary" :disabled="!hasConnection" @click="emit('ai')">
      AI 助手
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('schemaDoc')">
      结构文档
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('history')">
      查询历史
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
    <ElButton size="small" @click="emit('preferences')">
      偏好设置
    </ElButton>
    <ElButton size="small" @click="emit('license')">
      授权
      <span v-if="licenseHint" class="lic-hint">（{{ licenseHint }}）</span>
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
.lic-hint {
  margin-left: 2px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-color-warning);
  font-weight: normal;
}
</style>
