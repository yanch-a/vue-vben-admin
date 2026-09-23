<script lang="ts" setup>
/**
 * 查询结果虚拟表：只渲染可视区附近的行，格子是普通 div（不是 Vue 组件）。
 * ElTable 会对每个格子挂 TableCell 组件 + 滚动层，1000×40 列就会把页面打到 GB 级。
 *
 * @author yanch
 */
import type { ComponentPublicInstance } from 'vue';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

defineOptions({ name: 'VirtualResultTable' });

const ROW_HEIGHT = 32;
const CHECK_WIDTH = 42;
/** 行号列宽（1-based，最多约 7 位数字） */
const ROW_NUM_WIDTH = 56;
const COL_MIN_WIDTH = 64;
const COL_DEFAULT_WIDTH = 120;
/** 内容超过该字符数时列宽固定为 COL_OVERFLOW_WIDTH，并省略号截断 */
const COL_CONTENT_CHAR_LIMIT = 200;
const COL_OVERFLOW_WIDTH = 150;
/** 12px 字体下单字符近似宽度（中英混排取折中） */
const CHAR_PX = 7.2;
const CELL_PAD_PX = 20;
/** 估算列宽时最多扫描的行数（虚拟表全量量 DOM 不可行） */
const WIDTH_SAMPLE_ROWS = 200;
const OVERSCAN = 8;

const props = defineProps<{
  rows: Record<string, any>[];
  columns: string[];
  emptyText?: string;
  editMode?: boolean;
  editingCell?: { row: number; col: string } | null;
  editDraft?: string;
  dirtyIndexes?: Set<number>;
  formatCell: (value: unknown) => string;
  isNullCell: (value: unknown) => boolean;
  /** Ctrl+F 命中的单元格，key = `${rowIndex}\0${col}` */
  findMatchKeys?: Set<string>;
  /** 当前定位到的命中单元格 */
  findActiveKey?: null | string;
  /** 当前单击选中的单元格（行高亮之外再描边） */
  activeCellKey?: null | string;
}>();

const emit = defineEmits<{
  'current-change': [row: Record<string, any> | undefined, index: number];
  'selection-change': [rows: Record<string, any>[]];
  /** 右键：带上列名（点在单元格上时）；点在行号/勾选列时 col 为空 */
  'row-contextmenu': [
    row: Record<string, any>,
    event: MouseEvent,
    col: string | null,
  ];
  /** 激活单元格（单击）；col 为空表示只选中行 */
  'cell-activate': [rowIndex: number, col: string | null];
  'cell-click': [rowIndex: number, col: string];
  'update:editDraft': [value: string];
  'cell-blur': [rowIndex: number, col: string];
  'cell-keydown': [event: KeyboardEvent];
  /** 正在编辑的行滚出可视区时，通知父级提交 */
  'edit-offscreen': [];
}>();

const scrollRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const viewportHeight = ref(320);
const viewportWidth = ref(640);
const scrollTop = ref(0);
const currentIndex = ref(-1);
const selected = ref<Set<number>>(new Set());

const rowCount = computed(() => props.rows?.length || 0);
const colCount = computed(() => props.columns?.length || 0);

/**
 * 每列宽度。拖动只改这一份数字，虚拟表只重绘可视行，
 * 和结果总行数无关，所以不按 1000 行关掉调列宽。
 */
/**
 * 每列宽度：按内容智能估算（采样前 WIDTH_SAMPLE_ROWS 行）。
 * - 列内最长展示文本 ≤ 200 字：按内容撑开，完整显示（不出现 ...）
 * - 超过 200 字：固定 150px，CSS 省略号
 * - 内容很少：按内容自适应（不低于 COL_MIN_WIDTH）
 * 用户拖拽改宽后不再自动重算。
 */
const colWidths = ref<number[]>([]);
/** 用户手改列宽后不再自动按内容重算 */
const userResized = ref(false);
const resizingIndex = ref(-1);

function cellTextLen(value: unknown): number {
  try {
    return props.formatCell(value).length;
  } catch {
    if (value == null) return 0;
    return String(value).length;
  }
}

function widthFromMaxChars(maxChars: number): number {
  if (maxChars > COL_CONTENT_CHAR_LIMIT) return COL_OVERFLOW_WIDTH;
  const px = Math.ceil(maxChars * CHAR_PX + CELL_PAD_PX);
  return Math.max(COL_MIN_WIDTH, px);
}

function estimateColWidths(): number[] {
  const cols = props.columns || [];
  const n = cols.length;
  if (n <= 0) return [];

  const rows = props.rows || [];
  const sample = Math.min(rows.length, WIDTH_SAMPLE_ROWS);
  const maxLens = cols.map((col) => String(col || '').length);

  for (let r = 0; r < sample; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < n; c++) {
      const col = cols[c]!;
      const len = cellTextLen(row[col]);
      if (len > maxLens[c]!) maxLens[c] = len;
    }
  }

  return maxLens.map((len) => widthFromMaxChars(len));
}

