<script setup lang="ts">
/** 可换位置的任务标签栏；关闭只隐藏标签，删除才修改配置。 @author yanch */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Plus, Close, MoreFilled } from '@element-plus/icons-vue';
import type { EtlPipeline } from '#/api/visual/etl';
import { getDesktopScopedStorageKey } from '../../../desktop/runtime';

/** 标签栏停靠位置，交互对齐 Chrome DevTools 三点菜单。 */
type TabPosition = 'top' | 'left' | 'right';

const DOCK_OPTIONS: { value: TabPosition; labelKey: string }[] = [
  { value: 'top', labelKey: '顶部标签' },
  { value: 'left', labelKey: '左侧标签' },
  { value: 'right', labelKey: '右侧标签' },
];

/** 按工作区持久化已关闭标签，刷新后保持 tabbar 状态。 */
const CLOSED_STORE_KEY = 'lemon-etl-closed-tabs-v1';

function closedStorageKey() {
  return getDesktopScopedStorageKey(CLOSED_STORE_KEY);
}

function readClosedStore(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(closedStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

function loadClosedIds(workspaceId: string): string[] {
  const list = readClosedStore()[workspaceId];
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}

function saveClosedIds(workspaceId: string, ids: string[]) {
  const store = readClosedStore();
  if (!ids.length) delete store[workspaceId];
  else store[workspaceId] = [...new Set(ids)];
  try {
    if (!Object.keys(store).length) {
      localStorage.removeItem(closedStorageKey());
    } else {
      localStorage.setItem(closedStorageKey(), JSON.stringify(store));
    }
  } catch {
    /* 配额不足时忽略，不影响当前会话 */
  }
}

/** 去掉已删除任务，并保证当前激活任务始终可见；任务尚未加载时不做删减，避免冲掉本地缓存。 */
function sanitizeClosed(
  ids: string[],
  tasks: EtlPipeline[],
  active: string,
): string[] {
  let next = ids.map(String).filter(Boolean);
  if (active) next = next.filter((id) => id !== active);
  if (tasks.length) {
    const valid = new Set(tasks.map((task) => String(task.id)));
    next = next.filter((id) => valid.has(id));
  }
  return next;
}

const props = defineProps<{
  workspaceId: string | number;
  tasks: EtlPipeline[];
  active: string;
  position: string;
}>();
const emit = defineEmits<{
  select: [string];
  add: [boolean];
  delete: [string];
  position: [string];
}>();

const workspaceKey = computed(() => String(props.workspaceId));
const closed = ref<string[]>(
  sanitizeClosed(
    loadClosedIds(String(props.workspaceId)),
    props.tasks,
    props.active,
  ),
);
const menu = ref<{ id: string; x: number; y: number }>();
/** 三点菜单展开状态，选完位置后自动收起。 */
const dockMenuOpen = ref(false);
const visible = computed(() =>
  props.tasks.filter((task) => !closed.value.includes(task.id)),
);
const vertical = computed(() => props.position !== 'top');

/** 切换停靠位置并关闭三点菜单。 */
function setPosition(next: TabPosition) {
  if (next !== props.position) emit('position', next);
  dockMenuOpen.value = false;
}

/** 选中任务会重新打开已关闭标签，配置不会因关闭而丢失。 */
function select(id: string) {
  if (!id) return;
  closed.value = closed.value.filter((item) => item !== id);
  emit('select', id);
}

/** 下拉选择任务：打开并激活，使其出现在标签栏。 */
function pickTask(id: string) {
  select(id);
}

function close(id: string) {
  if (!closed.value.includes(id)) {
    closed.value = [...closed.value, id];
  }
  if (props.active === id) emit('select', visible.value[0]?.id || '');
  menu.value = undefined;
}
function context(event: MouseEvent, id: string) {
  menu.value = {
    id,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 170)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 200)),
  };
}
function closeOthers() {
  if (!menu.value) return;
  closed.value = props.tasks
    .filter((task) => task.id !== menu.value!.id)
    .map((task) => task.id);
  select(menu.value.id);
  menu.value = undefined;
}
function dismiss() {
  menu.value = undefined;
}

watch(workspaceKey, (id) => {
  closed.value = sanitizeClosed(loadClosedIds(id), props.tasks, props.active);
});

