<script lang="ts" setup>
/**
 * SQL 编辑器（Monaco）
 * - 跟随系统亮/暗主题
 * - Ctrl+Enter / F9 执行（由父级按光标/选区切分语句）
 * - Ctrl+S 保存
 * - F12 格式化当前选区或光标所在语句
 * - 智能补全：写表名用本地表清单；写字段名按需拉列并缓存；Tab 接受建议
 * - 拖入 .sql / .txt：解析文本写入编辑器，并通知父级保存到当前库
 * - 按 tabId 复用 ITextModel + 恢复 viewState，切换页签不丢滚动位置与撤销栈
 * @author yanch
 */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { usePreferences } from '@vben/preferences';
import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import 'monaco-editor/min/vs/editor/editor.main.css';

import {
  detectCompletionContext,
  extractExecutableSql,
  extractExecutableSqlRange,
  getAllRememberedTables,
  getCachedColumns,
  getRememberedTables,
  matchColumnSuggestions,
  matchTableSuggestions,
  resolveTableTargetFromEditor,
  setCachedColumns,
} from '../../utils/sqlEditorAssist';
import { formatSqlByDialect } from '../../utils/formatSql';
import { resolveSqlDialect } from '../../dialect/sqlDialect';
import { useClientPreferences } from '../../composables/useClientPreferences';

// monaco-editor 0.56+：exports 映射为 "./*" -> "./esm/vs/*.js"
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

defineOptions({ name: 'SqlEditor' });

/** 拖入文件大小上限 2MB，与后端 SQL_TEXT_MAX 对齐 */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.sql', '.txt']);

const props = defineProps<{
  modelValue: string;
  /** 当前查询页签 ID：用于绑定独立 Monaco Model（保留撤销/滚动） */
  tabId?: string;
  /** 仍存活的页签 ID；不在列表内的 Model 会被释放 */
  aliveTabIds?: string[];
  dbConfigId?: number | string;
  /** 数据库类型码：用于方言触发字符等（不拆多套编辑器组件） */
  dbType?: string;
  /** 当前编辑器所属库 */
  instanceName?: string;
  /** 执行中锁定编辑 */
  readOnly?: boolean;
  /**
   * 缓存未命中时按需加载字段（返回字段名列表；主键可选）
   */
  loadColumns?: (
    instanceName: string,
    tableName: string,
  ) => Promise<{ columns: string[]; primaryKeys?: string[] }>;
  /** 当前库表清单为空时，按需从远端拉一次表名 */
  loadTables?: (instanceName: string) => Promise<string[]>;
}>();

const emit = defineEmits<{
  'update:modelValue': [string];
  execute: [];
  save: [];
  /**
   * 从本地文件导入 SQL 后通知父级：
   * 内容已写入编辑器，父级负责保存到当前连接+库
   */
  importFile: [{ fileName: string; content: string }];
  /** Ctrl+K / 右键「AI 助手」：把选区与全文交给浮窗 */
  askAi: [{ selectedSql: string; editorSql: string }];
  /** 右键「查看表信息」：把解析出的表交给父级弹窗 */
  viewTableInfo: [{ instanceName: string; tableName: string }];
}>();

const { isDark } = usePreferences();
const { sqlEditorFontSize } = useClientPreferences();
const container = ref<HTMLDivElement>();
const wrapEl = ref<HTMLDivElement>();
const dragOver = ref(false);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let completionDisposable: monaco.IDisposable | null = null;
/** 跨实例拉表进行中的 Promise，避免连敲触发重复 getTables */
const tablesLoadInflight = new Map<string, Promise<string[]>>();

/** 每个页签独立 Model + 滚动/光标视图状态 */
type TabEditorState = {
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
};
const tabStates = new Map<string, TabEditorState>();
let currentTabId: string | null = null;
/** 切换 Model 时忽略 modelValue 回写，避免误 setValue 清掉撤销栈 */
let applyingModelSwitch = false;

function themeName() {
  return isDark.value ? 'vs-dark' : 'vs';
}

function resolveTabKey(tabId?: string) {
  return tabId || '__default__';
}

function getOrCreateTabState(tabId: string, initialValue: string): TabEditorState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = {
      model: monaco.editor.createModel(initialValue || '', 'sql'),
      viewState: null,
    };
    tabStates.set(tabId, state);
  }
  return state;
}

/**
 * 切到指定页签：保存上一页签视图状态，挂上对应 Model 并恢复滚动/光标。
 * Model 复用可保留该页签的撤销栈。
 */