function initColWidths() {
  const n = colCount.value;
  if (n <= 0) {
    colWidths.value = [];
    return;
  }
  colWidths.value = estimateColWidths();
}


function widthAt(index: number) {
  return colWidths.value[index] || COL_DEFAULT_WIDTH;
}

const tableWidth = computed(() => {
  const sum = colWidths.value.reduce((s, w) => s + w, 0);
  return (
    CHECK_WIDTH +
    ROW_NUM_WIDTH +
    (sum || colCount.value * COL_DEFAULT_WIDTH)
  );
});

function findKey(rowIndex: number, col: string) {
  return `${rowIndex}\0${col}`;
}

function isFindMatch(rowIndex: number, col: string) {
  return !!props.findMatchKeys?.has(findKey(rowIndex, col));
}

function isFindActive(rowIndex: number, col: string) {
  return props.findActiveKey === findKey(rowIndex, col);
}

const bodyHeight = computed(() => rowCount.value * ROW_HEIGHT);

const startIndex = computed(() => {
  const i = Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN;
  return Math.max(0, i);
});

const endIndex = computed(() => {
  const visible = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2;
  return Math.min(rowCount.value, startIndex.value + visible);
});

const padTop = computed(() => startIndex.value * ROW_HEIGHT);

const visibleRows = computed(() => {
  const list = props.rows || [];
  const start = startIndex.value;
  const end = endIndex.value;
  const out: { row: Record<string, any>; index: number }[] = [];
  for (let i = start; i < end; i++) {
    const row = list[i];
    if (row) out.push({ row, index: i });
  }
  return out;
});

const selectedCount = computed(() => selected.value.size);
const allSelected = computed(
  () => rowCount.value > 0 && selectedCount.value === rowCount.value,
);
const partialSelected = computed(
  () => selectedCount.value > 0 && selectedCount.value < rowCount.value,
);

function isSelected(index: number) {
  return selected.value.has(index);
}

function emitSelection() {
  const rows = props.rows || [];
  const picked: Record<string, any>[] = [];
  selected.value.forEach((i) => {
    const row = rows[i];
    if (row) picked.push(row);
  });
  emit('selection-change', picked);
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(props.rows.map((_, i) => i));
  }
  emitSelection();
}

function toggleRow(index: number, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(index);
  else next.delete(index);
  selected.value = next;
  emitSelection();
}

function onRowClick(index: number) {
  currentIndex.value = index;
  emit('current-change', props.rows[index], index);
  // 点在行号/空白行区域：只选行，清除单元格焦点
  emit('cell-activate', index, null);
}

function onRowContextMenu(index: number, event: MouseEvent, col: string | null = null) {
  event.preventDefault();
  event.stopPropagation();
  currentIndex.value = index;
  const row = props.rows[index];
  if (!row) return;
  emit('current-change', row, index);
  emit('cell-activate', index, col);
  emit('row-contextmenu', row, event, col);
}

function onCellClick(index: number, col: string) {
  currentIndex.value = index;
  emit('current-change', props.rows[index], index);
  emit('cell-activate', index, col);
  if (props.editMode) {
    emit('cell-click', index, col);
  }
}

function rowClass(index: number) {
  const cls: string[] = [];
  if (index % 2 === 1) cls.push('is-stripe');
  if (index === currentIndex.value) cls.push('is-current');
  if (props.editMode && props.dirtyIndexes?.has(index)) cls.push('is-dirty-row');
  return cls.join(' ');
}

function isEditing(index: number, col: string) {
  return (
    !!props.editMode &&
    props.editingCell?.row === index &&
    props.editingCell?.col === col
  );
}

function isActiveCell(index: number, col: string) {
  return props.activeCellKey === `${index}\0${col}`;
}

function onScroll() {
  const el = scrollRef.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  const cell = props.editingCell;
  if (
    cell &&
    (cell.row < startIndex.value || cell.row >= endIndex.value)
  ) {
    emit('edit-offscreen');
  }
}

function measure() {
  const el = scrollRef.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight || 320;
  viewportWidth.value = el.clientWidth || 640;
}

function getSelectionRows() {
  const rows = props.rows || [];
  const picked: Record<string, any>[] = [];
  selected.value.forEach((i) => {
    const row = rows[i];
    if (row) picked.push(row);
  });
  return picked;
}

function clearSelection() {
  selected.value = new Set();
  currentIndex.value = -1;
}

