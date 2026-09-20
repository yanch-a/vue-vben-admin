<script lang="ts" setup>
/**
 * 顶部已打开连接栏
 * - 单击切换；关闭按钮关闭页签
 * - 连接页签右键：刷新 / 改颜色 / 导入导出本连接查询
 * - 空白区域右键：导入 / 导出全部临时查询记录（本地会话缓存）
 * @author yanch
 */
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { Plus } from '@element-plus/icons-vue';

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
  /** 打开已有数据库连接 */
  open: [];
  /** 刷新该连接对应的左侧浏览对象 */
  refresh: [sessionId: number | string];
  /** 导出全部本地临时连接与查询记录 */
  exportSession: [];
  /** 导入全部本地临时连接与查询记录文件内容 */
  importSession: [file: File];
  /** 导出当前右键连接的查询记录 */
  exportConnectionQueries: [sessionId: number | string];
  /** 导入查询记录到当前右键连接 */
  importConnectionQueries: [sessionId: number | string, file: File];
}>();

const { preferences, setConnectionColor } = useClientPreferences();
const barRef = ref<HTMLElement>();
const importInputRef = ref<HTMLInputElement>();
const connectionImportInputRef = ref<HTMLInputElement>();
/** 连接级导入时锁定目标 sessionId，避免异步选文件后串连接 */
const pendingConnectionImportId = ref('');

const ctx = reactive({
  visible: false,
  x: 0,
  y: 0,
  sessionId: '' as string,
  dbConfigId: '' as string,
  /** tab：连接页签菜单；blank：栏空白区菜单 */
  mode: 'tab' as 'blank' | 'tab',
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
  const isActive = c.sessionId === props.activeId;
  // 自定义颜色时仍用主题主色描边/底边，保证当前连接一眼可辨
  if (!bg) return undefined;
  if (isActive) {
    return {
      backgroundColor: bg,
      borderColor: 'var(--el-color-primary)',
      boxShadow: 'inset 0 -3px 0 0 var(--el-color-primary)',
    };
  }
  return {
    backgroundColor: bg,
    borderColor: 'transparent',
    opacity: 0.78,
  };
}

/** 竖向滚轮转为横向滚动，便于浏览多个连接页签 */
function onBarWheel(e: WheelEvent) {
  const el = barRef.value;
  if (!el || el.scrollWidth <= el.clientWidth) return;
  // 已有明显横向位移时交给浏览器默认行为
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  if (e.deltaY === 0) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

function closeCtx() {
  ctx.visible = false;
}

function onTabContextMenu(e: MouseEvent, c: DbConnection) {
  e.preventDefault();
  e.stopPropagation();
  ctx.mode = 'tab';
  ctx.sessionId = String(c.sessionId);
  ctx.dbConfigId = String(c.id);
  ctx.x = e.clientX;
  ctx.y = e.clientY;
  ctx.visible = true;
}

/** 连接栏空白处右键：导入 / 导出临时查询（不点在页签或加号上）。 */
function onBarContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.conn-tab, .add-connection, .conn-ctx-menu')) return;
  e.preventDefault();
  ctx.mode = 'blank';
  ctx.sessionId = '';
  ctx.dbConfigId = '';
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

function onExportSession() {
  closeCtx();
  emit('exportSession');
}

function onImportSession() {
  closeCtx();
  importInputRef.value?.click();
}

function onExportConnectionQueries() {
  const sid = ctx.sessionId;
  closeCtx();
  if (sid) emit('exportConnectionQueries', sid);
}

function onImportConnectionQueries() {
  const sid = ctx.sessionId;
  closeCtx();
  if (!sid) return;
  pendingConnectionImportId.value = sid;
  connectionImportInputRef.value?.click();
}

function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('importSession', file);
}

function onConnectionImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const sid = pendingConnectionImportId.value;
  pendingConnectionImportId.value = '';
  input.value = '';
  if (file && sid) emit('importConnectionQueries', sid, file);
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
  // passive: false 才能 preventDefault，把竖向滚轮转成横向滚动
  barRef.value?.addEventListener('wheel', onBarWheel, { passive: false });
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('scroll', closeCtx, true);
  barRef.value?.removeEventListener('wheel', onBarWheel);
});