function switchToTab(tabId: string, sql: string) {
  if (!editor) return;
  const key = resolveTabKey(tabId);
  if (currentTabId && currentTabId !== key) {
    const prev = tabStates.get(currentTabId);
    if (prev) {
      prev.viewState = editor.saveViewState();
    }
  }
  const state = getOrCreateTabState(key, sql || '');
  applyingModelSwitch = true;
  try {
    // 外部改过该页签 SQL（如重新打开已保存查询）时同步内容；会重置该 Model 撤销栈
    if ((sql || '') !== state.model.getValue()) {
      state.model.setValue(sql || '');
    }
    editor.setModel(state.model);
    if (state.viewState) {
      editor.restoreViewState(state.viewState);
    }
    currentTabId = key;
  } finally {
    applyingModelSwitch = false;
  }
}

/** 释放已关闭页签的 Model，避免泄漏 */
function pruneTabStates(aliveIds?: string[]) {
  if (!aliveIds) return;
  const alive = new Set(aliveIds.map((id) => resolveTabKey(id)));
  for (const [id, state] of [...tabStates.entries()]) {
    if (alive.has(id)) continue;
    if (id === currentTabId) continue;
    state.model.dispose();
    tabStates.delete(id);
  }
}

function disposeAllTabStates() {
  for (const state of tabStates.values()) {
    state.model.dispose();
  }
  tabStates.clear();
  currentTabId = null;
}

/**
 * 校验并读取拖入的文本文件
 */
async function readImportFile(
  file: File,
): Promise<{ fileName: string; content: string } | null> {
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) {
    ElMessage.warning('仅支持拖入 .sql 或 .txt 文件');
    return null;
  }
  if (file.size <= 0) {
    ElMessage.warning('文件为空');
    return null;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    ElMessage.warning('文件过大（上限 2MB），请拆分后再导入');
    return null;
  }
  // 拒绝明显非文本 MIME（部分系统 type 为空，仍按扩展名放行）
  if (
    file.type &&
    !/^text\//i.test(file.type) &&
    file.type !== 'application/sql'
  ) {
    ElMessage.warning('仅支持文本类 SQL 文件');
    return null;
  }
  try {
    const content = await file.text();
    if (!content?.trim()) {
      ElMessage.warning('文件内容为空');
      return null;
    }
    return { fileName: name, content };
  } catch {
    ElMessage.error('读取文件失败');
    return null;
  }
}

function onDragEnter(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer?.types?.includes('Files')) {
    dragOver.value = true;
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
  dragOver.value = true;
}

function onDragLeave(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  const related = e.relatedTarget as Node | null;
  if (wrapEl.value && related && wrapEl.value.contains(related)) {
    return;
  }
  dragOver.value = false;
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  dragOver.value = false;
  if (props.readOnly) {
    ElMessage.warning('查询执行中，暂不可导入');
    return;
  }
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const parsed = await readImportFile(file);
  if (!parsed) return;
  if (editor) {
    editor.setValue(parsed.content);
    editor.focus();
  }
  emit('update:modelValue', parsed.content);
  emit('importFile', parsed);
}

async function resolveTableNames(schemaHint?: string): Promise<
  { tableName: string; schema?: string }[]
> {
  const dbId = props.dbConfigId;
  const inst = props.instanceName || '';
  if (dbId == null) return [];
  // 跨入异步内层函数后 TypeScript 不保留 props 派生值的窄化，固定成非空局部常量。
  const resolvedDbId: number | string = dbId;

  async function ensureTables(instanceName: string): Promise<
    { tableName: string; schema?: string }[]
  > {
    let list = getRememberedTables(resolvedDbId, instanceName);
    if (list.length || !props.loadTables) return list;
    const key = `${resolvedDbId}::${instanceName}`;
    let pending = tablesLoadInflight.get(key);
    if (!pending) {
      pending = props.loadTables(instanceName)
        .then((names) => {
          const arr = (names || []).filter(Boolean);
          // loadEditorTables 内部也会 remember；这里再兜底一次
          return arr;
        })
        .finally(() => {
          tablesLoadInflight.delete(key);
        });
      tablesLoadInflight.set(key, pending);
    }
    const names = await pending;
    list = getRememberedTables(resolvedDbId, instanceName);
    if (list.length) return list;
    return (names || []).map((tableName) => ({
      tableName,
      schema: instanceName,
    }));
  }

  // 显式写了 schema/实例名：只补全该实例下的表（可与当前 Tab 选中库不同）
  if (schemaHint) {
    return ensureTables(schemaHint);
  }

  let list = inst ? await ensureTables(inst) : [];
  const all = getAllRememberedTables(dbId);
  const map = new Map<string, { tableName: string; schema?: string }>();
  [...list, ...all].forEach((t) => {
    map.set(
      `${(t.schema || '').toLowerCase()}.${t.tableName.toLowerCase()}`,
      t,
    );
  });
  return [...map.values()];
}

