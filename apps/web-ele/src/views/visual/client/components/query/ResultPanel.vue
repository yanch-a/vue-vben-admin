<script lang="ts" setup>
/**
 * 查询结果面板
 * - 工具栏：表格编辑、导出 Excel/SQL、复制全部/选定行（TSV 可粘贴 Excel）
 * - 选中行右键：修改（弹窗）/ 删除 / 拷贝 INSERT / 拷贝 UPDATE / 复制行
 * - 表格编辑：同一张结果表点单元格改，脏行底色，保存时按原值 WHERE 逐行 UPDATE（主键可改）
 * - 联表：改哪张表就必须带上该表主键，只按主键 UPDATE，不按全列定位
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
const tableElRef = ref<{ getSelectionRows?: () => Record<string, any>[] } | null>(
  null,
);

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
const cellInputRef = ref<HTMLInputElement | null>(null);
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

function closeCtxMenu() {
  ctxMenu.visible = false;
}

function onRowContextMenu(row: Record<string, any>, _col: any, event: MouseEvent) {
  event.preventDefault();
  selectedRow.value = row;
  selectedIndex.value = props.result?.rows?.indexOf(row) ?? -1;
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

function onCurrentChange(row: Record<string, any> | undefined) {
  selectedRow.value = row || null;
  selectedIndex.value = row && props.result?.rows ? props.result.rows.indexOf(row) : -1;
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
      if (!props.executeRowDml) {
        ElMessage.error('当前页未提供行更新接口，无法保存联表修改');
        return;
      }
      editVisible.value = false;
      for (const sql of sqls) {
        await props.executeRowDml(sql);
      }
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

function tableRowClassName({ rowIndex }: { rowIndex: number }) {
  return editMode.value && dirtyIndexSet.value.has(rowIndex)
    ? 'is-dirty-row'
    : '';
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
  await nextTick();
  cellInputRef.value?.focus();
  cellInputRef.value?.select();
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
  emit('update:visible', false);
}

async function onSwitchResultTab(v: any) {
  emit('update:activeTab', v);
}

function pickErrorText(e: any, fallback: string) {
  return e?.msg || e?.message || fallback;
}

async function onSaveSheet() {
  if (sheetSaving.value) return;
  await commitEditingCell();
  const runDml = props.executeRowDml;
  if (!runDml) {
    ElMessage.error('当前页未提供行更新接口，无法保存');
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
        ? `将按行、按表依次提交 UPDATE（共 ${edits.length} 行）。改某表字段时必须带该表主键，WHERE 只用主键原值。中途失败则已成功的语句已写入。是否继续？`
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
      for (const sql of sqls) {
        await runDml(sql);
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

onMounted(() => {
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('scroll', onGlobalClick, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick);
  document.removeEventListener('scroll', onGlobalClick, true);
});

watch(
  () => props.result,
  () => {
    selectedRow.value = null;
    selectedIndex.value = -1;
    selectedRows.value = [];
    closeCtxMenu();
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
  <div v-show="visible" class="result-panel">
    <div class="result-header">
      <ElTabs
        :model-value="activeTab"
        class="tabs"
        @update:model-value="onSwitchResultTab"
      >
        <ElTabPane label="Result" name="result" />
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
            保存修改{{ dirtyCount > 0 ? ` (${dirtyCount})` : '' }}
          </ElButton>
          <ElButton
            link
            :disabled="executing || sheetSaving"
            @click="onExitSheet"
          >
            退出编辑
          </ElButton>
        </template>
        <ElButton
          v-else
          link
          type="primary"
          :disabled="!canEnterSheet"
          @click="onEnterSheet"
        >
          表格编辑
        </ElButton>
        <ElDropdown
          trigger="click"
          :disabled="!canCopyRows || executing"
          @command="onCopyCommand"
        >
          <ElButton link type="primary" :disabled="!canCopyRows || executing">
            复制
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all">复制所有行到剪切板</ElDropdownItem>
              <ElDropdownItem command="selected">复制选定行到剪切板</ElDropdownItem>
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
            导出
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="excel">导出 Excel</ElDropdownItem>
              <ElDropdownItem command="sql">导出 SQL</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <ElButton link type="primary" @click="onHidePanel">隐藏</ElButton>
      </div>
    </div>
    <div
      v-loading="executing || sheetSaving"
      class="result-body"
    >
      <p v-if="activeTab === 'result' && editMode" class="sheet-hint">
        <template v-if="isJoinQuery">
          联表只能按各表主键 UPDATE。改某表字段时，SELECT 必须带上该表主键；两表都有 id 时请写成 别名.id 或 id AS user_id。
        </template>
        <template v-else>
          单击单元格编辑，改过的行会整行标黄。主键也可以改，保存时按修改前的原值定位。NULL 显示为 NULL，空着保存仍是 NULL。
        </template>
      </p>
      <template v-if="activeTab === 'result'">
        <div v-if="result?.columns?.length" class="table-fill">
          <ElTable
            ref="tableElRef"
            class="result-table"
            :data="displayRows"
            border
            stripe
            height="100%"
            size="small"
            highlight-current-row
            table-layout="fixed"
            empty-text="查询成功，无数据"
            :row-class-name="tableRowClassName"
            @current-change="onCurrentChange"
            @selection-change="onSelectionChange"
            @row-contextmenu="onRowContextMenu"
          >
          <ElTableColumn type="selection" width="42" fixed />
          <ElTableColumn
            v-for="col in result.columns"
            :key="col"
            :prop="col"
            :label="col"
            min-width="120"
            class-name="result-cell"
          >
            <template #default="{ row, $index }">
              <input
                v-if="
                  editMode &&
                  editingCell &&
                  editingCell.row === $index &&
                  editingCell.col === col
                "
                ref="cellInputRef"
                class="cell-editor"
                :value="editDraft"
                @click.stop
                @input="editDraft = ($event.target as HTMLInputElement).value"
                @blur="onCellBlur($index, col)"
                @keydown="onCellEditorKeydown"
              />
              <span
                v-else
                class="cell-text"
                :class="{
                  'is-null': isNullCell(row[col]),
                  'is-editable': editMode,
                }"
                @click="editMode && startEditCell($index, col)"
              >{{ displayCell(row[col]) }}</span>
            </template>
          </ElTableColumn>
          </ElTable>
        </div>
        <div v-else class="empty">暂无结果</div>
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
            {{ policyError ? '问 AI 怎么处理' : '让 AI 修复' }}
          </ElButton>
        </div>
      </template>
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
          修改…
        </div>
        <div class="item danger" :class="{ disabled: !canDeleteRow }" @click="canDeleteRow && onDelete()">
          删除
        </div>
        <div class="divider" />
        <div class="item" :class="{ disabled: !canCopyRows }" @click="canCopyRows && onCopyAllRows()">
          复制所有行到剪切板
        </div>
        <div
          class="item"
          :class="{ disabled: !canCopyRows }"
          @click="canCopyRows && onCopySelectedRows()"
        >
          复制选定行到剪切板
        </div>
        <div class="divider" />
        <div class="item" :class="{ disabled: !canCopyInsert }" @click="canCopyInsert && onCopyInsert()">
          拷贝 INSERT 语句
        </div>
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onCopyUpdate()">
          拷贝 UPDATE 语句
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
      width="640px"
      destroy-on-close
      append-to-body
    >
      <p v-if="isJoinQuery" class="pk-hint">
        联表只能按各表主键定位。改哪张表，结果里就要带上该表主键；同名 id 请写成 别名.id。
      </p>
      <p v-else-if="tableHasPk" class="pk-hint">
        WHERE 使用主键：{{ pkInResult.join(', ') }}
      </p>
      <p v-else class="pk-hint warn">
        当前表没有主键，保存时按结果列旧值匹配，可能影响其它行。
      </p>
      <ElForm label-width="140px" class="edit-form">
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
        <ElButton @click="editVisible = false">取消</ElButton>
        <ElButton type="primary" @click="onSaveEdit">保存</ElButton>
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
  overflow: auto;
  /* Firefox：用较宽的系统滚动条，避免 thin 几乎看不见 */
  scrollbar-width: auto;
  scrollbar-color: var(--el-text-color-regular) var(--el-fill-color-dark);
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
  flex: 1;
  min-height: 0;
}
.result-body :deep(.is-dirty-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--el-color-warning) 28%, transparent) !important;
}
.cell-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-text.is-null {
  font-style: italic;
  color: var(--el-text-color-secondary);
}
.cell-text.is-editable {
  cursor: text;
  min-height: 18px;
}
/* 编辑中：输入框铺满格子，1px 边框叠在表格格子线上 */
.result-body :deep(td.result-cell:has(.cell-editor)) {
  position: relative;
  z-index: 3;
  overflow: visible !important;
}
.result-body :deep(td.result-cell:has(.cell-editor) .cell) {
  padding: 0;
  overflow: visible;
}
.cell-editor {
  position: absolute;
  inset: -1px;
  box-sizing: border-box;
  width: auto;
  height: auto;
  margin: 0;
  padding: 4px 8px;
  font: inherit;
  line-height: inherit;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-color-primary);
  border-radius: 0;
  outline: none;
}
/* 用 CSS 截断替代 show-overflow-tooltip，避免每格挂载 Tooltip 导致卡顿 */
.result-body :deep(.result-cell .cell) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 结果表横向滚动条：Element Plus 默认 6px、悬停才显示，叠在最后一行上很难发现。
 * 这里改为始终可见、加粗、带轨道，并给内容底部留空，避免挡住最后一行。
 */
