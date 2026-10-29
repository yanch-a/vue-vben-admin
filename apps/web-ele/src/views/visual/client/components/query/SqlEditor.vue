<script lang="ts" setup>
/**
 * SQL 编辑器（Monaco）
 * - 跟随系统亮/暗主题
 * - Ctrl+Enter / F9 执行（由父级按光标/选区切分语句）
 * - Ctrl+S 保存
 * - Ctrl+Q 直接关闭当前查询页签（不提示未保存）
 * - F12 格式化当前选区或光标所在语句
 * - 智能补全：写表名用本地表清单；写字段名按需拉列并缓存（多表联查合并各表字段）；Tab 接受建议
 * - 函数补全：按当前数据库方言列出内置函数，选中自动补括号；括号内显示参数提示，悬停显示说明
 * - 拖入 .sql / .txt：解析文本写入编辑器，并通知父级保存到当前库
 * - 按 tabId 复用 ITextModel + 恢复 viewState，切换页签不丢滚动位置与撤销栈
 * @author yanch
 */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { usePreferences } from '@vben/preferences';
import { ElMessage } from 'element-plus';
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';

import 'monaco-editor/min/vs/editor/editor.main.css';

import {
  detectCompletionContext,
  extractExecutableSql,
  extractExecutableSqlRange,
  getAllRememberedTables,
  getRememberedTables,
  locateStatementAt,
  matchColumnSuggestions,
  matchTableSuggestions,
  resolveTableTargetFromEditor,
  scoreIdentMatch,
  splitQualifiedTableName,
  type SqlCompletionContext,
} from '../../utils/sqlEditorAssist';
import { translateUiText } from '#/locales/ui-text';
import {
  matchSqlEditorShortcut,
  shouldAcceptSqlEditorShortcut,
} from './sqlEditorShortcuts';

import { formatSqlByDialect } from '../../utils/formatSql';
import { resolveSqlDialect } from '../../dialect/sqlDialect';
import {
  applyTypedCase,
  findSqlFunction,
  findSqlFunctionCallAt,
  formatSqlFunctionDoc,
  formatSqlFunctionSignature,
  listSqlFunctions,
  listSqlKeywords,
  resolveActiveParam,
  type SqlFunctionDef,
} from '../../dialect/sqlFunctions';
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
  /** PG/Oracle 等当前 Schema；有值时 sql 里的 db.table 前缀按 schema 解释 */
  schemaName?: string;
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
  /**
   * 嵌入其他页面时只保留编辑区（高亮、补全、格式化、拖入 SQL）。
   * 不注册关闭页签、AI、执行计划、查看表、改变表等查询客户端动作。
   */
  embedded?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [string];
  execute: [];
  /** Ctrl+Shift+E / 右键「执行计划」：对选中或当前语句做 EXPLAIN */
  explain: [];
  save: [];
  /** Ctrl+Q：直接关闭当前查询页签，不提示未保存 */
  'close-tab': [];
  /**
   * 从本地文件导入 SQL 后通知父级：
   * 内容已写入编辑器，父级负责保存到当前连接+库
   */
  importFile: [{ fileName: string; content: string }];
  /** Ctrl+K / 右键「AI 助手」：把选区与全文交给浮窗 */
  askAi: [{ selectedSql: string; editorSql: string }];
  /** 右键「查看表信息」：把解析出的表交给父级弹窗 */
  viewTableInfo: [{ instanceName: string; tableName: string }];
  /** 右键「改变表」：打开可视化表设计器（与对象树一致） */
  alterTable: [{
    instanceName: string;
    tableName: string;
    schemaName?: string;
  }];
}>();

const { isDark } = usePreferences();
const { sqlEditorFontSize } = useClientPreferences();
const container = ref<HTMLDivElement>();
const wrapEl = ref<HTMLDivElement>();
const dragOver = ref(false);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let completionDisposable: monaco.IDisposable | null = null;
/** 函数参数提示（光标在函数括号内时高亮当前参数） */
let signatureDisposable: monaco.IDisposable | null = null;
/** 鼠标悬停函数名时显示签名与说明 */
let hoverDisposable: monaco.IDisposable | null = null;
/** 跨实例拉表进行中的 Promise，避免连敲触发重复 getTables */
const tablesLoadInflight = new Map<string, Promise<string[]>>();
/**
 * 字段列表短期内存缓存。
 * 补全每敲一个字符都会重新计算，这里挡住连敲时对 IndexedDB / 接口的重复读取；
 * 过期后重新走 API 缓存，对象树刷新元数据后最多 30 秒就能看到新字段。
 */
