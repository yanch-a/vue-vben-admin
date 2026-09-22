<script lang="ts" setup>
/**
 * 查询结果面板
 * - 工具栏：表格编辑、导出 Excel/SQL、复制全部/选定行（TSV 可粘贴 Excel）
 * - 选中行右键：修改（弹窗）/ 删除 / 拷贝 INSERT / 拷贝 UPDATE / 复制行
 * - 表格编辑：同一张结果表点单元格改，脏行底色，保存时按原值 WHERE 逐行 UPDATE（主键可改）
 * - 联表：改哪张表就必须带上该表主键，只按主键 UPDATE，不按全列定位
 * - 结果表用虚拟滚动（非 ElTable）：避免 1000 行 × N 列挂上万个单元格组件把页面打到 GB 级
 *
 * @author yanch
 */
import type { QueryResultState } from '../../composables/useQueryTabs';
import type { TableRef } from '../../utils/resultRowSql';
import type { ResultTableMeta } from '../../utils/resultJoinUpdate';
import type { DirtyRowEdit } from '../../utils/resultSheetValue';

import {
  computed,
  h,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { ElCheckbox, ElMessage, ElMessageBox } from 'element-plus';

import { buildResultTsv } from '../../utils/resultClipboard';
import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
  parseQueryTables,
} from '../../utils/resultRowSql';
import {
  buildMongoDeleteCommand,
  buildMongoInsertCommand,
  buildMongoUpdateCommand,
  isMongoDbType,
  isMongoEditableQuery,
} from '../../utils/mongoCommand';
import {
  buildJoinCopyUpdateSqls,
  buildJoinUpdateSqls,
} from '../../utils/resultJoinUpdate';
import {
  coerceSheetValue,
  collectDirtyFromRows,
  sameDbValue,
  toSheetText,
} from '../../utils/resultSheetValue';
import { isClientPolicyError } from '../../utils/sqlWriteGuard';
import {
  rememberSkipNoPkWarn,
  shouldSkipNoPkWarn,
} from '../../utils/resultPrimaryKeys';
import VirtualResultTable from './VirtualResultTable.vue';

defineOptions({ name: 'ResultPanel' });

const props = defineProps<{
  visible: boolean;
  activeTab: 'result' | 'messages';
  result: QueryResultState | null;
  executing?: boolean;
  exporting?: boolean;
  /** 解析出的目标表；为空时改删仅提示，拷贝仍尽量生成 */
  tableRef?: TableRef | null;
  /** 联表时每张 FROM/JOIN 表的列与主键 */
  tableMetas?: ResultTableMeta[];
  dbType?: string;
  /** 表主键列（已从元数据解析；空数组表示确认无主键） */
  primaryKeys?: string[];
  /** 主键元数据是否已拉取完 */
  primaryKeysReady?: boolean;
  /** 进入编辑前再拉一次主键，避免空缓存误报无主键 */
  ensurePrimaryKeys?: () => Promise<string[]>;
  /**
   * 静默执行单条 DML（不刷新结果）。
   * 表格编辑按行保存，中途失败时要保住未提交的脏行。
   */
  executeRowDml?: (sql: string) => Promise<unknown>;
  /** 同一行涉及多表时，在后端同一事务中提交。 */
  executeRowDmlBatch?: (sqls: string[]) => Promise<unknown>;
}>();

const emit = defineEmits<{
  'update:visible': [boolean];
  'update:activeTab': ['result' | 'messages'];
  /** 执行 DML 后由父级刷新结果 */
  'run-dml': [sql: string];
  /** 批量保存成功后，按原 SELECT 重查 */
  'refresh-result': [];
  /** 请求后台重查并导出 xlsx */
  'export-excel': [];
  /** 请求后台重查并按方言导出 INSERT .sql */
  'export-sql': [];
  /** Messages 报错：把 SQL + 错误交给 AI 修复 */
  askAiFix: [{ sql: string; error: string }];
}>();

const canExport = computed(
  () => !!(props.result?.sourceSql && String(props.result.sourceSql).trim()),
);

const canCopyRows = computed(
  () => !!(props.result?.columns?.length && props.result?.rows?.length),
);

const selectedRow = ref<Record<string, any> | null>(null);
const selectedIndex = ref(-1);
/** 多选行（用于「复制选定行」） */
const selectedRows = ref<Record<string, any>[]>([]);
const tableElRef = ref<{
  getSelectionRows?: () => Record<string, any>[];
  clearSelection?: () => void;
  scrollToRow?: (index: number) => void;
} | null>(null);
/** 结果面板根节点：用于判断 Ctrl+F 是否落在结果区 */
const panelRef = ref<HTMLElement | null>(null);
const findInputRef = ref<HTMLInputElement | null>(null);
/** 最近一次点击落在结果面板内（避免抢走 SQL 编辑器的 Ctrl+F） */
const resultFocused = ref(false);

const findVisible = ref(false);
const findQuery = ref('');
const findMatchIndex = ref(0);
type FindHit = { col: string; row: number };
const findHits = shallowRef<FindHit[]>([]);

const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
});

const editVisible = ref(false);
const editForm = ref<Record<string, any>>({});
const editOriginal = ref<Record<string, any> | null>(null);

/** 是否处于单元格编辑 */
const editMode = ref(false);
const sheetSaving = ref(false);
const dirtyCount = ref(0);
const dirtyIndexSet = shallowRef(new Set<number>());
/** 编辑副本（浅拷贝，不包深层响应式） */
const editRows = shallowRef<Record<string, any>[]>([]);
/** 进入编辑时的原值快照，WHERE / 对比用 */
let originalRows: Record<string, unknown>[] = [];
const editingCell = ref<{ row: number; col: string } | null>(null);
const editDraft = ref('');
/** 保存成功后父级会换新 result，此时不要提示「修改已丢弃」 */
const expectResultRefresh = ref(false);

