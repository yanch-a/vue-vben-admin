<script lang="ts" setup>
/**
 * 客户端顶栏工具条
 * @author yanch
 */
import { ArrowDown, Refresh } from '@element-plus/icons-vue';

defineOptions({ name: 'ClientToolbar' });

defineProps<{
  hasConnection: boolean;
  /** 运行中的后台任务数（角标） */
  taskCount?: number;
  /** 授权状态短提示（试用剩余 / 已授权） */
  licenseHint?: string;
}>();

const emit = defineEmits<{
  create: [];
  open: [];
  refresh: [];
  group: [];
  /** 打开查询视图（直接写 SQL 模式） */
  queryView: [];
  relation: [];
  /** 已保存查询文件管理 */
  savedQueries: [];
  /** 打开右上角任务进度 */
  progress: [];
  /** 系统功能：导出 / 导入配置 */
  system: [mode: 'export' | 'import'];
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
  /** 管理服务端官方数据库客户端 */
  tools: [];
  /** SQL 上线工单 */
  workOrder: [];
  /** Redis 管理工作台 */
  redis: [];
}>();

function onSystemCommand(cmd: string | number) {
  if (cmd === 'export' || cmd === 'import') {
    emit('system', cmd);
  }
}
</script>

<template>
  <!-- 整栏禁浏览器右键，避免工具按钮弹出系统菜单 -->
  <div class="client-toolbar" @contextmenu.prevent>
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
    <ElButton size="small" :disabled="!hasConnection" @click="emit('queryView')">
      查询视图
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('relation')">
      关系画布
    </ElButton>
    <ElButton size="small" @click="emit('savedQueries')">
      查询文件
    </ElButton>
    <ElButton size="small" @click="emit('workOrder')">
      SQL 工单
    </ElButton>
    <ElButton size="small" @click="emit('redis')">
      Redis
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
    <ElDivider direction="vertical" />
    <ElButton size="small" @click="emit('tools')">
      客户端工具
    </ElButton>
    <ElDropdown trigger="click" @command="onSystemCommand">
      <ElButton size="small">
        系统功能
        <ElIcon class="el-icon--right"><ArrowDown /></ElIcon>
      </ElButton>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem command="export">导出配置</ElDropdownItem>
          <ElDropdownItem command="import">导入配置</ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
    <ElButton size="small" @click="emit('preferences')">
      偏好设置
    </ElButton>
    <ElButton size="small" @click="emit('license')">
      授权
      <span v-if="licenseHint" class="lic-hint">（{{ licenseHint }}）</span>
    </ElButton>
    <ElBadge
      :value="taskCount || 0"
      :hidden="!taskCount"
      class="task-badge"
    >
      <ElButton
        size="small"
        :type="taskCount ? 'warning' : 'default'"
        @click="emit('progress')"
      >
        进度
      </ElButton>
    </ElBadge>
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
.task-badge {
  margin-left: 4px;
}
.lic-hint {
  margin-left: 2px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-color-warning);
  font-weight: normal;
}
</style>