const COLUMN_CACHE_TTL_MS = 30_000;
const columnCache = new Map<string, { at: number; promise: Promise<string[]> }>();
/** 单个分类最多返回的建议条数 */
const MAX_TABLE_SUGGESTIONS = 20;
const MAX_COLUMN_SUGGESTIONS = 60;
const MAX_FUNCTION_SUGGESTIONS = 30;
const MAX_KEYWORD_SUGGESTIONS = 8;

/** 每个页签独立 Model + 滚动/光标视图状态 */
type TabEditorState = {
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
};
const tabStates = new Map<string, TabEditorState>();
/**
 * keep-alive 下多页都会挂 Monaco：addCommand 会互相抢全局键绑定，
 * 后台页 handler 被 pageActive/focus 拦住后，前台页也可能再也收不到键 → 快捷键全失效。
 * 改为：仅当前激活页挂 window 捕获监听；Monaco addCommand 不再注册执行类快捷键。
 */
const pageActive = ref(true);
let editorShortcutBound = false;

function focusInThisEditor(): boolean {
  if (editor?.hasTextFocus()) return true;
  const ae = document.activeElement as Node | null;
  return !!(ae && container.value && container.value.contains(ae));
}

function onEditorPageKeydown(e: KeyboardEvent) {
  if (
    !shouldAcceptSqlEditorShortcut({
      pageActive: pageActive.value,
      readOnly: !!props.readOnly,
      focusInEditor: focusInThisEditor(),
      defaultPrevented: e.defaultPrevented,
      isComposing: e.isComposing,
      repeat: e.repeat,
    })
  ) {
    return;
  }
  const action = matchSqlEditorShortcut(e, !!props.embedded);
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (action === 'execute') emit('execute');
  else if (action === 'save') emit('save');
  else if (action === 'format') formatCurrentSql();
  else if (action === 'explain') emit('explain');
  else if (action === 'ask-ai') emitAskAi();
}

function bindEditorPageShortcuts() {
  if (editorShortcutBound) return;
  editorShortcutBound = true;
  window.addEventListener('keydown', onEditorPageKeydown, true);
}
function unbindEditorPageShortcuts() {
  if (!editorShortcutBound) return;
  editorShortcutBound = false;
  window.removeEventListener('keydown', onEditorPageKeydown, true);
}

function setPageShortcutActive(active: boolean) {
  pageActive.value = active;
  if (active) bindEditorPageShortcuts();
  else unbindEditorPageShortcuts();
}

onMounted(() => setPageShortcutActive(true));
onActivated(() => setPageShortcutActive(true));
onDeactivated(() => setPageShortcutActive(false));