const columns = computed(() => props.result?.columns || []);
/** 行数据不做深层响应式；表格仅展示 */
const tableRows = computed(() => props.result?.rows || []);
const displayRows = computed(() =>
  editMode.value ? editRows.value : tableRows.value,
);
const dbType = computed(() => props.dbType || 'MY_SQL');
const isMongo = computed(() => isMongoDbType(dbType.value));

function matchResultColumn(name: string, cols: string[]): string | undefined {
  if (cols.includes(name)) return name;
  const lower = String(name).toLowerCase();
  return cols.find((c) => c.toLowerCase() === lower);
}

/** 结果集里实际带上的主键列（用结果列的真实大小写，忽略元数据大小写差异） */
const pkInResult = computed(() =>
  (props.primaryKeys || [])
    .map((k) => matchResultColumn(k, columns.value))
    .filter((k): k is string => !!k),
);
const tableHasPk = computed(() => (props.primaryKeys || []).length > 0);
/** 有主键只用主键；无主键才退回结果列（执行前会再确认） */
const whereCols = computed(() =>
  tableHasPk.value ? pkInResult.value : columns.value,
);

const isJoinQuery = computed(() => {
  if (isMongo.value) {
    return !isMongoEditableQuery(props.result?.sourceSql || '');
  }
  if ((props.tableMetas?.length || 0) > 1) return true;
  const sql = props.result?.sourceSql || '';
  return parseQueryTables(sql).length > 1;
});

const tableHintText = computed(() => {
  const metas = props.tableMetas || [];
  if (metas.length > 1) {
    const names = metas.map((m) => {
      const n = m.ref.schema ? `${m.ref.schema}.${m.ref.table}` : m.ref.table;
      return m.alias && m.alias !== m.ref.table ? `${n} ${m.alias}` : n;
    });
    return `联表：${names.join(', ')}（按各表主键更新）`;
  }
  const t = props.tableRef;
  if (!t?.table) return '';
  return `表：${t.schema ? `${t.schema}.` : ''}${t.table}`;
});

const canMutate = computed(
  () =>
    (!!props.tableRef?.table || (props.tableMetas?.length || 0) > 0) &&
    !!selectedRow.value,
);
const canDeleteRow = computed(() => canMutate.value && !isJoinQuery.value);
const canCopyInsert = computed(() => canMutate.value && !isJoinQuery.value);

/** 进入表格编辑不依赖当前选中行；单表或联表均可（联表按各表主键保存） */
const canEnterSheet = computed(
  () =>
    (!!props.tableRef?.table || (props.tableMetas?.length || 0) > 0) &&
    columns.value.length > 0 &&
    tableRows.value.length > 0 &&
    !props.executing &&
    !sheetSaving.value,
);

/**
 * 修改/删除前检查主键：有主键必须出现在结果里；无主键先警告可能误伤其它行。
 * 联表不走「无主键全列 WHERE」，改哪张表就要求该表主键出现在结果中（保存时再校验）。
 * 进入编辑前会再拉一次主键，避免空缓存把有主键的表当成无主键。
 */
async function confirmRowMutation(action: '修改' | '删除'): Promise<boolean> {
  if (props.ensurePrimaryKeys) {
    await props.ensurePrimaryKeys();
    await nextTick();
  }
  if (props.primaryKeysReady === false) {
    ElMessage.warning('正在读取表主键，请稍后再试');
    return false;
  }
  if (isJoinQuery.value) {
    if (action === '删除') {
      ElMessage.warning('联表结果不支持删除，请对单表查询后再删');
      return false;
    }
    return true;
  }
  if (tableHasPk.value && pkInResult.value.length === 0) {
    ElMessage.warning(
      `当前结果未包含主键（${(props.primaryKeys || []).join(', ')}），无法按主键定位。请在 SELECT 中带上主键列后再${action}`,
    );
    return false;
  }
  if (!tableHasPk.value) {
    if (shouldSkipNoPkWarn()) {
      return true;
    }
    const skipState = reactive({ skip: false });
    try {
      await ElMessageBox({
        title: '无主键风险提示',
        type: 'warning',
        showCancelButton: true,
        confirmButtonText: `仍要${action}`,
        cancelButtonText: '取消',
        message: () =>
          h('div', { class: 'no-pk-warn' }, [
            h(
              'p',
              { style: 'margin: 0 0 12px; line-height: 1.5;' },
              `未能识别到主键。${action}将按结果列的旧值匹配，只查出一列时可能改到其它行。`,
            ),
            h(
              ElCheckbox,
              {
                modelValue: skipState.skip,
                'onUpdate:modelValue': (v: boolean | string | number) => {
                  skipState.skip = v === true;
                },
              },
              () => '7天内不再提示',
            ),
          ]),
      });
      if (skipState.skip) {
        rememberSkipNoPkWarn();
      }
    } catch {
      return false;
    }
  }
  return true;
}