.result-body :deep(.result-table) {
  --el-scrollbar-opacity: 1;
  --el-scrollbar-hover-opacity: 1;
  --el-scrollbar-bg-color: var(--el-text-color-regular);
  --el-scrollbar-hover-bg-color: var(--el-color-primary);
}
.result-body :deep(.result-table .el-scrollbar__bar) {
  opacity: 1;
  z-index: 4;
}
.result-body :deep(.result-table .el-scrollbar__bar.is-horizontal) {
  height: 14px;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--el-fill-color-dark);
  border-radius: 0;
  border-top: 1px solid var(--el-border-color);
}
.result-body :deep(.result-table .el-scrollbar__bar.is-vertical) {
  width: 12px;
  top: 0;
  bottom: 14px;
  background: var(--el-fill-color);
  border-left: 1px solid var(--el-border-color-lighter);
}
.result-body :deep(.result-table .el-scrollbar__thumb) {
  border-radius: 7px;
  cursor: grab;
  opacity: 1;
}
.result-body :deep(.result-table .el-scrollbar__bar.is-horizontal .el-scrollbar__thumb) {
  height: 10px;
  margin: 2px 4px;
  background-color: var(--el-text-color-regular);
}
.result-body :deep(.result-table .el-scrollbar__bar.is-horizontal .el-scrollbar__thumb:hover),
.result-body :deep(.result-table .el-scrollbar__bar.is-horizontal .el-scrollbar__thumb:active) {
  background-color: var(--el-color-primary);
  cursor: grabbing;
}
.result-body :deep(.result-table .el-scrollbar__wrap) {
  /* 滚动到底时最后一行仍露在滑块上方 */
  padding-bottom: 14px;
}

/* Messages 区、以及未走 overlay 的原生滚动条 */
.result-body :deep(.result-table .el-table__body-wrapper) {
  scrollbar-width: auto;
  scrollbar-color: var(--el-text-color-regular) var(--el-fill-color-dark);
}
.result-body::-webkit-scrollbar,
.result-body :deep(.result-table .el-table__body-wrapper)::-webkit-scrollbar {
  width: 12px;
  height: 14px;
}
.result-body::-webkit-scrollbar-track,
.result-body :deep(.result-table .el-table__body-wrapper)::-webkit-scrollbar-track {
  background: var(--el-fill-color-dark);
}
.result-body::-webkit-scrollbar-thumb,
.result-body :deep(.result-table .el-table__body-wrapper)::-webkit-scrollbar-thumb {
  background: var(--el-text-color-regular);
  border-radius: 8px;
  border: 2px solid var(--el-fill-color-dark);
}
.result-body::-webkit-scrollbar-thumb:hover,
.result-body :deep(.result-table .el-table__body-wrapper)::-webkit-scrollbar-thumb:hover {
  background: var(--el-color-primary);
}
.empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
}
.messages {
  margin: 0;
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