/** 供 Electron 原生菜单复用同一套文件选择器 */
defineExpose({
  openImportPicker: () => importInputRef.value?.click(),
});
</script>

<template>
  <div
    ref="barRef"
    class="connection-tabs"
    @contextmenu="onBarContextMenu"
  >
    <div
      v-for="c in connections"
      :key="c.sessionId"
      class="conn-tab"
      :class="{ active: c.sessionId === activeId }"
      :style="tabStyle(c)"
      :title="`${tabLabel(c)} · ${c.dbType} · ${c.dbHost || ''}`"
      @click="emit('change', c.sessionId)"
      @contextmenu="onTabContextMenu($event, c)"
    >
      <span v-if="c.sessionId === activeId" class="active-marker" aria-hidden="true" />
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
    <ElButton
      class="add-connection"
      :icon="Plus"
      circle
      size="small"
      :title="$tr('打开数据库连接')"
      @click="emit('open')"
    />
    <div v-if="!connections.length" class="empty">{{ $tr('请新建或打开数据库连接') }}</div>
    <div class="bar-spacer" aria-hidden="true" />

    <input
      ref="importInputRef"
      class="hidden-file"
      type="file"
      accept="application/json,.json"
      @change="onImportFileChange"
    />
    <input
      ref="connectionImportInputRef"
      class="hidden-file"
      type="file"
      accept="application/json,.json"
      @change="onConnectionImportFileChange"
    />

    <Teleport to="body">
      <div
        v-show="ctx.visible"
        class="conn-ctx-menu"
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <template v-if="ctx.mode === 'tab'">
          <div class="item" @click="onRefreshBrowse">{{ $tr('刷新当前浏览对象') }}</div>
          <div class="item" @click="onEditColor">{{ $tr('修改浏览对象颜色') }}</div>
          <div class="item divider" @click="onExportConnectionQueries">
            {{ $tr('导出本连接查询记录') }}
          </div>
          <div class="item" @click="onImportConnectionQueries">
            {{ $tr('导入本连接查询记录') }}
          </div>
        </template>
        <template v-else>
          <div class="item" @click="onExportSession">{{ $tr('导出临时查询记录') }}</div>
          <div class="item" @click="onImportSession">{{ $tr('导入临时查询记录') }}</div>
        </template>
      </div>
    </Teleport>

    <ElDialog
      v-model="colorDialog.visible"
      :title="$tr('修改浏览对象颜色')"
      width="360px"
      append-to-body
      destroy-on-close
    >
      <div class="color-row">
        <span>{{ $tr('连接栏背景色') }}</span>
        <ElColorPicker v-model="colorDialog.color" color-format="hex" />
      </div>
      <template #footer>
        <ElButton @click="clearColor">{{ $tr('恢复默认') }}</ElButton>
        <ElButton type="primary" @click="applyColor">{{ $tr('确定') }}</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.connection-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-height: 38px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.conn-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 8px;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
  font-size: var(--vc-ui-font-size, 13px);
  color: var(--el-text-color-regular);
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.conn-tab:hover:not(.active) {
  background: var(--el-fill-color);
}
/* 主题主色高亮当前连接，随亮/暗色与品牌色变化 */
.conn-tab.active {
  background: color-mix(in srgb, var(--el-color-primary) 16%, var(--el-bg-color));
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
  box-shadow: inset 0 -3px 0 0 var(--el-color-primary);
  z-index: 1;
}
.conn-tab.active .name {
  font-weight: 700;
}
.conn-tab.active .meta {
  color: var(--el-color-primary);
  opacity: 0.88;
}
.active-marker {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}
.add-connection {
  flex: 0 0 auto;
  align-self: center;
  margin: 0 6px 0 4px;
}
/* 占满剩余空白，便于右键命中 */
.bar-spacer {
  flex: 1 1 auto;
  min-width: 48px;
  align-self: stretch;
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
.conn-tab.active .close {
  color: var(--el-color-primary);
}
.empty {
  padding: 8px 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--vc-ui-font-size, 13px);
}
.hidden-file {
  display: none;
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
.item.divider {
  margin-top: 4px;
  border-top: 1px solid var(--el-border-color-lighter);
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