async function resolveColumns(
  schema: string | undefined,
  table: string,
): Promise<string[]> {
  const dbId = props.dbConfigId;
  const inst = schema || props.instanceName || '';
  if (dbId == null || !inst || !table) return [];

  const cached = getCachedColumns(dbId, inst, table);
  if (cached) return cached.columns;

  if (!props.loadColumns) return [];
  try {
    const res = await props.loadColumns(inst, table);
    setCachedColumns(
      dbId,
      inst,
      table,
      res.columns || [],
      res.primaryKeys || [],
    );
    return res.columns || [];
  } catch {
    return [];
  }
}

function registerCompletion() {
  completionDisposable?.dispose();
  completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [
      ...resolveSqlDialect(props.dbType).completionTriggers,
      ',',
      '(',
    ],
    provideCompletionItems: async (model, position) => {
      if (!editor || model !== editor.getModel()) {
        return { suggestions: [] };
      }
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const ctx = detectCompletionContext(text, offset);
      if (ctx.kind === 'none') {
        return { suggestions: [] };
      }

      const range = {
        startLineNumber: model.getPositionAt(ctx.replaceFrom).lineNumber,
        startColumn: model.getPositionAt(ctx.replaceFrom).column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };

      if (ctx.kind === 'table') {
        const tables = await resolveTableNames(ctx.schema);
        const matched = matchTableSuggestions(
          tables,
          ctx,
          // 有显式 schema 时以该实例为准，避免用当前 Tab 库名误过滤
          ctx.schema || props.instanceName,
        );
        return {
          suggestions: matched.slice(0, 20).map((t, i) => {
            const label =
              ctx.schema || t.schema !== props.instanceName
                ? `${t.schema ? t.schema + '.' : ''}${t.tableName}`
                : t.tableName;
            const insert = ctx.schema ? t.tableName : label;
            return {
              label,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: insert,
              range,
              // 已按全词相关度排好序；pad 保证 Monaco 稳定采用该顺序
              sortText: '!' + String(i).padStart(4, '0'),
              // 用表名做过滤文本，避免 Monaco 默认分词把 gp_t_xxx 截断后误过滤
              filterText: t.tableName,
              // 感叹号确保排在默认文本建议之前，顺序仍由前面的 pad 决定
              preselect: i === 0,
              detail: '表',
            } as monaco.languages.CompletionItem;
          }),
        };
      }

      if (!ctx.table) {
        return { suggestions: [] };
      }
      const cols = await resolveColumns(ctx.schema, ctx.table);
      const matchedCols = matchColumnSuggestions(cols, ctx.prefix);
      return {
        suggestions: matchedCols.slice(0, 20).map((c, i) => ({
          label: c,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: c,
          range,
          sortText: String(i).padStart(4, '0'),
          filterText: c,
          detail: '列',
        })),
      };
    },
  });
}

onMounted(() => {
  if (!container.value) return;
  const tabKey = resolveTabKey(props.tabId);
  const state = getOrCreateTabState(tabKey, props.modelValue || '');
  editor = monaco.editor.create(container.value, {
    model: state.model,
    language: 'sql',
    theme: themeName(),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: sqlEditorFontSize.value,
    tabSize: 2,
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
    readOnly: !!props.readOnly,
    tabCompletion: 'on',
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: {
      showWords: false,
      insertMode: 'replace',
      preview: true,
      // 关闭优雅过滤/邻近加分，避免 Monaco 打乱我们按「全词前缀」排好的顺序
      filterGraceful: false,
      localityBonus: false,
      snippetsPreventQuickSuggestions: false,
    },
    acceptSuggestionOnCommitCharacter: true,
    acceptSuggestionOnEnter: 'on',
  });
  currentTabId = tabKey;
  editor.onDidChangeModelContent(() => {
    if (props.readOnly || applyingModelSwitch) return;
    emit('update:modelValue', editor?.getValue() || '');
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    if (!props.readOnly) emit('execute');
  });
  editor.addCommand(monaco.KeyCode.F9, () => {
    if (!props.readOnly) emit('execute');
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (!props.readOnly) emit('save');
  });
  editor.addCommand(monaco.KeyCode.F12, () => {
    if (!props.readOnly) formatCurrentSql();
  });
  // Ctrl+K + 右键菜单：唤出 AI 助手，携带选区 / 全文
  editor.addAction({
    id: 'lemon.askAi',
    label: 'AI 助手：生成/优化/解释 SQL',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
    run: () => emitAskAi(),
  });
  // 右键：对选中/光标处表名打开「查看表信息」（默认字段页由父级控制）
  editor.addAction({
    id: 'lemon.viewTableInfo',
    label: '查看表信息',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: () => emitViewTableInfo(),
  });
  // SQL 标识符含下划线，避免 Monaco 默认分词把 gp_t_project 拆成多段导致过滤异常
  if (!(window as any).__lemonSqlWordPattern) {
    (window as any).__lemonSqlWordPattern = true;
    monaco.languages.setLanguageConfiguration('sql', {
      wordPattern:
        /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    });
  }
  registerCompletion();
});

