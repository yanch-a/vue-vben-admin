<script setup lang="ts">
/** 可换位置的任务标签栏；关闭只隐藏标签，删除才修改配置。 @author yanch */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Plus, Search, Close, MoreFilled } from '@element-plus/icons-vue';
import type { EtlPipeline } from '#/api/visual/etl';

/** 标签栏停靠位置，交互对齐 Chrome DevTools 三点菜单。 */
type TabPosition = 'top' | 'left' | 'right';

const DOCK_OPTIONS: { value: TabPosition; label: string }[] = [
  { value: 'top', label: '顶部标签' },
  { value: 'left', label: '左侧标签' },
  { value: 'right', label: '右侧标签' },
];

const props = defineProps<{
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
const search = ref('');
const closed = ref<string[]>([]);
const menu = ref<{ id: string; x: number; y: number }>();
/** 三点菜单展开状态，选完位置后自动收起。 */
const dockMenuOpen = ref(false);
const visible = computed(() =>
  props.tasks.filter((task) => !closed.value.includes(task.id)),
);
const matches = computed(() =>
  props.tasks.filter((task) =>
    (task.name || task.id)
      .toLowerCase()
      .includes(search.value.trim().toLowerCase()),
  ),
);
const vertical = computed(() => props.position !== 'top');

/** 切换停靠位置并关闭三点菜单。 */
function setPosition(next: TabPosition) {
  if (next !== props.position) emit('position', next);
  dockMenuOpen.value = false;
}

/** 检索包含已关闭任务，选中会重新打开，配置不会因关闭而丢失。 */
function select(id: string) {
  closed.value = closed.value.filter((item) => item !== id);
  search.value = '';
  emit('select', id);
}
function close(id: string) {
  closed.value.push(id);
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
    aria-label="同步任务标签栏"
  >
    <div class="tab-tools">
      <el-dropdown class="add-dropdown" @command="emit('add', $event === 'conditional')">
        <el-button :icon="Plus" type="primary" class="add-btn">新增任务</el-button>
        <template #dropdown
          ><el-dropdown-menu>
            <el-dropdown-item command="simple">数据同步</el-dropdown-item>
            <el-dropdown-item command="conditional"
              >先从 B 取条件 → A 查询 → B 写入</el-dropdown-item
            >
          </el-dropdown-menu></template
        >
      </el-dropdown>
      <div class="tool-row">
        <!-- 对齐 Chrome DevTools：三点打开停靠位置选择 -->
        <el-popover
          v-model:visible="dockMenuOpen"
          trigger="click"
          :width="168"
          :placement="vertical ? 'bottom' : 'bottom-start'"
          popper-class="etl-dock-popper"
        >
          <template #reference>
            <el-button
              :icon="MoreFilled"
              class="dock-trigger"
              title="标签栏位置"
              aria-label="标签栏位置"
            />
          </template>
          <div class="dock-menu" role="menu" aria-label="选择标签栏位置">
            <div class="dock-menu__title">标签栏位置</div>
            <div class="dock-icons" role="group">
              <button
                v-for="opt in DOCK_OPTIONS"
                :key="opt.value"
                type="button"
                class="dock-icon"
                :class="{ active: position === opt.value }"
                :title="opt.label"
                :aria-label="opt.label"
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
        <!-- 检索输入常显；有关键词时下拉展示结果（含已关闭任务） -->
        <div class="search-box" :class="{ open: !!search.trim() }">
          <el-input
            v-model="search"
            :prefix-icon="Search"
            clearable
            class="search-input"
            placeholder="检索任务"
            title="检索任务（包含已关闭任务）"
            aria-label="检索任务"
          />
          <div v-if="search.trim()" class="search-results" role="listbox">
            <button
              v-for="task in matches"
              :key="task.id"
              type="button"
              role="option"
              @click="select(task.id)"
            >
              {{ task.name }}
              <small v-if="closed.includes(task.id)">已关闭 · 点击打开</small>
            </button>
            <el-empty
              v-if="!matches.length"
              :image-size="40"
              description="无匹配任务"
            />
          </div>
        </div>
      </div>
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
        <span :title="task.name">{{ task.name }}</span
        ><small v-if="task.enabled === false">停用</small>
        <el-button
          :icon="Close"
          link
          :title="`关闭 ${task.name}`"
          @click.stop="close(task.id)"
        />
      </div>
      <span v-if="!visible.length" class="empty-tabs"
        >使用检索重新打开任务</span
      >
    </div>
    <Teleport to="body"
      ><div
        v-if="menu"
        class="task-context-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
      >
        <button @click="close(menu.id)">关闭标签</button
        ><button @click="closeOthers">关闭其他标签</button>
        <button
          @click="
            closed = [];
            dismiss();
          "
        >
          打开全部任务
        </button>
        <button
          class="danger"
          @click="
            emit('delete', menu.id);
            dismiss();
          "
        >
          删除任务配置…
        </button>
      </div></Teleport
    >
  </nav>
</template>
<style scoped>
.task-tabs {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
  min-width: 0;
  background: var(--el-bg-color);
}
.tab-tools {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}
.tool-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.dock-trigger {
  padding: 8px;
}
.search-box {
  position: relative;
  width: 180px;
  min-width: 120px;
}
.search-input {
  width: 100%;
}
.search-results {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 220px;
  max-height: 300px;
  overflow: auto;
  margin-top: 0;
  padding: 4px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
}
.search-results button {
  display: block;
  width: 100%;
  padding: 8px;
  text-align: left;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.search-results button:hover {
  background: var(--el-fill-color-light);
}
.search-results small {
  display: block;
  opacity: 0.65;
}
.tab-items {
  display: flex;
  gap: 4px;
  overflow: auto;
  min-width: 0;
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
.vertical .tab-tools {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
}
.vertical .add-dropdown {
  display: block;
  width: 100%;
}
.vertical .add-btn {
  width: 100%;
}
.vertical .tool-row {
  width: 100%;
  justify-content: flex-end;
}
.vertical .search-box {
  flex: 1;
  width: auto;
  min-width: 0;
}
.vertical .search-results {
  right: 0;
  left: auto;
  width: 100%;
  min-width: 0;
}
.vertical .tab-items {
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