/** Messages 区文案：附带服务端耗时与响应到前台耗时 */
const messagesText = computed(() => {
  const r = props.result;
  if (!r) return 'Ready';
  const lines: string[] = [];
  const base =
    r.error ||
    r.message ||
    `查询完成，返回 ${r.rowCount ?? 0} 行`;
  lines.push(String(base));
  if (r.elapsedMs != null && !Number.isNaN(r.elapsedMs)) {
    lines.push(`服务端查询耗时: ${r.elapsedMs} ms`);
  }
  if (r.clientElapsedMs != null && !Number.isNaN(r.clientElapsedMs)) {
    lines.push(`响应到前台耗时: ${r.clientElapsedMs} ms`);
  }
  return lines.join('\n');
});

const policyError = computed(() => isClientPolicyError(props.result?.error || ''));

/** 仅查询结果集显示行数；DDL/DML 没有列，标签保持 Result */
const resultTabLabel = computed(() => {
  const r = props.result;
  if (!r?.columns?.length) return 'Result';
  const n = r.rowCount ?? r.rows?.length ?? 0;
  return `Result (${n})`;
});

/** 状态栏展示的总行数（优先服务端 rowCount） */
const statusRowCount = computed(() => {
  const r = props.result;
  if (!r?.columns?.length) return 0;
  return r.rowCount ?? r.rows?.length ?? 0;
});

/** 修改弹窗 label 按最长列名自适应，避免截断 */
const editLabelWidth = computed(() => {
  let max = 0;
  for (const c of columns.value) {
    max = Math.max(max, String(c || '').length);
  }
  return `${Math.min(320, Math.max(140, max * 13 + 20))}px`;
});

const findMatchKeys = computed(() => {
  const set = new Set<string>();
  for (const h of findHits.value) {
    set.add(`${h.row}\0${h.col}`);
  }
  return set;
});

const findActiveKey = computed(() => {
  const hit = findHits.value[findMatchIndex.value];
  return hit ? `${hit.row}\0${hit.col}` : null;
});

const findStatusText = computed(() => {
  const n = findHits.value.length;
  if (!findQuery.value.trim()) return '';
  if (!n) return '无结果';
  return `${findMatchIndex.value + 1}/${n}`;
});

function closeCtxMenu() {
  ctxMenu.visible = false;
}

function onRowContextMenu(row: Record<string, any>, event: MouseEvent) {
  event.preventDefault();
  selectedRow.value = row;
  const pad = 8;
  const menuW = 220;
  const menuH = 260;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.visible = true;
}

function onCurrentChange(
  row: Record<string, any> | undefined,
  index?: number,
) {
  selectedRow.value = row || null;
  selectedIndex.value =
    index != null && index >= 0
      ? index
      : row && props.result?.rows
        ? props.result.rows.indexOf(row)
        : -1;
}

function onSelectionChange(rows: Record<string, any>[]) {
  selectedRows.value = rows || [];
}

async function copyText(text: string, tip: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(tip);
  } catch {
    // 降级
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    ElMessage.success(tip);
  }
}

function requireTable(): TableRef {
  if (!props.tableRef?.table) {
    throw new Error('无法识别结果对应的表，请使用单表 SELECT（如 SELECT * FROM db.table）');
  }
  return props.tableRef;
}

function joinUpdateContext() {
  const tables = props.tableMetas || [];
  if (!tables.length) {
    throw new Error('无法识别联表，请检查 FROM / JOIN');
  }
  return {
    tables,
    resultCols: columns.value,
    sourceSql: props.result?.sourceSql || '',
    dbType: dbType.value,
    columnTables: props.result?.columnTables,
  };
}

function buildEditsSqls(item: DirtyRowEdit): string[] {
  if (isMongo.value) {
    if (!isMongoEditableQuery(props.result?.sourceSql || '')) {
      throw new Error('MongoDB 聚合/命令结果不支持直接编辑，请对单集合执行 find/findOne');
    }
    const table = requireTable();
    return [
      buildMongoUpdateCommand(
        table,
        item.original as Record<string, any>,
        item.edited as Record<string, any>,
        item.changedColumns,
        whereCols.value,
      ),
    ];
  }
  if (isJoinQuery.value) {
    if ((props.tableMetas?.length || 0) < 2) {
      throw new Error('正在读取联表信息，请稍后再保存');
    }
    const ctx = joinUpdateContext();
    return buildJoinUpdateSqls(
      item,
      ctx.tables,
      ctx.resultCols,
      ctx.sourceSql,
      ctx.dbType,
      ctx.columnTables,
    );
  }
  const table = requireTable();
  return [
    buildUpdateSql(
      table,
      item.original as Record<string, any>,
      item.edited as Record<string, any>,
      item.changedColumns,
      whereCols.value,
      dbType.value,
    ),
  ];
}

/**
 * 复制结果行到剪切板（TSV + 表头，可粘贴 Excel）
 * @author yanch
 */
function copyRowsToClipboard(rows: Record<string, any>[], tip: string) {
  if (!columns.value.length) {
    ElMessage.warning('暂无结果列');
    return;
  }
  if (!rows.length) {
    ElMessage.warning('没有可复制的行');
    return;
  }
  const tsv = buildResultTsv(columns.value, rows);
  copyText(tsv, tip);
}

function onCopyAllRows() {
  closeCtxMenu();
  const rows = props.result?.rows || [];
  copyRowsToClipboard(rows, `已复制全部 ${rows.length} 行（含表头）`);
}

function onCopySelectedRows() {
  closeCtxMenu();
  // 优先用多选；若无多选但有当前高亮行，则复制该行
  let rows = selectedRows.value.length
    ? selectedRows.value
    : tableElRef.value?.getSelectionRows?.() || [];
  if (!rows.length && selectedRow.value) {
    rows = [selectedRow.value];
  }
  if (!rows.length) {
    ElMessage.warning('请先勾选或点击选中要复制的行');
    return;
  }
  copyRowsToClipboard(rows, `已复制选定 ${rows.length} 行（含表头）`);
}

