<script lang="ts" setup>
/**
 * 查询编辑器 Tabs
 * - 右键：关闭当前 / 关闭所有 / 关闭其他
 * - placement：top 横排 / left 竖排
 * @author yanch
 */
import {
  onBeforeUnmount,
  onMounted,
  reactive,
} from 'vue';

import {
  isQueryTabDirty,
  type QueryTab,
} from '../../composables/useQueryTabs';
import type { QueryTabsPlacement } from '../../composables/useClientPreferences';

defineOptions({ name: 'QueryTabs' });

withDefaults(
  defineProps<{
    tabs: QueryTab[];
    activeId: string;
    maxTabs: number;
    placement?: QueryTabsPlacement;
  }>(),
  { placement: 'top' },
);

const emit = defineEmits<{
  change: [id: string];
  add: [];
  close: [id: string];
  'close-all': [];
  'close-others': [keepId: string];
}>();

const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  tabId: '' as string,
});

function tabTitle(t: QueryTab) {
  return isQueryTabDirty(t) ? `${t.title} *` : t.title;
}

function closeCtxMenu() {
  ctxMenu.visible = false;
  ctxMenu.tabId = '';
}

function onTabContextMenu(e: MouseEvent, tab: QueryTab) {
  e.preventDefault();
  e.stopPropagation();
  const pad = 8;
  const menuW = 160;
  const menuH = 120;
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.tabId = tab.id;
  ctxMenu.visible = true;
}

function onCloseCurrent() {
  const id = ctxMenu.tabId;
  closeCtxMenu();
  if (id) emit('close', id);
}

function onCloseAll() {
  closeCtxMenu();
  emit('close-all');
}

function onCloseOthers() {
  const id = ctxMenu.tabId;
  closeCtxMenu();
  if (id) emit('close-others', id);
}

function onDocMouseDown(e: MouseEvent) {
  if (!ctxMenu.visible) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('.query-tabs-ctx-menu')) return;
  closeCtxMenu();
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true);
});
</script>

<template>
  <div class="query-tabs" :class="[`placement-${placement}`]">
    <div
      v-for="t in tabs"
      :key="t.id"
      class="q-tab"
      :class="{ active: t.id === activeId, dirty: isQueryTabDirty(t) }"
      :title="isQueryTabDirty(t) ? '有未保存到数据库的修改' : t.title"
      @click="emit('change', t.id)"
      @contextmenu="onTabContextMenu($event, t)"
    >
      <span class="q-tab-title">{{ tabTitle(t) }}</span>
      <button type="button" class="close" @click.stop="emit('close', t.id)">
        ×
      </button>
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

    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="query-tabs-ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="item" @click="onCloseCurrent">关闭当前</div>
        <div class="item" @click="onCloseAll">关闭所有</div>
        <div class="item" @click="onCloseOthers">关闭其他</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.query-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  background: var(--el-fill-color-lighter);
  flex-shrink: 0;
}
.placement-top {
  flex-direction: row;
  align-items: center;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--el-border-color);
  overflow-x: auto;
}
.placement-left {
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: 100%;
  padding: 6px 0;
  border-right: none;
  overflow-y: auto;
}
.q-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
  min-width: 0;
}
.placement-top .q-tab {
  border-bottom: none;
  border-radius: 4px 4px 0 0;
}
.placement-left .q-tab {
  border-right: none;
  border-radius: 0 4px 4px 0;
  margin-right: 0;
}
.q-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.q-tab.active {
  background: var(--el-bg-color);
  border-color: var(--el-border-color);
}
.placement-left .q-tab.active {
  border-right-color: var(--el-bg-color);
}
.q-tab.dirty .q-tab-title {
  color: var(--el-color-warning);
}
.close,
.add {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.add {
  padding: 4px 8px;
  font-size: 18px;
}
.placement-left .add {
  align-self: center;
  margin-top: 4px;
}
.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

<style>
.query-tabs-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 140px;
  padding: 4px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.query-tabs-ctx-menu .item {
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.query-tabs-ctx-menu .item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
</style>