/** 任务增删或激活切换时，校正关闭列表并保证当前任务可见。 */
watch(
  () => [props.tasks.map((task) => task.id).join('\0'), props.active] as const,
  () => {
    const next = sanitizeClosed(closed.value, props.tasks, props.active);
    if (
      next.length !== closed.value.length ||
      next.some((id, i) => id !== closed.value[i])
    ) {
      closed.value = next;
    }
  },
);

watch(
  closed,
  (ids) => {
    saveClosedIds(
      workspaceKey.value,
      sanitizeClosed(ids, props.tasks, props.active),
    );
  },
  { deep: true },
);

onMounted(() => document.addEventListener('click', dismiss));
onBeforeUnmount(() => document.removeEventListener('click', dismiss));
</script>
<template>
  <nav
    class="task-tabs"
    :class="{
      vertical,
      'pos-left': position === 'left',
      'pos-right': position === 'right',
    }"
    :aria-label="$tr('同步任务标签栏')"
  >
    <div class="tab-tools-start">
      <el-dropdown class="add-dropdown" @command="emit('add', $event === 'conditional')">
        <el-button :icon="Plus" type="primary" class="add-btn">{{
          $tr('新增任务')
        }}</el-button>
        <template #dropdown
          ><el-dropdown-menu>
            <el-dropdown-item command="simple">{{
              $tr('数据同步')
            }}</el-dropdown-item>
            <el-dropdown-item command="conditional">{{
              $tr('先从 B 取条件 → A 查询 → B 写入')
            }}</el-dropdown-item>
          </el-dropdown-menu></template
        >
      </el-dropdown>
    </div>

    <div
      class="tab-items"
      role="tablist"
      :aria-orientation="position === 'top' ? 'horizontal' : 'vertical'"
    >
      <div
        v-for="task in visible"
        :key="task.id"
        class="tab-item"
        :class="{ active: active === task.id }"
        role="tab"
        :aria-selected="active === task.id"
        tabindex="0"
        @click="select(task.id)"
        @keydown.enter="select(task.id)"
        @contextmenu.prevent="context($event, task.id)"
      >
        <span :title="$tr(task.name)">{{ $tr(task.name) }}</span
        ><small v-if="task.enabled === false">{{ $tr('停用') }}</small>
        <el-button
          :icon="Close"
          link
          :title="`${$tr('关闭')} ${task.name}`"
          @click.stop="close(task.id)"
        />
      </div>
      <span v-if="!visible.length" class="empty-tabs">{{
        $tr('使用任务下拉重新打开')
      }}</span>
    </div>

    <!-- 最右侧：任务下拉 + 三点停靠菜单 -->
    <div class="tab-tools-end">
      <el-select
        class="task-picker"
        :model-value="active || undefined"
        filterable
        :placeholder="$tr('选择任务')"
        :title="$tr('选择任务（包含已关闭任务）')"
        :aria-label="$tr('选择任务')"
        :teleported="true"
        @change="pickTask"
      >
        <el-option
          v-for="task in tasks"
          :key="task.id"
          :label="$tr(task.name || task.id)"
          :value="task.id"
        />
      </el-select>
      <el-popover
        v-model:visible="dockMenuOpen"
        trigger="click"
        :width="168"
        placement="bottom-end"
        popper-class="etl-dock-popper"
      >
        <template #reference>
          <el-button
            :icon="MoreFilled"
            class="dock-trigger"
            :title="$tr('标签栏位置')"
            :aria-label="$tr('标签栏位置')"
          />
        </template>
        <div class="dock-menu" role="menu" :aria-label="$tr('选择标签栏位置')">
          <div class="dock-menu__title">{{ $tr('标签栏位置') }}</div>
          <div class="dock-icons" role="group">
            <button
              v-for="opt in DOCK_OPTIONS"
              :key="opt.value"
              type="button"
              class="dock-icon"
              :class="{ active: position === opt.value }"
              :title="$tr(opt.labelKey)"
              :aria-label="$tr(opt.labelKey)"
              :aria-pressed="position === opt.value"
              role="menuitemradio"
              @click="setPosition(opt.value)"
            >
              <span class="dock-preview" :data-side="opt.value" aria-hidden="true">
                <span class="dock-preview__chrome" />
                <span class="dock-preview__panel" />
              </span>
            </button>
          </div>
        </div>
      </el-popover>
    </div>

    <Teleport to="body"
      ><div
        v-if="menu"
        class="task-context-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
      >
        <button @click="close(menu.id)">{{ $tr('关闭标签') }}</button
        ><button @click="closeOthers">{{ $tr('关闭其他标签') }}</button>
        <button
          @click="
            closed = [];
            dismiss();
          "
        >
          {{ $tr('打开全部任务') }}
        </button>
        <button
          class="danger"
          @click="
            emit('delete', menu.id);
            dismiss();
          "
        >
          {{ $tr('删除任务配置…') }}
        </button>
      </div></Teleport
    >
  </nav>