/**
 * 导出 SQL：交由父级走后台方言生成（多库兼容）
 * @author yanch
 */
function onExportSql() {
  if (!props.result?.sourceSql?.trim()) {
    ElMessage.warning('没有可导出的查询 SQL，请先执行查询');
    return;
  }
  try {
    requireTable();
  } catch (e: any) {
    ElMessage.warning(e?.message || '无法识别结果对应的表');
    return;
  }
  emit('export-sql');
}

function onExportCommand(cmd: string) {
  if (cmd === 'excel') {
    emit('export-excel');
  } else if (cmd === 'sql') {
    onExportSql();
  }
}

function onCopyCommand(cmd: string) {
  if (cmd === 'all') {
    onCopyAllRows();
  } else if (cmd === 'selected') {
    onCopySelectedRows();
  }
}

function onCopyInsert() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  if (isJoinQuery.value) {
    ElMessage.warning('联表结果不支持拷贝 INSERT，请对单表查询后再拷贝');
    return;
  }
  try {
    const ref = requireTable();
    if (isMongo.value) {
      const command = buildMongoInsertCommand(ref, selectedRow.value, columns.value);
      copyText(command, '已复制 MongoDB insertOne 命令');
      return;
    }
    const sql = buildInsertSql(ref, selectedRow.value, columns.value, dbType.value);
    copyText(sql, '已复制 INSERT 语句');
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成失败');
  }
}

function onCopyUpdate() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  try {
    if (isMongo.value) {
      const ref = requireTable();
      const command = buildMongoUpdateCommand(
        ref,
        selectedRow.value,
        selectedRow.value,
        columns.value,
        whereCols.value,
      );
      copyText(command, '已复制 MongoDB updateOne 命令');
      return;
    }
    if (isJoinQuery.value) {
      const ctx = joinUpdateContext();
      const sqls = buildJoinCopyUpdateSqls(
        selectedRow.value,
        ctx.tables,
        ctx.resultCols,
        ctx.sourceSql,
        ctx.dbType,
        ctx.columnTables,
      );
      copyText(sqls.join('\n'), '已复制联表 UPDATE（按各表主键）');
      return;
    }
    const ref = requireTable();
    const sql = buildUpdateSql(
      ref,
      selectedRow.value,
      selectedRow.value,
      columns.value,
      whereCols.value,
      dbType.value,
    );
    copyText(
      sql,
      tableHasPk.value
        ? '已复制 UPDATE 语句（按主键）'
        : '已复制 UPDATE 语句（无主键，WHERE 为结果列旧值）',
    );
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成失败');
  }
}

async function onEdit() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  if (!canMutate.value) {
    ElMessage.warning('无法识别结果对应的表，请先执行带 FROM 的查询后再修改');
    return;
  }
  if (!(await confirmRowMutation('修改'))) {
    return;
  }
  editOriginal.value = { ...selectedRow.value };
  editForm.value = { ...selectedRow.value };
  editVisible.value = true;
}

/**
 * 编辑框输入：原值为 NULL 且输入为空 → 保持 NULL；否则按字符串写入
 */
function onEditField(col: string, v: string) {
  const original = editOriginal.value?.[col];
  if (
    (original === null || original === undefined) &&
    (v === '' || v == null)
  ) {
    editForm.value[col] = null;
    return;
  }
  if (isMongo.value && original && typeof original === 'object') {
    try {
      editForm.value[col] = JSON.parse(v);
      return;
    } catch {
      // 保留文本，让后端拒绝非法 JSON，而不是静默丢失用户输入。
    }
  }
  editForm.value[col] = isMongo.value
    ? coerceSheetValue(original, v)
    : v;
}

async function onDelete() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  if (!canDeleteRow.value) {
    ElMessage.warning(
      isJoinQuery.value
        ? '联表结果不支持删除，请对单表查询后再删'
        : '无法识别结果对应的表，请使用单表查询后再删除',
    );
    return;
  }
  if (!(await confirmRowMutation('删除'))) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      tableHasPk.value
        ? '确认按主键删除选中行？删除后不可恢复。'
        : '确认删除选中行？当前无主键，可能删除多行，且不可恢复。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const ref = requireTable();
    if (isMongo.value) {
      const command = buildMongoDeleteCommand(
        ref,
        selectedRow.value,
        columns.value,
        whereCols.value,
      );
      emit('run-dml', command);
      return;
    }
    const sql = buildDeleteSql(
      ref,
      selectedRow.value,
      columns.value,
      whereCols.value,
      dbType.value,
    );
    emit('run-dml', sql);
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成 DELETE 失败');
  }
}

async function onSaveEdit() {
  if (!editOriginal.value) return;
  const changedColumns = columns.value.filter(
    (c) => !sameDbValue(editOriginal.value![c], editForm.value[c]),
  );
  if (!changedColumns.length) {
    ElMessage.info('没有需要保存的修改');
    editVisible.value = false;
    return;
  }
  try {
    const sqls = buildEditsSqls({
      rowIndex: selectedIndex.value,
      original: editOriginal.value,
      edited: editForm.value,
      changedColumns,
    });
    if (isJoinQuery.value) {
      if (!props.executeRowDmlBatch) {
        ElMessage.error('当前页未提供事务更新接口，无法安全保存联表修改');
        return;
      }
      editVisible.value = false;
      await props.executeRowDmlBatch(sqls);
      expectResultRefresh.value = true;
      emit('refresh-result');
      return;
    }
    editVisible.value = false;
    emit('run-dml', sqls[0]!);
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成 UPDATE 失败');
  }
}

