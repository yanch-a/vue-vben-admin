<script lang="ts" setup>
/**
 * 客户端顶栏工具条
 * @author yanch
 */
import { ArrowDown, Document, Refresh } from '@element-plus/icons-vue';

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
  /** 跳转到图表库（路由名 Dashboard） */
  chartLibrary: [];
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
  /** Redis 管理工作台（路由名 Redis） */
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
    <ElButton type="primary" size="small" @click="emit('create')">{{ $tr('新建连接') }}</ElButton>
    <ElButton size="small" @click="emit('open')">{{ $tr('打开连接') }}</ElButton>
    <ElDivider direction="vertical" />
    <ElButton
      size="small"
      :icon="Refresh"
      :title="$tr('刷新当前浏览对象')"
      :disabled="!hasConnection"
      @click="emit('refresh')"
    />
    <ElButton size="small" :disabled="!hasConnection" @click="emit('group')">
      {{ $tr('表分组') }}
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('queryView')">
      {{ $tr('查询视图') }}
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('relation')">
      {{ $tr('关系画布') }}
    </ElButton>
    <ElButton size="small" @click="emit('savedQueries')">
      {{ $tr('查询文件') }}
    </ElButton>
    <ElButton size="small" @click="emit('chartLibrary')">
      {{ $tr('图表库') }}
    </ElButton>
    <ElButton size="small" @click="emit('redis')">
      Redis
    </ElButton>
    <ElButton size="small" type="primary" :disabled="!hasConnection" @click="emit('ai')">
      {{ $tr('AI 助手') }}
    </ElButton>
    <ElButton
      class="schema-doc-btn"
      size="small"
      type="primary"
      plain
      :icon="Document"
      :disabled="!hasConnection"
      :title="$tr('AI 会优先依赖结构文档理解表、字段和关联')"
      @click="emit('schemaDoc')"
    >
      {{ $tr('AI 结构文档') }}
    </ElButton>
    <ElButton size="small" :disabled="!hasConnection" @click="emit('history')">
      {{ $tr('查询历史') }}
    </ElButton>
    <ElDivider direction="vertical" />
    <ElButton size="small" @click="emit('tools')">
      {{ $tr('客户端工具') }}
    </ElButton>
    <ElDropdown trigger="click" @command="onSystemCommand">
      <ElButton size="small">
        {{ $tr('系统功能') }}
        <ElIcon class="el-icon--right"><ArrowDown /></ElIcon>
      </ElButton>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem command="export">{{ $tr('导出配置') }}</ElDropdownItem>
          <ElDropdownItem command="import">{{ $tr('导入配置') }}</ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
    <ElButton size="small" @click="emit('preferences')">
      {{ $tr('偏好设置') }}
    </ElButton>
    <ElButton size="small" @click="emit('license')">
      {{ $tr('授权') }}
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
        {{ $tr('进度') }}
      </ElButton>
    </ElBadge>
  </div>
</template>

<style scoped>
.client-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  /* 行间距 / 列间距：窄屏自动换行时仍保持可读 */
  gap: 6px 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.client-toolbar :deep(.el-button + .el-button),
.client-toolbar :deep(.el-dropdown + .el-button),
.client-toolbar :deep(.el-button + .el-dropdown),
.client-toolbar :deep(.el-badge + .el-button),
.client-toolbar :deep(.el-button + .el-badge) {
  /* 用 gap 统一间距，去掉 Element Plus 相邻按钮默认 margin，换行后间距才一致 */
  margin-left: 0;
}
.client-toolbar :deep(.el-divider--vertical) {
  height: 1.2em;
  margin: 0 2px;
}
.task-badge {
  margin-left: 4px;
}
.schema-doc-btn {
  font-weight: 600;
}
.lic-hint {
  margin-left: 2px;
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-color-warning);
  font-weight: normal;
}
</style>