</template>
<style scoped>
.task-tabs {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
  min-width: 0;
  background: var(--el-bg-color);
}
.tab-tools-start {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}
.tab-tools-end {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}
.dock-trigger {
  padding: 8px;
}
.task-picker {
  width: 200px;
  min-width: 140px;
}
.tab-items {
  display: flex;
  gap: 4px;
  overflow: auto;
  min-width: 0;
  flex: 1;
  align-items: center;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  background: var(--el-fill-color-light);
}
.tab-item span {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-item.active {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
/* 左右侧：工具区置顶，标签列表纵向占满剩余高度 */
.vertical {
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 8px;
  padding: 12px 10px;
  border-bottom: 0;
  box-sizing: border-box;
}
.vertical.pos-left {
  border-right: 1px solid var(--el-border-color);
}
.vertical.pos-right {
  border-left: 1px solid var(--el-border-color);
}
.vertical .tab-tools-start {
  order: 1;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
}
.vertical .tab-tools-end {
  order: 2;
  margin-left: 0;
  width: 100%;
  justify-content: flex-end;
}
.vertical .add-dropdown {
  display: block;
  width: 100%;
}
.vertical .add-btn {
  width: 100%;
}
.vertical .task-picker {
  flex: 1;
  width: auto;
  min-width: 0;
}
.vertical .tab-items {
  order: 3;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.vertical .tab-item {
  width: 100%;
  box-sizing: border-box;
}
.vertical .tab-item span {
  flex: 1;
  min-width: 0;
  max-width: none;
}
.empty-tabs {
  padding: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.task-context-menu {
  color: var(--el-text-color-primary);
  position: fixed;
  z-index: 4000;
  min-width: 160px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--el-box-shadow-light);
  border-radius: 6px;
  padding: 4px;
}
.task-context-menu button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.task-context-menu button:hover {
  background: var(--el-fill-color-light);
}
.danger {
  color: var(--el-color-danger);
}
</style>

<!-- Popover 挂到 body，停靠菜单样式需非 scoped -->
<style>
.etl-dock-popper.el-popover {
  padding: 10px 12px !important;
  min-width: 0 !important;
}
.etl-dock-popper .dock-menu__title {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.2;
}
.etl-dock-popper .dock-icons {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
}
.etl-dock-popper .dock-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: inherit;
}
.etl-dock-popper .dock-icon:hover {
  background: var(--el-fill-color-light);
}
.etl-dock-popper .dock-icon.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
/* 小窗口预览：灰底 + 高亮停靠条，类似 Chrome DevTools */
.etl-dock-popper .dock-preview {
  position: relative;
  display: block;
  width: 28px;
  height: 20px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 3px;
  background: var(--el-fill-color);
  box-sizing: border-box;
}
.etl-dock-popper .dock-preview__chrome {
  position: absolute;
  inset: 0;
  background: var(--el-bg-color);
}
.etl-dock-popper .dock-preview__panel {
  position: absolute;
  background: var(--el-color-primary);
  opacity: 0.85;
}
.etl-dock-popper .dock-preview[data-side='top'] .dock-preview__panel {
  top: 0;
  right: 0;
  left: 0;
  height: 6px;
}
.etl-dock-popper .dock-preview[data-side='left'] .dock-preview__panel {
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
}
.etl-dock-popper .dock-preview[data-side='right'] .dock-preview__panel {
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
}
.etl-dock-popper .dock-icon.active .dock-preview {
  border-color: var(--el-color-primary);
}
</style>