function cloneRows(rows: Record<string, any>[]): Record<string, any>[] {
  return (rows || []).map((r) => ({ ...r }));
}

function resetEditCopies() {
  originalRows = cloneRows(tableRows.value);
  editRows.value = markRaw(cloneRows(tableRows.value));
  dirtyIndexSet.value = new Set();
  dirtyCount.value = 0;
  editingCell.value = null;
  editDraft.value = '';
}

function refreshDirtySet() {
  const edits = collectDirtyFromRows(
    originalRows,
    editRows.value,
    columns.value,
  );
  dirtyIndexSet.value = new Set(edits.map((e) => e.rowIndex));
  dirtyCount.value = edits.length;
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) {
    return editMode.value ? 'NULL' : '';
  }
  if (isMongo.value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function editFieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isMongo.value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isNullCell(value: unknown): boolean {
  return value === null || value === undefined;
}

async function startEditCell(rowIndex: number, col: string) {
  if (!editMode.value || sheetSaving.value) return;
  await commitEditingCell();
  const row = editRows.value[rowIndex];
  if (!row) return;
  editingCell.value = { row: rowIndex, col };
  editDraft.value =
    isMongo.value && row[col] && typeof row[col] === 'object'
      ? JSON.stringify(row[col])
      : toSheetText(row[col]);
}

async function commitEditingCell(): Promise<void> {
  const cell = editingCell.value;
  if (!cell) return;
  const row = editRows.value[cell.row];
  const orig = originalRows[cell.row];
  if (row && orig) {
    row[cell.col] = coerceSheetValue(orig[cell.col], editDraft.value);
    refreshDirtySet();
  }
  editingCell.value = null;
}

function cancelEditingCell() {
  editingCell.value = null;
  editDraft.value = '';
}

/** 避免 Tab/Enter 切格时，旧 input 的 blur 把新格子的草稿提交掉 */
function onCellBlur(rowIndex: number, col: string) {
  if (
    editingCell.value &&
    editingCell.value.row === rowIndex &&
    editingCell.value.col === col
  ) {
    void commitEditingCell();
  }
}

async function onCellEditorKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditingCell();
    return;
  }
  if (e.key !== 'Enter' && e.key !== 'Tab') return;
  e.preventDefault();
  const cell = editingCell.value;
  await commitEditingCell();
  if (!cell) return;
  const cols = columns.value;
  const colIdx = cols.indexOf(cell.col);
  if (e.key === 'Tab' && colIdx >= 0) {
    const nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
    if (nextCol >= 0 && nextCol < cols.length) {
      await startEditCell(cell.row, cols[nextCol]!);
      return;
    }
    const nextRow = e.shiftKey ? cell.row - 1 : cell.row + 1;
    if (nextRow >= 0 && nextRow < editRows.value.length) {
      const wrapCol = e.shiftKey ? cols[cols.length - 1] : cols[0];
      if (wrapCol) await startEditCell(nextRow, wrapCol);
    }
    return;
  }
  if (e.key === 'Enter') {
    const nextRow = cell.row + 1;
    if (nextRow < editRows.value.length) {
      await startEditCell(nextRow, cell.col);
    }
  }
}

function collectEdits(): DirtyRowEdit[] {
  return collectDirtyFromRows(originalRows, editRows.value, columns.value);
}

function markRowsSaved(rowIndexes: number[]) {
  rowIndexes.forEach((i) => {
    const edited = editRows.value[i];
    if (edited) originalRows[i] = { ...edited };
  });
  refreshDirtySet();
}