/** 右键菜单动作：只要本页激活且非只读即可（不依赖焦点） */
function shouldHandleEditorShortcut(): boolean {
  return pageActive.value && !props.readOnly;
}

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
        // 拉表失败（实例名不存在、无权限）时按空清单处理，不能让补全整体报错
        .catch(() => [] as string[])
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

  // 显式写了 schema/实例名前缀
  if (schemaHint) {
    // PG / SQL Server / Oracle：当前库的表名本身就是 schema.table，前缀是 schema 而不是另一个库
    const hint = schemaHint.toLowerCase();
    const current = inst ? await ensureTables(inst) : [];
    const inSchema = current.filter(
      (t) => splitQualifiedTableName(t.tableName).qualifier.toLowerCase() === hint,
    );
    if (inSchema.length) return inSchema;
    // MySQL 等：前缀是库名，补全该库下的表（可与当前 Tab 选中库不同）
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

/**
 * SQL 里写的表 → 取字段接口要的「实例 + 表名」。
 * - PG / SQL Server / Oracle：对象树缓存的表名是 schema.table，取字段也要传限定名，
 *   所以 SQL 里写 orders 或 public.orders 都要先映射回缓存里的 public.orders
 * - MySQL 等：schema 前缀就是库名，直接当实例名
 */
function resolveColumnTarget(
  schema: string | undefined,
  table: string,
): { instanceName: string; tableName: string } | null {
  const dbId = props.dbConfigId;
  const inst = props.instanceName || '';
  if (dbId == null || !table) return null;
  const known = inst ? getRememberedTables(dbId, inst) : [];
  const lower = table.toLowerCase();

  if (schema) {
    const qualified = `${schema}.${table}`.toLowerCase();
    const hit = known.find((t) => t.tableName.toLowerCase() === qualified);
    if (hit) return { instanceName: inst, tableName: hit.tableName };
    // 当前页签有 schema（PG / Oracle 等）时，前缀是 schema，表仍在当前库下
    if (props.schemaName && inst) {
      return { instanceName: inst, tableName: `${schema}.${table}` };
    }
    return { instanceName: schema, tableName: table };
  }

  if (!inst) return null;
  const exact = known.find((t) => t.tableName.toLowerCase() === lower);
  if (exact) return { instanceName: inst, tableName: exact.tableName };
  // 没写 schema 但缓存里是 schema.table：优先当前页签 schema 下的同名表
  const sameBare = known.filter(
    (t) => splitQualifiedTableName(t.tableName).bare.toLowerCase() === lower,
  );
  if (sameBare.length) {
    const preferred = (props.schemaName || '').toLowerCase();
    const hit =
      sameBare.find(
        (t) => splitQualifiedTableName(t.tableName).qualifier.toLowerCase() === preferred,
      ) || sameBare[0]!;
    return { instanceName: inst, tableName: hit.tableName };
  }
  return { instanceName: inst, tableName: table };
}

/** 读取一张表的字段名，带短期内存缓存；失败按空列表处理且不缓存失败结果 */
function loadColumnsCached(target: {
  instanceName: string;
  tableName: string;
}): Promise<string[]> {
  if (!props.loadColumns) return Promise.resolve([]);
  const key = JSON.stringify([
    String(props.dbConfigId),
    target.instanceName,
    target.tableName.toLowerCase(),
  ]);
  const now = Date.now();
  const cached = columnCache.get(key);
  if (cached && now - cached.at < COLUMN_CACHE_TTL_MS) return cached.promise;
  const promise = props
    .loadColumns(target.instanceName, target.tableName)
    .then((res) => res?.columns || [])
    .catch(() => {
      columnCache.delete(key);
      return [] as string[];
    });
  columnCache.set(key, { at: now, promise });
  return promise;
}

/**
 * 按补全上下文收集候选字段。
 * 写了「别名.」时只取那张表；否则取当前语句 FROM / JOIN 的全部表，同名字段只保留一个。
 */
async function resolveContextColumns(
  ctx: SqlCompletionContext,
): Promise<{ name: string; source: string }[]> {
  const sources =
    !ctx.qualified && ctx.tables?.length
      ? ctx.tables.map((t) => ({ schema: t.schema, table: t.table, label: t.alias }))
      : ctx.table
        ? [{ schema: ctx.schema, table: ctx.table, label: ctx.table }]
        : [];
  const lists = await Promise.all(
    sources.map(async (s) => {
      const target = resolveColumnTarget(s.schema, s.table);
      const columns = target ? await loadColumnsCached(target) : [];
      return columns.map((name) => ({ name, source: s.label }));
    }),
  );
  const seen = new Set<string>();
  const out: { name: string; source: string }[] = [];
  for (const col of lists.flat()) {
    const key = col.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(col);
  }
  return out;
}

type SuggestRange = monaco.IRange;

async function buildTableSuggestions(
  ctx: SqlCompletionContext,
  range: SuggestRange,
): Promise<monaco.languages.CompletionItem[]> {
  const tables = await resolveTableNames(ctx.schema);
  const matched = matchTableSuggestions(
    tables,
    ctx,
    // 有显式 schema 时以该实例为准，避免用当前 Tab 库名误过滤
    ctx.schema || props.instanceName,
  );
  const close = ctx.closeQuote || '';
  return matched.slice(0, MAX_TABLE_SUGGESTIONS).map((t, i) => {
    const { qualifier, bare } = splitQualifiedTableName(t.tableName);
    let label: string;
    let insert: string;
    if (ctx.schema) {
      // 已写了 schema. 前缀：表名自带同名 schema 时只插裸表名，避免变成 public.public.orders
      insert =
        qualifier && qualifier.toLowerCase() === ctx.schema.toLowerCase()
          ? bare
          : t.tableName;
      label = qualifier ? t.tableName : `${t.schema ? t.schema + '.' : ''}${t.tableName}`;
    } else {
      label =
        t.schema && t.schema !== props.instanceName
          ? `${t.schema}.${t.tableName}`
          : t.tableName;
      insert = label;
    }
    return {
      label,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: insert + close,
      range,
      // 已按全词相关度排好序；感叹号 + pad 保证排在其它建议之前且顺序稳定
      sortText: '!' + String(i).padStart(4, '0'),
      // 过滤文本同时放裸表名和完整名：输入 or 或 pub 都能命中 public.orders
      filterText: qualifier && !ctx.schema ? `${bare} ${t.tableName}` : bare,
      preselect: i === 0,
      detail: translateUiText('表'),
    } as monaco.languages.CompletionItem;
  });
}

async function buildColumnSuggestions(
  ctx: SqlCompletionContext,
  range: SuggestRange,
): Promise<monaco.languages.CompletionItem[]> {
  const cols = await resolveContextColumns(ctx);
  if (!cols.length) return [];
  const sourceOf = new Map(cols.map((c) => [c.name, c.source]));
  const multiSource = new Set(cols.map((c) => c.source)).size > 1;
  const close = ctx.closeQuote || '';
  return matchColumnSuggestions(
    cols.map((c) => c.name),
    ctx.prefix,
  )
    .slice(0, MAX_COLUMN_SUGGESTIONS)
    .map((c, i) => ({
      label: c,
      kind: monaco.languages.CompletionItemKind.Field,
      insertText: c + close,
      range,
      sortText: '1' + String(i).padStart(4, '0'),
      filterText: c,
      // 多表联查时标出字段来自哪张表 / 别名
      detail: multiSource
        ? `${translateUiText('列')} · ${sourceOf.get(c)}`
        : translateUiText('列'),
    }));
}

/** 关键字只做前缀匹配；与输入完全相同的关键字排第一，回车不会被同前缀的函数抢走 */
function buildKeywordSuggestions(
  ctx: SqlCompletionContext,
  range: SuggestRange,
): monaco.languages.CompletionItem[] {
  const prefix = ctx.prefix.toLowerCase();
  return listSqlKeywords(props.dbType)
    .filter((kw) => kw.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, MAX_KEYWORD_SUGGESTIONS)
    .map((kw, i) => {
      const exact = kw.toLowerCase() === prefix;
      return {
        label: kw,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: applyTypedCase(kw, ctx.prefix),
        range,
        sortText: (exact ? '!!' : '2') + String(i).padStart(4, '0'),
        filterText: kw,
        preselect: exact,
        detail: translateUiText('关键字'),
      };
    });
}

/**
 * 函数建议：按当前数据库方言给出。
 * 选中后自动补括号并把光标放进括号里，同时弹出参数提示；
 * 光标后面已经有左括号时只替换函数名，不重复加括号。
 */
function buildFunctionSuggestions(
  ctx: SqlCompletionContext,
  range: SuggestRange,
  nextChar: string,
): monaco.languages.CompletionItem[] {
  const scored: { def: SqlFunctionDef; score: number }[] = [];
  for (const def of listSqlFunctions(props.dbType)) {
    const score = scoreIdentMatch(def.name, ctx.prefix);
    if (score == null) continue;
    scored.push({ def, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.def.name.length - b.def.name.length ||
      a.def.name.localeCompare(b.def.name),
  );
  const hasParen = nextChar === '(';
  const triggerHints = {
    id: 'editor.action.triggerParameterHints',
    title: '',
  };
  return scored.slice(0, MAX_FUNCTION_SUGGESTIONS).map(({ def }, i) => {
    const name = applyTypedCase(def.name, ctx.prefix);
    const item: monaco.languages.CompletionItem = {
      label: {
        label: def.name,
        detail: def.noParens ? '' : `(${def.params.join(', ')})`,
        description: def.category,
      },
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: name,
      range,
      sortText: '3' + String(i).padStart(4, '0'),
      filterText: def.name,
      detail: formatSqlFunctionSignature(def),
      documentation: { value: formatSqlFunctionDoc(def) },
    };
    if (def.noParens) return item;
    if (hasParen) {
      if (def.params.length) item.command = triggerHints;
      return item;
    }
    if (!def.params.length) {
      item.insertText = `${name}()`;
      return item;
    }
    item.insertText = `${name}($0)`;
    item.insertTextRules =
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    item.command = triggerHints;
    return item;
  });
}

/** 签名文本 + 各参数在文本中的 [start, end) 偏移；用偏移而不是子串，避免参数名撞上函数名里的字母 */
function buildSignatureInfo(def: SqlFunctionDef): monaco.languages.SignatureInformation {
  let label = `${def.name}(`;
  const parameters: monaco.languages.ParameterInformation[] = [];
  def.params.forEach((param, i) => {
    if (i > 0) label += ', ';
    const start = label.length;
    label += param;
    parameters.push({ label: [start, label.length] });
  });
  label += ')';
  const doc = def.example ? `${def.desc}\n\n示例：${def.example}` : def.desc;
  return { label, documentation: doc, parameters };
}

function registerCompletion() {
  completionDisposable?.dispose();
  signatureDisposable?.dispose();
  hoverDisposable?.dispose();
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
      const start = model.getPositionAt(ctx.replaceFrom);
      const range: SuggestRange = {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];
      if (ctx.kind === 'table') {
        suggestions.push(...(await buildTableSuggestions(ctx, range)));
      } else {
        if (ctx.kind === 'column') {
          suggestions.push(...(await buildColumnSuggestions(ctx, range)));
        }
        // 「别名.」后只能是字段；在引号里写的是标识符；没输入任何字符时不铺满函数列表
        if (!ctx.qualified && !ctx.closeQuote && ctx.prefix) {
          suggestions.push(
            ...buildKeywordSuggestions(ctx, range),
            ...buildFunctionSuggestions(ctx, range, text[offset] || ''),
          );
        }
      }
      // incomplete：每多输入一个字符都重新计算。
      // 不加时 Monaco 只在第一次返回的列表里本地过滤，而第一次只截取了前 N 条，
      // 目标表/字段不在其中就再也出不来 —— 这正是「输入两个字符就提示不出来」的根因。
      return { suggestions, incomplete: true };
    },
  });

  // 光标在函数括号内：显示签名并高亮当前是第几个参数
  signatureDisposable = monaco.languages.registerSignatureHelpProvider('sql', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    provideSignatureHelp: (model, position) => {
      if (!editor || model !== editor.getModel()) return null;
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const stmt = locateStatementAt(text, offset);
      const call = findSqlFunctionCallAt(text.slice(stmt?.start ?? 0, offset));
      if (!call) return null;
      const def = findSqlFunction(props.dbType, call.name);
      if (!def || def.noParens) return null;
      return {
        value: {
          signatures: [buildSignatureInfo(def)],
          activeSignature: 0,
          activeParameter: resolveActiveParam(def, call.argIndex),
        },
        dispose() {},
      };
    },
  });

  // 悬停函数名：只在后面紧跟左括号（或无括号伪函数）时提示，避免同名字段（如 date 列）误弹
  hoverDisposable = monaco.languages.registerHoverProvider('sql', {
    provideHover: (model, position) => {
      if (!editor || model !== editor.getModel()) return null;
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const def = findSqlFunction(props.dbType, word.word);
      if (!def) return null;
      const line = model.getLineContent(position.lineNumber);
      const after = line.slice(word.endColumn - 1).trimStart();
      if (!def.noParens && !after.startsWith('(')) return null;
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: [{ value: formatSqlFunctionDoc(def) }],
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
  // 执行/保存/格式化快捷键改由 window 捕获监听（见 onEditorPageKeydown），
  // 避免多 Monaco 实例 addCommand 抢全局绑定导致激活页快捷键全失效。
  // SQL 标识符含下划线，避免 Monaco 默认分词把 gp_t_project 拆成多段导致过滤异常
  if (!(window as any).__lemonSqlWordPattern) {
    (window as any).__lemonSqlWordPattern = true;
    monaco.languages.setLanguageConfiguration('sql', {
      wordPattern:
        /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    });
  }
  // 嵌入场景只要编辑区，查询客户端的页签/AI/表操作不带到 ETL 等页面。
  if (props.embedded) {
    registerCompletion();
    return;
  }
  // 右键菜单项。快捷键由父级在捕获阶段处理，避免和这里各关一次。
  // 父级只认物理 Ctrl+Q（不含 Cmd）：Windows/Linux 上 CtrlCmd 即 Ctrl，
  // macOS 上 CtrlCmd 是 Cmd，需改用 WinCtrl（Mac 的 Ctrl 键）。
  // 注意 monaco 没有 KeyMod.Ctrl，写错会变成 undefined | KeyQ，即单按 Q 就关页签。
  editor.addAction({
    id: 'lemon.closeQueryTab',
    label: '关闭当前',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 2,
    // 快捷键由父页 window 捕获处理；此处仅保留右键菜单
    run: () => {
      if (shouldHandleEditorShortcut()) emit('close-tab');
    },
  });
  // Ctrl+K + 右键菜单：唤出 AI 助手，携带选区 / 全文
  editor.addAction({
    id: 'lemon.askAi',
    label: 'AI 助手：生成/优化/解释 SQL',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    // Ctrl+K 由 onEditorPageKeydown（编辑器内）/ 父页（编辑器外）处理
    run: () => {
      if (shouldHandleEditorShortcut()) emitAskAi();
    },
  });
  // Ctrl+Shift+E + 右键菜单：查看选中/当前语句的执行计划（只读，不执行语句）
  editor.addAction({
    id: 'lemon.explainPlan',
    label: translateUiText('执行计划'),
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0.5,
    // Ctrl+Shift+E 由 onEditorPageKeydown 处理
    run: () => {
      if (shouldHandleEditorShortcut()) emit('explain');
    },
  });
  // 右键：对选中/光标处表名打开「查看表信息」（默认字段页由父级控制）
  editor.addAction({
    id: 'lemon.viewTableInfo',
    label: '查看表信息',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: () => emitViewTableInfo(),
  });
  // 右键：对选中/光标处表名打开「改变表」（与对象树 alterTable 同源）
  editor.addAction({
    id: 'lemon.alterTable',
    label: '改变表',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.6,
    run: () => emitAlterTable(),
  });
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
  setPageShortcutActive(false);
  completionDisposable?.dispose();
  completionDisposable = null;
  signatureDisposable?.dispose();
  signatureDisposable = null;
  hoverDisposable?.dispose();
  hoverDisposable = null;
  columnCache.clear();
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

/**
 * 从选区/光标解析表目标；失败时给出提示并返回 null。
 * instanceName 规则与「查看表信息」一致：优先 schema.table 前缀，否则用当前库。
 */
function resolveEditorTableTarget(): {
  instanceName: string;
  tableName: string;
  schemaToken?: string;
} | null {
  if (!editor) return null;
  const model = editor.getModel();
  if (!model) return null;
  const token = readTableTokenAtCursor();
  const target = resolveTableTargetFromEditor(model.getValue(), token);
  if (!target?.table) {
    ElMessage.warning('请先选中或将光标放在表名上');
    return null;
  }
  const schemaToken = (target.schema || '').trim() || undefined;
  const instanceName = (schemaToken || props.instanceName || '').trim();
  if (!instanceName) {
    ElMessage.warning('请先选择数据库 / Schema');
    return null;
  }
  return {
    instanceName,
    tableName: target.table,
    schemaToken,
  };
}

/** 解析选中/光标表名并通知父级打开表信息弹窗 */
function emitViewTableInfo() {
  const target = resolveEditorTableTarget();
  if (!target) return;
  emit('viewTableInfo', {
    instanceName: target.instanceName,
    tableName: target.tableName,
  });
}

/**
 * 解析选中/光标表名并通知父级打开「改变表」设计器。
 * 与对象树 alterTable 对齐：
 * - 有 schemaName（PG/Oracle）：当前库 + 前缀/页签 schema
 * - 无 schemaName（MySQL）：前缀当库名（与查看表信息一致）
 */
function emitAlterTable() {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const token = readTableTokenAtCursor();
  const target = resolveTableTargetFromEditor(model.getValue(), token);
  if (!target?.table) {
    ElMessage.warning('请先选中或将光标放在表名上');
    return;
  }
  const currentInstance = (props.instanceName || '').trim();
  const tabSchema = (props.schemaName || '').trim();
  const prefix = (target.schema || '').trim();

  let instanceName = '';
  let schemaName: string | undefined;
  if (tabSchema) {
    instanceName = currentInstance || prefix;
    schemaName = prefix || tabSchema;
  } else {
    instanceName = prefix || currentInstance;
  }
  if (!instanceName) {
    ElMessage.warning('请先选择数据库 / Schema');
    return;
  }
  emit('alterTable', {
    instanceName,
    tableName: target.table,
    schemaName,
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

function hasUserSelection(): boolean {
  const sel = editor?.getSelection();
  return !!(sel && !sel.isEmpty());
}

function getCursorOffset(): number {
  if (!editor) return 0;
  const model = editor.getModel();
  const pos = editor.getPosition();
  if (!model || !pos) return 0;
  return model.getOffsetAt(pos);
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
  getCursorOffset,
  hasUserSelection,
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