/** 滚动到指定行（尽量置于可视区中部），供 Ctrl+F 定位 */
function scrollToRow(index: number) {
  const el = scrollRef.value;
  if (!el || index < 0) return;
  const max = Math.max(0, rowCount.value - 1);
  const i = Math.min(max, index);
  const target = Math.max(
    0,
    i * ROW_HEIGHT - Math.max(0, (viewportHeight.value - ROW_HEIGHT) / 2),
  );
  el.scrollTop = target;
  scrollTop.value = target;
  currentIndex.value = i;
}

/** 接收 Vue 模板 ref 的完整联合类型，仅保留原生输入框实例。 */
function setInputRef(el: ComponentPublicInstance | Element | null) {
  inputRef.value = el instanceof HTMLInputElement ? el : null;
}

let resizeStartX = 0;
let resizeStartW = 0;
let resizeRaf = 0;

function onResizeStart(index: number, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  resizingIndex.value = index;
  resizeStartX = event.clientX;
  resizeStartW = widthAt(index);
  document.body.classList.add('vrt-col-resizing');
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(event: MouseEvent) {
  if (resizingIndex.value < 0) return;
  const index = resizingIndex.value;
  const next = Math.max(
    COL_MIN_WIDTH,
    resizeStartW + (event.clientX - resizeStartX),
  );
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const list = colWidths.value.slice();
    list[index] = next;
    colWidths.value = list;
    userResized.value = true;
  });
}

function onResizeEnd() {
  resizingIndex.value = -1;
  document.body.classList.remove('vrt-col-resizing');
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', onResizeEnd);
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  measure();
  initColWidths();
  if (scrollRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      measure();
      // 列宽按内容估算，视口变化不强制重均分（避免把长列又压成一样宽）
    });
    ro.observe(scrollRef.value);
  }
});

onBeforeUnmount(() => {
  onResizeEnd();
  ro?.disconnect();
  ro = null;
});

watch(
  () => [
    props.columns.join('\0'),
    props.rows?.length || 0,
    // 同一长度换结果时也重算（取首行签名）
    props.rows?.[0] ? props.columns.map((c) => String(props.rows[0]?.[c] ?? '')).join('\0') : '',
  ],
  () => {
    userResized.value = false;
    initColWidths();
  },
);

watch(
  () => props.editingCell,
  async (cell) => {
    if (!cell) return;
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  },
);

defineExpose({
  getSelectionRows,
  clearSelection,
  scrollToRow,
});
</script>