async function confirmLeaveSheet(action: string): Promise<boolean> {
  await commitEditingCell();
  if (!editMode.value || dirtyCount.value <= 0) return true;
  try {
    await ElMessageBox.confirm(
      `还有 ${dirtyCount.value} 行未保存，${action}将丢弃这些修改。是否继续？`,
      '未保存的修改',
      {
        type: 'warning',
        confirmButtonText: '丢弃并继续',
        cancelButtonText: '取消',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 进入单元格编辑。主键列可以改，保存时 WHERE 用进入编辑时的原值。
 */
async function onEnterSheet() {
  if (!canEnterSheet.value) {
    ElMessage.warning('请先执行查询得到结果，再进入表格编辑');
    return;
  }
  if (!(await confirmRowMutation('修改'))) {
    return;
  }
  resetEditCopies();
  editMode.value = true;
}

async function onExitSheet() {
  if (!(await confirmLeaveSheet('退出编辑'))) return;
  editMode.value = false;
  editingCell.value = null;
  dirtyCount.value = 0;
  dirtyIndexSet.value = new Set();
}

async function onHidePanel() {
  if (!(await confirmLeaveSheet('隐藏结果区'))) return;
  editMode.value = false;
  dirtyCount.value = 0;
  closeFind();
  emit('update:visible', false);
}

async function onSwitchResultTab(v: any) {
  if (v !== 'result') closeFind();
  emit('update:activeTab', v);
}

function pickErrorText(e: any, fallback: string) {
  return e?.msg || e?.message || fallback;
}

async function onSaveSheet() {
  if (sheetSaving.value) return;
  await commitEditingCell();
  const runDml = props.executeRowDml;
  if (isJoinQuery.value ? !props.executeRowDmlBatch : !runDml) {
    ElMessage.error(
      isJoinQuery.value
        ? '当前页未提供事务更新接口，无法安全保存联表修改'
        : '当前页未提供行更新接口，无法保存',
    );
    return;
  }
  if (!(await confirmRowMutation('修改'))) {
    return;
  }
  const edits = collectEdits();
  if (!edits.length) {
    ElMessage.info('没有需要保存的修改');
    dirtyCount.value = 0;
    return;
  }
  try {
    await ElMessageBox.confirm(
      isJoinQuery.value
        ? `将按行提交 UPDATE（共 ${edits.length} 行），同一行涉及的多表修改在一个事务中完成。改某表字段时必须带该表主键，WHERE 只用主键原值。是否继续？`
        : `将按行依次提交 ${edits.length} 条 UPDATE。主键若被改过，WHERE 使用修改前的原值。中途失败则已成功的行已写入。是否继续？`,
      isJoinQuery.value
        ? '保存联表修改（按各表主键定位）'
        : tableHasPk.value
          ? '保存表格修改（按主键定位）'
          : '保存表格修改（无主键）',
      { type: 'warning', confirmButtonText: '保存', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }

  if (!isJoinQuery.value) {
    try {
      requireTable();
    } catch (e: any) {
      ElMessage.warning(e?.message || '无法识别结果对应的表');
      return;
    }
  }

  sheetSaving.value = true;
  const saved: number[] = [];
  try {
    for (const item of edits) {
      const sqls = buildEditsSqls(item);
      if (isJoinQuery.value) {
        if (!props.executeRowDmlBatch) {
          throw new Error('当前页未提供事务更新接口，无法安全保存联表修改');
        }
        await props.executeRowDmlBatch(sqls);
      } else {
        for (const sql of sqls) await runDml!(sql);
      }
      saved.push(item.rowIndex);
      markRowsSaved([item.rowIndex]);
    }
    ElMessage.success(`已保存 ${saved.length} 行`);
    expectResultRefresh.value = true;
    emit('refresh-result');
  } catch (e: any) {
    ElMessage.error(
      saved.length
        ? `已保存 ${saved.length} 行，第 ${saved.length + 1} 条失败：${pickErrorText(e, '更新失败')}`
        : pickErrorText(e, '更新失败'),
    );
  } finally {
    sheetSaving.value = false;
  }
}

function onGlobalClick() {
  if (ctxMenu.visible) closeCtxMenu();
}

function onPanelMouseDown() {
  resultFocused.value = true;
}

function onDocumentMouseDown(e: MouseEvent) {
  const t = e.target as Node | null;
  if (!panelRef.value || !t || !panelRef.value.contains(t)) {
    resultFocused.value = false;
  }
}

/** 在单元格文本中重建 Ctrl+F 命中列表 */
function rebuildFindHits() {
  const q = findQuery.value.trim().toLowerCase();
  if (!q) {
    findHits.value = [];
    findMatchIndex.value = 0;
    return;
  }
  const rows = displayRows.value;
  const cols = columns.value;
  const hits: FindHit[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const col of cols) {
      if (displayCell(row[col]).toLowerCase().includes(q)) {
        hits.push({ row: i, col });
      }
    }
  }
  findHits.value = hits;
  if (!hits.length) {
    findMatchIndex.value = 0;
    return;
  }
  if (findMatchIndex.value >= hits.length) {
    findMatchIndex.value = 0;
  }
}

function revealFindHit(index: number) {
  const hit = findHits.value[index];
  if (!hit) return;
  findMatchIndex.value = index;
  tableElRef.value?.scrollToRow?.(hit.row);
  onCurrentChange(displayRows.value[hit.row], hit.row);
}

function goFind(delta: number) {
  const n = findHits.value.length;
  if (!n) return;
  const next = (findMatchIndex.value + delta + n) % n;
  revealFindHit(next);
}

function openFind() {
  findVisible.value = true;
  resultFocused.value = true;
  nextTick(() => {
    findInputRef.value?.focus();
    findInputRef.value?.select();
  });
  rebuildFindHits();
  if (findHits.value.length) {
    revealFindHit(findMatchIndex.value);
  }
}

function closeFind() {
  findVisible.value = false;
  findQuery.value = '';
  findHits.value = [];
  findMatchIndex.value = 0;
}

function onFindQueryInput() {
  findMatchIndex.value = 0;
  rebuildFindHits();
  if (findHits.value.length) {
    revealFindHit(0);
  }
}

function onFindInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    goFind(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (!props.visible) return;

  const isFindShortcut =
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    (e.key === 'f' || e.key === 'F');

  if (isFindShortcut) {
    if (props.activeTab !== 'result') return;
    // SQL 编辑器内的 Ctrl+F 交给 Monaco
    if ((document.activeElement as HTMLElement | null)?.closest?.('.monaco-editor')) {
      return;
    }
    if (!resultFocused.value && !findVisible.value) return;
    e.preventDefault();
    e.stopPropagation();
    openFind();
    return;
  }

  if (!findVisible.value) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
    return;
  }

  if (e.key === 'F3') {
    e.preventDefault();
    goFind(e.shiftKey ? -1 : 1);
  }
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('scroll', onGlobalClick, true);
  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick);
  document.removeEventListener('scroll', onGlobalClick, true);
  document.removeEventListener('mousedown', onDocumentMouseDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
});

watch(
  () => [props.result?.rows, props.result?.columns, editMode.value] as const,
  () => {
    if (findVisible.value) rebuildFindHits();
  },
);

watch(
  () => props.result,
  () => {
    selectedRow.value = null;
    selectedIndex.value = -1;
    selectedRows.value = [];
    tableElRef.value?.clearSelection?.();
    closeCtxMenu();
    closeFind();
    if (expectResultRefresh.value) {
      expectResultRefresh.value = false;
      if (editMode.value) resetEditCopies();
      else dirtyCount.value = 0;
      return;
    }
    if (editMode.value && dirtyCount.value > 0) {
      ElMessage.warning('结果已更新，未保存的表格修改已丢弃');
    }
    if (editMode.value) resetEditCopies();
    dirtyCount.value = 0;
  },
);
</script>

<template>
  <div
    v-show="visible"
    ref="panelRef"
    class="result-panel"
    tabindex="-1"
    @mousedown="onPanelMouseDown"
  >
    <div class="result-header">
      <ElTabs
        :model-value="activeTab"
        class="tabs"
        @update:model-value="onSwitchResultTab"
      >
        <ElTabPane :label="resultTabLabel" name="result" />
        <ElTabPane label="Messages" name="messages" />
      </ElTabs>
      <div class="header-right">
        <span v-if="tableHintText" class="table-hint">
          {{ tableHintText }}
        </span>
        <template v-if="editMode">
          <ElButton
            link
            type="primary"
            :disabled="dirtyCount <= 0 || executing || sheetSaving"
            :loading="sheetSaving"
            @click="onSaveSheet"
          >
            {{ $tr('保存修改') }}{{ dirtyCount > 0 ? ` (${dirtyCount})` : '' }}
          </ElButton>
          <ElButton
            link
            :disabled="executing || sheetSaving"
            @click="onExitSheet"
          >
            {{ $tr('退出编辑') }}
          </ElButton>
        </template>
        <ElButton
          v-else
          link
          type="primary"
          :disabled="!canEnterSheet"
          @click="onEnterSheet"
        >
          {{ $tr('表格编辑') }}
        </ElButton>
        <ElDropdown
          trigger="click"
          :disabled="!canCopyRows || executing"
          @command="onCopyCommand"
        >
          <ElButton link type="primary" :disabled="!canCopyRows || executing">
            {{ $tr('复制') }}
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all">{{ $tr('复制所有行到剪切板') }}</ElDropdownItem>
              <ElDropdownItem command="selected">{{ $tr('复制选定行到剪切板') }}</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <ElDropdown
          trigger="click"
          :disabled="!canExport || executing"
          @command="onExportCommand"
        >
          <ElButton
            link
            type="primary"
            :loading="exporting"
            :disabled="!canExport || executing"
          >
            {{ $tr('导出') }}
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="excel">{{ $tr('导出 Excel') }}</ElDropdownItem>
              <ElDropdownItem command="sql">{{ $tr('导出 SQL') }}</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <ElButton link type="primary" @click="onHidePanel">{{ $tr('隐藏') }}</ElButton>
      </div>
    </div>
    <div
      v-loading="executing || sheetSaving"
      class="result-body"
    >
      <p v-if="activeTab === 'result' && editMode" class="sheet-hint">
        <template v-if="isJoinQuery">
          {{ $tr('联表只能按各表主键 UPDATE。改某表字段时，SELECT 必须带上该表主键；两表都有 id 时请写成 别名.id 或 id AS user_id。') }}
        </template>
        <template v-else>
          {{ $tr('单击单元格编辑，改过的行会整行标黄。主键也可以改，保存时按修改前的原值定位。NULL 显示为 NULL，空着保存仍是 NULL。') }}
        </template>
      </p>
      <!-- Ctrl+F 查找条（结果区聚焦时可用） -->
      <div v-if="activeTab === 'result' && findVisible" class="find-bar">
        <input
          ref="findInputRef"
          v-model="findQuery"
          class="find-input"
          type="text"
          :placeholder="$tr('在结果中查找')"
          @input="onFindQueryInput"
          @keydown="onFindInputKeydown"
        />
        <span class="find-count">{{ findStatusText }}</span>
        <ElButton
          link
          size="small"
          :disabled="!findHits.length"
          :title="$tr('上一个 (Shift+Enter)')"
          @click="goFind(-1)"
        >
          ↑
        </ElButton>
        <ElButton
          link
          size="small"
          :disabled="!findHits.length"
          :title="$tr('下一个 (Enter)')"
          @click="goFind(1)"
        >
          ↓
        </ElButton>
        <ElButton link size="small" :title="$tr('关闭 (Esc)')" @click="closeFind">
          ×
        </ElButton>
      </div>
      <template v-if="activeTab === 'result'">
        <div v-if="result?.columns?.length" class="table-fill">
          <VirtualResultTable
            ref="tableElRef"
            :rows="displayRows"
            :columns="columns"
            :empty-text="$tr('查询成功，无数据')"
            :edit-mode="editMode"
            :editing-cell="editingCell"
            :edit-draft="editDraft"
            :dirty-indexes="dirtyIndexSet"
            :format-cell="displayCell"
            :is-null-cell="isNullCell"
            :find-match-keys="findMatchKeys"
            :find-active-key="findActiveKey"
            @current-change="onCurrentChange"
            @selection-change="onSelectionChange"
            @row-contextmenu="onRowContextMenu"
            @cell-click="startEditCell"
            @update:edit-draft="editDraft = $event"
            @cell-blur="onCellBlur"
            @cell-keydown="onCellEditorKeydown"
            @edit-offscreen="commitEditingCell"
          />
        </div>
        <div v-else class="empty">{{ $tr('暂无结果') }}</div>
      </template>
      <template v-if="activeTab === 'messages'">
        <pre class="messages">{{ messagesText }}</pre>
        <div v-if="result?.error" class="ai-fix">
          <ElButton
            size="small"
            type="primary"
            @click="
              emit('askAiFix', {
                sql: result?.sourceSql || '',
                error: result?.error || messagesText,
              })
            "
          >
            {{ $tr(policyError ? '问 AI 怎么处理' : '让 AI 修复') }}
          </ElButton>
        </div>
      </template>
    </div>

    <div
      v-if="activeTab === 'result' && result?.columns?.length"
      class="result-status"
    >
      <span>{{ $tr('共') }} {{ statusRowCount }} {{ $tr('行') }}</span>
      <span v-if="selectedIndex >= 0">
        · {{ $tr('当前第') }} {{ selectedIndex + 1 }} {{ $tr('行') }}
      </span>
      <span v-if="selectedRows.length">
        · {{ $tr('已选') }} {{ selectedRows.length }} {{ $tr('行') }}
      </span>
      <span
        v-if="result?.elapsedMs != null && !Number.isNaN(result.elapsedMs)"
        class="status-time"
      >
        · {{ $tr('服务端查询耗时') }}: {{ result.elapsedMs }} ms
      </span>
      <span
        v-if="
          result?.clientElapsedMs != null && !Number.isNaN(result.clientElapsedMs)
        "
        class="status-time"
      >
        · {{ $tr('响应到前台耗时') }}: {{ result.clientElapsedMs }} ms
      </span>
    </div>

    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="result-ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onEdit()">
          {{ $tr('修改…') }}
        </div>
        <div class="item danger" :class="{ disabled: !canDeleteRow }" @click="canDeleteRow && onDelete()">
          {{ $tr('删除') }}
        </div>
        <div class="divider" />
        <div class="item" :class="{ disabled: !canCopyRows }" @click="canCopyRows && onCopyAllRows()">
          {{ $tr('复制所有行到剪切板') }}
        </div>
        <div
          class="item"
          :class="{ disabled: !canCopyRows }"
          @click="canCopyRows && onCopySelectedRows()"
        >
          {{ $tr('复制选定行到剪切板') }}
        </div>
        <div class="divider" />
        <div class="item" :class="{ disabled: !canCopyInsert }" @click="canCopyInsert && onCopyInsert()">
          {{ $tr('拷贝 INSERT 语句') }}
        </div>
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onCopyUpdate()">
          {{ $tr('拷贝 UPDATE 语句') }}
        </div>
      </div>
    </Teleport>

    <ElDialog
      v-model="editVisible"
      :title="
        isJoinQuery
          ? '修改行（联表按各表主键更新）'
          : tableHasPk
            ? '修改行（按主键更新）'
            : '修改行（无主键）'
      "
      width="860px"
      destroy-on-close
      append-to-body
      class="result-edit-dialog"
    >
      <p v-if="isJoinQuery" class="pk-hint">
        {{ $tr('联表只能按各表主键定位。改哪张表，结果里就要带上该表主键；同名 id 请写成 别名.id。') }}
      </p>
      <p v-else-if="tableHasPk" class="pk-hint">
        {{ $tr('WHERE 使用主键：') }}{{ pkInResult.join(', ') }}
      </p>
      <p v-else class="pk-hint warn">
        {{ $tr('当前表没有主键，保存时按结果列旧值匹配，可能影响其它行。') }}
      </p>
      <ElForm :label-width="editLabelWidth" class="edit-form">
        <ElFormItem v-for="col in columns" :key="col" :label="col">
          <ElInput
            :model-value="
              editForm[col] === null || editForm[col] === undefined
                ? ''
                : editFieldText(editForm[col])
            "
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            :placeholder="
              editOriginal &&
              (editOriginal[col] === null || editOriginal[col] === undefined)
                ? 'NULL（清空仍为 NULL）'
                : '留空表示空字符串'
            "
            @update:model-value="(v: string) => onEditField(col, v)"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="editVisible = false">{{ $tr('取消') }}</ElButton>
        <ElButton type="primary" @click="onSaveEdit">{{ $tr('保存') }}</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.result-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}
.table-hint {
  font-size: var(--vc-ui-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pk-hint.warn {
  color: var(--el-color-warning);
}
.ai-fix {
  padding: 0 12px 8px;
}
.tabs {
  flex: 1;
}
.tabs :deep(.el-tabs__header) {
  margin: 0;
}
.result-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.sheet-hint {
  flex: none;
  margin: 0;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.table-fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.table-fill > * {
  flex: 1;
  min-height: 0;
}
.find-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}
.find-input {
  flex: 1;
  min-width: 120px;
  max-width: 360px;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  outline: none;
}
.find-input:focus {
  border-color: var(--el-color-primary);
}
.find-count {
  min-width: 52px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.result-status {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  user-select: none;
}
.empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
}
.messages {
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  font-size: var(--vc-ui-font-size, 13px);
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.edit-form {
  max-height: 55vh;
  overflow: auto;
  padding-right: 8px;
}
/* 长列名允许换行，避免被固定 label 宽度裁切 */
.edit-form :deep(.el-form-item__label) {
  height: auto;
  line-height: 1.35;
  white-space: normal;
  word-break: break-all;
  align-items: flex-start;
  padding-top: 6px;
}
</style>

<style>
.result-ctx-menu {
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
.result-ctx-menu .item {
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.result-ctx-menu .item:hover:not(.disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.result-ctx-menu .item.danger:hover:not(.disabled) {
  color: var(--el-color-danger);
}
.result-ctx-menu .item.disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}
.result-ctx-menu .divider {
  height: 1px;
  margin: 4px 0;
  background: var(--el-border-color-lighter);
}
</style>
