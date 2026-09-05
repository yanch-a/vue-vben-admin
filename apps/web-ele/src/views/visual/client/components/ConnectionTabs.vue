<script lang="ts" setup>
/**
 * 顶部已打开连接栏
 * - 单击切换；关闭按钮关闭页签
 * - 右键：刷新当前浏览对象 / 修改浏览对象颜色
 * @author yanch
 */
import { onBeforeUnmount, onMounted, reactive } from 'vue';

import type { DbConnection } from '../composables/useConnectionStore';
import { useClientPreferences } from '../composables/useClientPreferences';

defineOptions({ name: 'ConnectionTabs' });

const props = defineProps<{
  connections: DbConnection[];
  /** 当前激活页签 sessionId */
  activeId: number | string | null;
}>();

const emit = defineEmits<{
  change: [sessionId: number | string];
  close: [sessionId: number | string];
  /** 刷新该连接对应的左侧浏览对象 */
  refresh: [sessionId: number | string];
}>();

const { preferences, setConnectionColor } = useClientPreferences();

const ctx = reactive({
  visible: false,
  x: 0,
  y: 0,
  sessionId: '' as string,
  dbConfigId: '' as string,
});

const colorDialog = reactive({
  visible: false,
  dbConfigId: '' as string,
  color: '#e6f4ff',
});

/** 同库多开时显示序号：库名 (2) */
function tabLabel(c: DbConnection) {
  const same = props.connections.filter(
    (x) => String(x.id) === String(c.id),
  );
  if (same.length <= 1) return c.dbName;
  const idx = same.findIndex((x) => x.sessionId === c.sessionId) + 1;
  return `${c.dbName} (${idx})`;
}

function tabStyle(c: DbConnection) {
  const bg = preferences.connectionColors[String(c.id)];
  if (!bg) return undefined;
  return {
    backgroundColor: bg,
    borderColor: 'transparent',
  };
}

function closeCtx() {
  ctx.visible = false;
}

function onTabContextMenu(e: MouseEvent, c: DbConnection) {
  e.preventDefault();
  e.stopPropagation();
  ctx.sessionId = String(c.sessionId);
  ctx.dbConfigId = String(c.id);
  ctx.x = e.clientX;
  ctx.y = e.clientY;
  ctx.visible = true;
}

function onRefreshBrowse() {
  const sid = ctx.sessionId;
  closeCtx();
  if (sid) emit('refresh', sid);
}

function onEditColor() {
  const id = ctx.dbConfigId;
  closeCtx();
  if (!id) return;
  colorDialog.dbConfigId = id;
  colorDialog.color = preferences.connectionColors[id] || '#e6f4ff';
  colorDialog.visible = true;
}

function applyColor() {
  if (!colorDialog.dbConfigId) return;
  setConnectionColor(colorDialog.dbConfigId, colorDialog.color);
  colorDialog.visible = false;
}

function clearColor() {
  if (!colorDialog.dbConfigId) return;
  setConnectionColor(colorDialog.dbConfigId, '');
  colorDialog.visible = false;
}

function onDocClick() {
  if (ctx.visible) closeCtx();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('scroll', closeCtx, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('scroll', closeCtx, true);
});
</script>

<template>
  <div class="connection-tabs">
    <div
      v-for="c in connections"
      :key="c.sessionId"
      class="conn-tab"
      :class="{ active: c.sessionId === activeId }"
      :style="tabStyle(c)"
      @click="emit('change', c.sessionId)"
      @contextmenu="onTabContextMenu($event, c)"
    >
      <span class="name">{{ tabLabel(c) }}</span>
      <span class="meta">{{ c.dbType }} · {{ c.dbHost || '' }}</span>
      <button
        class="close"
        type="button"
        @click.stop="emit('close', c.sessionId)"
      >
        ×
      </button>
    </div>
    <div v-if="!connections.length" class="empty">请新建或打开数据库连接</div>

    <Teleport to="body">
      <div
        v-show="ctx.visible"
        class="conn-ctx-menu"
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="item" @click="onRefreshBrowse">刷新当前浏览对象</div>
        <div class="item" @click="onEditColor">修改浏览对象颜色</div>
      </div>
    </Teleport>

    <ElDialog
      v-model="colorDialog.visible"
      title="修改浏览对象颜色"
      width="360px"
      append-to-body
      destroy-on-close
    >
      <div class="color-row">
        <span>连接栏背景色</span>
        <ElColorPicker v-model="colorDialog.color" color-format="hex" />
      </div>
      <template #footer>
        <ElButton @click="clearColor">恢复默认</ElButton>
        <ElButton type="primary" @click="applyColor">确定</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.connection-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
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
  font-size: var(--vc-ui-font-size, 13px);
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
  font-size: var(--vc-ui-font-size-sm, 12px);
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
  font-size: var(--vc-ui-font-size, 13px);
}
.conn-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 180px;
  padding: 4px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
  font-size: var(--vc-ui-font-size, 13px);
}
.item {
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