watch(
  () => props.readOnly,
  (v) => {
    editor?.updateOptions({ readOnly: !!v });
  },
);

watch(sqlEditorFontSize, (size) => {
  editor?.updateOptions({ fontSize: size });
});

/**
 * 页签切换：换 Model（保留撤销）并恢复滚动；
 * 同页签外部改 SQL：才 setValue（会清撤销，仅用于程序化写入）。
 */
watch(
  () => [props.tabId, props.modelValue] as const,
  ([tabId, sql]) => {
    if (!editor) return;
    const key = resolveTabKey(tabId);
    if (key !== currentTabId) {
      switchToTab(key, sql || '');
      return;
    }
    if (applyingModelSwitch) return;
    if ((sql || '') !== editor.getValue()) {
      editor.setValue(sql || '');
    }
  },
);

watch(
  () => props.aliveTabIds,
  (ids) => {
    pruneTabStates(ids);
  },
  { deep: true },
);

watch(isDark, () => {
  monaco.editor.setTheme(themeName());
});

onBeforeUnmount(() => {
  completionDisposable?.dispose();
  completionDisposable = null;
  // 先卸下 Model，再 dispose 编辑器与各页签 Model，避免重复 dispose
  if (editor) {
    if (currentTabId) {
      const cur = tabStates.get(currentTabId);
      if (cur) {
        cur.viewState = editor.saveViewState();
      }
    }
    editor.setModel(null);
    editor.dispose();
    editor = null;
  }
  disposeAllTabStates();
});

function insertText(text: string) {
  if (!editor) return;
  const selection = editor.getSelection();
  if (selection) {
    editor.executeEdits('', [
      { range: selection, text, forceMoveMarkers: true },
    ]);
  } else {
    editor.setValue((editor.getValue() || '') + text);
  }
  editor.focus();
}

/** 把当前选区与全文交给 AI 浮窗 */
function emitAskAi() {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const sel = editor.getSelection();
  const selected =
    sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
  emit('askAi', { selectedSql: selected, editorSql: model.getValue() });
}

/**
 * 取选区文本；无选区时向外扩展，拿到 schema.table 或带引号的标识符。
 */
function readTableTokenAtCursor(): string {
  if (!editor) return '';
  const model = editor.getModel();
  if (!model) return '';
  const sel = editor.getSelection();
  if (sel && !sel.isEmpty()) {
    return model.getValueInRange(sel);
  }
  const pos = editor.getPosition();
  if (!pos) return '';
  const line = model.getLineContent(pos.lineNumber);
  const idx = Math.max(0, pos.column - 1);
  const isIdentChar = (ch: string) => /[\w$#@.`"[\]]/.test(ch);
  let left = idx;
  let right = idx;
  while (left > 0 && isIdentChar(line[left - 1] || '')) left -= 1;
  while (right < line.length && isIdentChar(line[right] || '')) right += 1;
  return line.slice(left, right);
}

/** 解析选中/光标表名并通知父级打开表信息弹窗 */
function emitViewTableInfo() {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const token = readTableTokenAtCursor();
  const target = resolveTableTargetFromEditor(model.getValue(), token);
  if (!target?.table) {
    ElMessage.warning('请先选中或将光标放在表名上');
    return;
  }
  const instanceName = (target.schema || props.instanceName || '').trim();
  if (!instanceName) {
    ElMessage.warning('请先选择数据库 / Schema');
    return;
  }
  emit('viewTableInfo', {
    instanceName,
    tableName: target.table,
  });
}

/** 有选区替换选区；否则替换光标所在语句；再无则整体替换 */
function replaceSelectionOrAll(text: string) {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) {
    editor.setValue(text);
    return;
  }
  const sel = editor.getSelection();
  if (sel && !sel.isEmpty()) {
    editor.pushUndoStop();
    editor.executeEdits('ai-replace', [
      { range: sel, text, forceMoveMarkers: true },
    ]);
    editor.pushUndoStop();
    editor.focus();
    return;
  }
  const value = model.getValue();
  const pos = editor.getPosition() || sel?.getStartPosition();
  const cursor = pos ? model.getOffsetAt(pos) : value.length;
  const target = extractExecutableSqlRange(value, cursor, null);
  if (target) {
    const startPos = model.getPositionAt(target.range.start);
    const endPos = model.getPositionAt(target.range.end);
    const replaceRange = new monaco.Range(
      startPos.lineNumber,
      startPos.column,
      endPos.lineNumber,
      endPos.column,
    );
    editor.pushUndoStop();
    editor.executeEdits('ai-replace', [
      { range: replaceRange, text, forceMoveMarkers: true },
    ]);
    editor.pushUndoStop();
  } else {
    editor.setValue(text);
  }
  editor.focus();
}