<template>
  <div
    ref="scrollRef"
    class="vrt-scroll"
    @scroll="onScroll"
  >
    <div
      v-if="!columns.length"
      class="vrt-empty"
    >
      {{ $tr(emptyText || '暂无结果') }}
    </div>
    <template v-else>
      <div class="vrt-header" :style="{ width: tableWidth + 'px' }">
        <div class="vrt-th vrt-check" :style="{ width: CHECK_WIDTH + 'px' }">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="partialSelected"
            @change="toggleAll"
          />
        </div>
        <div
          class="vrt-th vrt-rownum"
          :style="{ width: ROW_NUM_WIDTH + 'px' }"
          :title="$tr('行号')"
        >
          #
        </div>
        <div
          v-for="(col, i) in columns"
          :key="col"
          class="vrt-th"
          :class="{ 'is-resizing': resizingIndex === i }"
          :style="{ width: widthAt(i) + 'px' }"
          :title="col"
        >
          {{ col }}
          <span
            class="vrt-resizer"
            :title="$tr('拖动调整列宽')"
            @mousedown="onResizeStart(i, $event)"
          />
        </div>
      </div>
      <div
        class="vrt-space"
        :style="{ height: bodyHeight + 'px', width: tableWidth + 'px' }"
      >
        <div
          v-if="rowCount === 0"
          class="vrt-empty"
        >
          {{ $tr(emptyText || '查询成功，无数据') }}
        </div>
        <div
          v-else
          class="vrt-body"
          :style="{ top: padTop + 'px', width: tableWidth + 'px' }"
        >
          <div
            v-for="item in visibleRows"
            :key="item.index"
            class="vrt-tr"
            :class="rowClass(item.index)"
            :style="{ height: ROW_HEIGHT + 'px' }"
            @click="onRowClick(item.index)"
            @contextmenu="onRowContextMenu(item.index, $event, null)"
          >
            <div
              class="vrt-td vrt-check"
              :style="{ width: CHECK_WIDTH + 'px' }"
              @click.stop
              @contextmenu.stop="onRowContextMenu(item.index, $event, null)"
            >
              <input
                type="checkbox"
                :checked="isSelected(item.index)"
                @change="
                  toggleRow(
                    item.index,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
            </div>
            <div
              class="vrt-td vrt-rownum"
              :style="{ width: ROW_NUM_WIDTH + 'px' }"
            >
              {{ item.index + 1 }}
            </div>
            <div
              v-for="(col, i) in columns"
              :key="col"
              class="vrt-td"
              :class="{
                'is-null': isNullCell(item.row[col]),
                'is-editable': editMode,
                'is-editing': isEditing(item.index, col),
                'is-find-match': isFindMatch(item.index, col),
                'is-find-active': isFindActive(item.index, col),
                'is-active-cell': isActiveCell(item.index, col),
              }"
              :style="{ width: widthAt(i) + 'px' }"
              :title="formatCell(item.row[col])"
              @click.stop="onCellClick(item.index, col)"
              @contextmenu.stop="onRowContextMenu(item.index, $event, col)"
            >
              <input
                v-if="isEditing(item.index, col)"
                :ref="setInputRef"
                class="vrt-editor"
                :value="editDraft"
                @click.stop
                @input="
                  emit(
                    'update:editDraft',
                    ($event.target as HTMLInputElement).value,
                  )
                "
                @blur="emit('cell-blur', item.index, col)"
                @keydown="emit('cell-keydown', $event)"
              />
              <template v-else>{{ formatCell(item.row[col]) }}</template>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vrt-scroll {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--el-bg-color);
  scrollbar-width: auto;
  scrollbar-color: var(--el-text-color-regular) var(--el-fill-color-dark);
}
.vrt-scroll::-webkit-scrollbar {
  width: 12px;
  height: 14px;
}
.vrt-scroll::-webkit-scrollbar-track {
  background: var(--el-fill-color-dark);
}
.vrt-scroll::-webkit-scrollbar-thumb {
  background: var(--el-text-color-regular);
  border-radius: 8px;
  border: 2px solid var(--el-fill-color-dark);
}
.vrt-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--el-color-primary);
}
.vrt-header {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  flex-shrink: 0;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}
.vrt-th,
.vrt-td {
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-right: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  line-height: 30px;
  padding: 0 8px;
}
.vrt-th {
  position: relative;
  font-weight: 600;
  color: var(--el-text-color-primary);
  height: 32px;
  line-height: 32px;
}
.vrt-th.is-resizing {
  background: var(--el-color-primary-light-9);
}
.vrt-resizer {
  position: absolute;
  top: 0;
  right: -4px;
  z-index: 3;
  width: 8px;
  height: 100%;
  cursor: col-resize;
}
.vrt-resizer:hover,
.vrt-th.is-resizing .vrt-resizer {
  background: var(--el-color-primary);
}
.vrt-check {
  position: sticky;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: inherit;
  border-right: 1px solid var(--el-border-color);
}
.vrt-rownum {
  position: sticky;
  left: 42px;
  z-index: 2;
  flex: none;
  padding: 0 4px;
  text-align: right;
  color: var(--el-text-color-secondary);
  background: inherit;
  border-right: 1px solid var(--el-border-color);
  user-select: none;
}
.vrt-header .vrt-check,
.vrt-header .vrt-rownum {
  z-index: 5;
  background: var(--el-fill-color-light);
}
.vrt-header .vrt-rownum {
  text-align: center;
  color: var(--el-text-color-regular);
}
.vrt-td.is-find-match {
  background: color-mix(in srgb, #ffe566 70%, transparent);
}
.vrt-td.is-find-active {
  background: color-mix(in srgb, #ff9632 75%, transparent);
  outline: 1px solid var(--el-color-warning);
  outline-offset: -1px;
}
.vrt-td.is-active-cell {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
  z-index: 1;
}
.vrt-space {
  position: relative;
}
.vrt-body {
  position: absolute;
  left: 0;
}
.vrt-tr {
  display: flex;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: default;
}
.vrt-tr.is-stripe {
  background: var(--el-fill-color-lighter);
}
.vrt-tr.is-current {
  background: var(--el-color-primary-light-9);
}
.vrt-tr.is-dirty-row {
  background: color-mix(in srgb, var(--el-color-warning) 28%, transparent);
}
.vrt-tr .vrt-check,
.vrt-tr .vrt-rownum {
  background: inherit;
}
.vrt-td.is-null {
  font-style: italic;
  color: var(--el-text-color-secondary);
}
.vrt-td.is-editable {
  cursor: text;
}
.vrt-td.is-editing {
  position: relative;
  z-index: 3;
  overflow: visible;
  padding: 0;
}
.vrt-editor {
  position: absolute;
  inset: -1px;
  box-sizing: border-box;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0 8px;
  font: inherit;
  line-height: inherit;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-color-primary);
  border-radius: 0;
  outline: none;
}
.vrt-empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>

<style>
/* 拖列宽时全局改光标，避免滑出表头后变成文本选择 */
body.vrt-col-resizing {
  cursor: col-resize !important;
  user-select: none !important;
}
body.vrt-col-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