function getSelectedText(): string {
  if (!editor) return '';
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel || sel.isEmpty()) return '';
  return model.getValueInRange(sel);
}

function getExecutableSql(): string {
  if (!editor) return props.modelValue || '';
  const model = editor.getModel();
  if (!model) return editor.getValue();
  const value = model.getValue();
  const sel = editor.getSelection();
  let selectionRange = null as { start: number; end: number } | null;
  if (sel && !sel.isEmpty()) {
    selectionRange = {
      start: model.getOffsetAt(sel.getStartPosition()),
      end: model.getOffsetAt(sel.getEndPosition()),
    };
  }
  const pos = editor.getPosition() || sel?.getStartPosition();
  const cursor = pos ? model.getOffsetAt(pos) : value.length;
  return extractExecutableSql(value, cursor, selectionRange);
}

function formatCurrentSql(): boolean {
  if (!editor) return false;
  const model = editor.getModel();
  if (!model) return false;

  const value = model.getValue();
  const sel = editor.getSelection();
  let selectionRange = null as { start: number; end: number } | null;
  if (sel && !sel.isEmpty()) {
    selectionRange = {
      start: model.getOffsetAt(sel.getStartPosition()),
      end: model.getOffsetAt(sel.getEndPosition()),
    };
  }
  const pos = editor.getPosition() || sel?.getStartPosition();
  const cursor = pos ? model.getOffsetAt(pos) : value.length;
  const target = extractExecutableSqlRange(value, cursor, selectionRange);
  if (!target) {
    ElMessage.warning('没有可格式化的 SQL');
    return false;
  }

  let formatted: string;
  try {
    formatted = formatSqlByDialect(target.text, props.dbType);
  } catch (e: any) {
    ElMessage.warning(e?.message || 'SQL 格式化失败，请检查语法');
    return false;
  }
  if (!formatted || formatted === target.text) {
    return true;
  }

  const startPos = model.getPositionAt(target.range.start);
  const endPos = model.getPositionAt(target.range.end);
  const replaceRange = new monaco.Range(
    startPos.lineNumber,
    startPos.column,
    endPos.lineNumber,
    endPos.column,
  );
  editor.pushUndoStop();
  editor.executeEdits('format-sql', [
    { range: replaceRange, text: formatted, forceMoveMarkers: true },
  ]);
  editor.pushUndoStop();

  const newEnd = model.getPositionAt(target.range.start + formatted.length);
  editor.setSelection(
    new monaco.Selection(
      startPos.lineNumber,
      startPos.column,
      newEnd.lineNumber,
      newEnd.column,
    ),
  );
  editor.focus();
  return true;
}

defineExpose({
  insertText,
  getValue: () => editor?.getValue() || '',
  getExecutableSql,
  formatSql: formatCurrentSql,
  replaceSelectionOrAll,
  getSelectedText,
});
</script>

<template>
  <div
    ref="wrapEl"
    class="sql-editor-wrap"
    :class="{ 'is-dragover': dragOver }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div ref="container" class="sql-editor" />
    <div v-show="dragOver" class="drop-hint">{{ $tr('松开以导入 .sql / .txt') }}</div>
  </div>
</template>

<style scoped>
.sql-editor-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 160px;
}
.sql-editor-wrap.is-dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -4px;
}
.sql-editor {
  width: 100%;
  height: 100%;
  min-height: 160px;
}
.drop-hint {
  pointer-events: none;
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  color: var(--el-color-primary);
  font-size: calc(var(--vc-ui-font-size, 13px) + 1px);
  font-weight: 600;
  z-index: 2;
}

/* 补全列表用 fixedOverflowWidgets 挂到外层，抬高层级避免被结果区挡住 */
:deep(.monaco-editor .suggest-widget),
:deep(.monaco-editor .editor-widget) {
  z-index: 100 !important;
}
</style>
