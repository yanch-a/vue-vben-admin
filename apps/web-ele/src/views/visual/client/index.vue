<script lang="ts" setup>
/**
 * 数据库客户端主壳（SQLyog 风格）
 * - 顶栏：新建/打开连接、表分组、关系画布、智能 SQL
 * - 连接 Tab：已打开的数据源会话
 * - 左：对象树（含 Queries 已保存查询）；右：多查询 Tab + 库下拉 + SQL 编辑器 + 结果区
 * @author yanch
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { executeDml, executeSql, exportSqlExcel, getInstances, getTableColumns, getTableDDL, getTables } from '#/api/visual/database';
import {
  addSavedQuery,
  deleteSavedQuery,
  editSavedQuery,
} from '#/api/visual/savedQuery';
import { Page } from '@vben/common-ui';

import { ElMessage, ElMessageBox } from 'element-plus';

import type { TreeCtxAction } from './components/object-tree/ObjectTreeContextMenu.vue';

import ClientToolbar from './components/ClientToolbar.vue';
import ConnectionDialog from './components/ConnectionDialog.vue';
import ConnectionTabs from './components/ConnectionTabs.vue';
import ObjectTreeHost from './components/object-tree/ObjectTreeHost.vue';
import QueryTabs from './components/query/QueryTabs.vue';
import ResultPanel from './components/query/ResultPanel.vue';
import SqlEditor from './components/query/SqlEditor.vue';
import SmartQueryDrawer from './components/SmartQueryDrawer.vue';
import SqlDumpDialog from './components/SqlDumpDialog.vue';
import { useConnectionStore } from './composables/useConnectionStore';
import { setupClientSessionPersist } from './composables/useClientSessionPersist';
import { notifyClientSessionChange } from './composables/clientSessionNotify';
import {
  applyQueryTabsSnapshot,
  getQueryTabsSnapshot,
  useQueryTabs,
} from './composables/useQueryTabs';
import { visualClientConfig } from './config';
import { resolveSqlDialect } from './dialect/sqlDialect';
import { parseTableFromSql, type TableRef } from './utils/resultRowSql';
import {
  clearColumnCache,
  getCachedColumns,
  rememberInstanceTables,
  setCachedColumns,
} from './utils/sqlEditorAssist';

defineOptions({ name: 'VisualClient' });

const router = useRouter();
const {
  openConnections,
  activeConnectionId,
  activeConnection,
  openConnection,
  closeConnection,
  setActiveConnection,
  updateConnection,
} = useConnectionStore();

const {
  MAX_TABS,
  tabs,
  activeTabId,
  activeTab,
  addTab,
  closeTab,
  openSqlInNewTab,
} = useQueryTabs(() => activeConnectionId.value);

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'open'>('open');
const filterText = ref('');
/** 左侧对象树宽度 */
const leftWidth = ref(260);
/** 结果区高度（可拖拽调整）；查询成功后默认按编辑器:结果 = 2:1 设置 */
const resultHeight = ref(220);
const smartVisible = ref(false);
const sqlEditorRef = ref<InstanceType<typeof SqlEditor>>();
const objectTreeRef = ref<InstanceType<typeof ObjectTreeHost>>();
/** 右侧工作区 DOM，用于计算可拖拽高度上下限 */
const rightPaneRef = ref<HTMLElement | null>(null);
/** 导出 Excel loading */
const exporting = ref(false);

/** SQL 转储对话框 */
const sqlDump = reactive({
  visible: false,
  instanceName: '',
  preselectedTables: [] as string[],
});

/** 会话持久化：恢复 + change/10s 落盘 */
const sessionPersist = setupClientSessionPersist({
  openConnections,
  activeConnectionId,
  getTabsSnapshot: getQueryTabsSnapshot,
  applyTabsSnapshot: applyQueryTabsSnapshot,
  leftWidth,
  resultHeight,
});
sessionPersist.restore();

/** SQL / Tab 内容变更时增量落盘 */
watch(
  tabs,
  () => {
    notifyClientSessionChange();
  },
  { deep: true },
);

/** 当前连接下的库/Schema 列表（下拉用；含义因库类型而异） */
const instanceOptions = ref<string[]>([]);

/** 保存查询弹窗 */
const saveDialog = reactive({
  visible: false,
  /** create=另存为；update=覆盖当前关联查询 */
  mode: 'create' as 'create' | 'update',
  queryName: '',
  saving: false,
});

/** 创建库 / 创建表 / 执行脚本 等简易对话框 */
const promptDialog = reactive({
  visible: false,
  title: '',
  mode: '' as TreeCtxAction | '',
  instanceName: '',
  input: '',
  sqlPreview: '',
});

const hasConnection = computed(() => !!activeConnection.value);

/** 下拉旁提示：不同库类型「实例」含义不同 */
const instanceLabel = computed(() => {
  const d = resolveSqlDialect(activeConnection.value?.dbType);
  return d.instanceKind === 'schema' ? 'Schema' : '数据库';
});

/** 当前连接方言（生成 SQL / 编辑器触发字符） */
const activeDialect = computed(() =>
  resolveSqlDialect(activeConnection.value?.dbType),
);

watch(
  () => activeConnection.value?.id,
  async (id) => {
    instanceOptions.value = [];
    clearColumnCache();
    if (id == null) return;
    try {
      const res: any = await getInstances(id);
      const trees = res?.data || res || [];
      const instances = trees[0]?.instances || [];
      instanceOptions.value = instances
        .map((i: any) => i.instanceName)
        .filter(Boolean);
      // 新连接默认 Tab：若未选库，用连接默认 schema 或第一项
      if (activeTab.value && !activeTab.value.instanceName) {
        activeTab.value.instanceName =
          activeConnection.value?.schemaName ||
          instanceOptions.value[0] ||
          '';
      }
    } catch {
      instanceOptions.value = [];
    }
  },
  { immediate: true },
);

/** 左侧单击库 → 当前编辑器所属库跟随变化 */
function onSelectInstance(instanceName: string) {
  if (!activeTab.value || !instanceName) return;
  activeTab.value.instanceName = instanceName;
}

/** 结果集对应表：仅用「已执行 SQL」解析，避免编辑时反复触发副作用 */
const resultTableRef = computed<TableRef | null>(() => {
  const sql = activeTab.value?.result?.sourceSql || '';
  return sql ? parseTableFromSql(sql) : null;
});

/** 目标表主键列（优先读补全缓存，不额外打接口） */
const resultPrimaryKeys = computed(() => {
  const ref = resultTableRef.value;
  const conn = activeConnection.value;
  const inst =
    ref?.schema || activeTab.value?.instanceName || conn?.schemaName || '';
  if (!ref?.table || !conn || !inst) return [] as string[];
  const cached = getCachedColumns(conn.id, inst, ref.table);
  return cached?.primaryKeys || [];
});

/** 编辑器区域高度：总高 - 工具条/Tab - 结果区（若显示） */
const editorFlexStyle = computed(() => {
  if (!activeTab.value?.resultVisible) {
    return { flex: '1 1 auto', height: 'auto', minHeight: '120px' };
  }
  return {
    flex: '1 1 auto',
    minHeight: '100px',
  };
});

function onCreateConnection() {
  dialogMode.value = 'create';
  dialogVisible.value = true;
}

function onOpenConnection() {
  dialogMode.value = 'open';
  dialogVisible.value = true;
}

function handleOpened(conn: any) {
  const result = openConnection(conn);
  if (!result.ok) {
    if (result.reason === 'max') {
      ElMessage.warning(
        `最多同时打开 ${visualClientConfig.maxOpenConnections} 个数据库连接，请先关闭其它连接`,
      );
    }
    return;
  }
  // 打开连接后给当前 Tab 补默认库
  if (activeTab.value && !activeTab.value.instanceName) {
    activeTab.value.instanceName =
      conn?.schemaName || instanceOptions.value[0] || '';
  }
}

/** 编辑连接后，同步顶部已打开连接 Tab 的名称等信息 */
function handleConnectionUpdated(conn: any) {
  if (!conn?.id) return;
  updateConnection(conn);
}

function goGroup() {
  if (!activeConnection.value) return;
  router.push({
    name: 'DbConfigCanvas',
    query: { id: String(activeConnection.value.id) },
  });
}

function goRelation() {
  if (!activeConnection.value) return;
  router.push({
    name: 'RelationCanvas',
    query: { id: String(activeConnection.value.id) },
  });
}

/** 双击表：新查询 Tab 预填 SELECT（按方言限行） */
function onOpenTable(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  const d = activeDialect.value;
  // PG：instance=库，表固定 public；Oracle/达梦：instance=schema；MySQL：instance=库
  const qualifyKey =
    d.family === 'ORACLE_LIKE'
      ? payload.schemaName || payload.instanceName
      : payload.instanceName;
  const sql = d.selectAllLimited(qualifyKey, payload.tableName, 100);
  const tab = openSqlInNewTab(sql, payload.tableName, payload.instanceName);
  if (!tab) {
    ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
  }
}

/** 双击左侧已保存查询：打开/激活编辑器 */
function onOpenSavedQuery(payload: {
  id: number | string;
  queryName: string;
  sqlText: string;
  instanceName: string;
}) {
  const tab = openSqlInNewTab(
    payload.sqlText || '',
    payload.queryName,
    payload.instanceName,
    payload.id,
  );
  if (!tab) {
    ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
  }
}

function onInsertName(name: string) {
  sqlEditorRef.value?.insertText(name);
}

/** 对象树右键菜单动作 */
async function onTreeContextAction(payload: {
  action: TreeCtxAction;
  node: any;
}) {
  const { action, node } = payload;
  const instanceName = node.instanceName || '';
  const tableName = node.name || node.tableName || '';

  switch (action) {
    case 'importData':
    case 'copyDbToHost':
      ElMessage.info('功能预留，后续版本开放');
      return;
    case 'openTable':
      onOpenTable({ instanceName, tableName });
      return;
    case 'createDatabase':
      promptDialog.mode = action;
      promptDialog.title = '创建数据库';
      promptDialog.instanceName = instanceName;
      promptDialog.input = '';
      promptDialog.sqlPreview = '';
      promptDialog.visible = true;
      return;
    case 'dropDatabase':
      try {
        await ElMessageBox.confirm(
          `确认删除「${instanceName}」？将生成删除语句到查询编辑器（请自行确认后执行）。`,
          '删除确认',
          { type: 'warning' },
        );
        openSqlInNewTab(
          activeDialect.value.dropDatabaseSql(instanceName),
          `Drop ${instanceName}`,
          instanceName,
        );
      } catch {
        /* cancel */
      }
      return;
    case 'runSqlScript':
      promptDialog.mode = action;
      promptDialog.title = '执行 SQL 脚本（预览）';
      promptDialog.instanceName = instanceName;
      promptDialog.input = '';
      promptDialog.sqlPreview = '';
      promptDialog.visible = true;
      return;
    case 'createTable':
      promptDialog.mode = action;
      promptDialog.title = `在 ${instanceName} 中创建表`;
      promptDialog.instanceName = instanceName;
      promptDialog.input = 'new_table';
      promptDialog.sqlPreview = '';
      promptDialog.visible = true;
      return;
    case 'dropTable':
      try {
        await ElMessageBox.confirm(
          `确认删除表 ${instanceName}.${tableName}？将生成 DROP TABLE 到查询编辑器。`,
          '删除表',
          { type: 'warning' },
        );
        openSqlInNewTab(
          activeDialect.value.dropTableSql(instanceName, tableName),
          `Drop ${tableName}`,
          instanceName,
        );
      } catch {
        /* cancel */
      }
      return;
    case 'alterTable':
      openSqlInNewTab(
        activeDialect.value.alterTableStubSql(instanceName, tableName),
        `Alter ${tableName}`,
        instanceName,
      );
      return;
    case 'copyDdl': {
      try {
        const res: any = await getTableDDL(
          activeConnection.value?.id,
          instanceName,
          tableName,
        );
        const ddl = res?.data?.ddl || res?.ddl || '';
        if (!ddl) {
          ElMessage.warning('未获取到 DDL');
          return;
        }
        await navigator.clipboard.writeText(ddl);
        ElMessage.success('DDL 已复制到剪贴板');
      } catch (e: any) {
        ElMessage.error(e?.message || '复制 DDL 失败');
      }
      return;
    }
    case 'exportTableExcel':
      await exportTableAsExcel(instanceName, tableName, node.schemaName);
      return;
    case 'exportTableSql':
      sqlDump.instanceName = instanceName;
      sqlDump.preselectedTables = tableName ? [tableName] : [];
      sqlDump.visible = true;
      return;
    case 'openSavedQuery':
      onOpenSavedQuery({
        id: node.savedQueryId,
        queryName: node.name || node.label,
        sqlText: node.sqlText || '',
        instanceName,
      });
      return;
    case 'copySavedQuerySql': {
      const sql = node.sqlText || '';
      if (!sql) {
        ElMessage.warning('无 SQL 内容');
        return;
      }
      try {
        await navigator.clipboard.writeText(sql);
        ElMessage.success('SQL 已复制');
      } catch {
        ElMessage.error('复制失败');
      }
      return;
    }
    case 'renameSavedQuery': {
      try {
        const { value } = await ElMessageBox.prompt('请输入新的查询名称', '重命名', {
          inputValue: node.name || node.label || '',
          confirmButtonText: '保存',
          cancelButtonText: '取消',
        });
        const newName = String(value || '').trim();
        if (!newName) {
          ElMessage.warning('名称不能为空');
          return;
        }
        await editSavedQuery({ id: node.savedQueryId, queryName: newName });
        ElMessage.success('已重命名');
        objectTreeRef.value?.reloadQueries?.(instanceName);
        // 若已打开对应 Tab，同步标题
        const tab = tabs.value.find(
          (t) => String(t.savedQueryId) === String(node.savedQueryId),
        );
        if (tab) tab.title = newName;
      } catch {
        /* cancel */
      }
      return;
    }
    case 'deleteSavedQuery': {
      try {
        await ElMessageBox.confirm(
          `确认删除查询「${node.name || node.label}」？`,
          '删除查询',
          { type: 'warning' },
        );
        await deleteSavedQuery(node.savedQueryId);
        ElMessage.success('已删除');
        objectTreeRef.value?.reloadQueries?.(instanceName);
        const tab = tabs.value.find(
          (t) => String(t.savedQueryId) === String(node.savedQueryId),
        );
        if (tab) {
          tab.savedQueryId = undefined;
        }
      } catch {
        /* cancel */
      }
      return;
    }
    default:
      break;
  }
}

function confirmPromptDialog() {
  const mode = promptDialog.mode;
  const name = promptDialog.input.trim();
  const inst = promptDialog.instanceName;
  const d = activeDialect.value;

  if (mode === 'createDatabase') {
    if (!name) {
      ElMessage.warning('请输入名称');
      return;
    }
    openSqlInNewTab(d.createDatabaseSql(name), `Create ${name}`, name);
  } else if (mode === 'createTable') {
    if (!name) {
      ElMessage.warning('请输入表名');
      return;
    }
    openSqlInNewTab(
      d.createTableStubSql(inst, name),
      `Create ${name}`,
      inst,
    );
  } else if (mode === 'runSqlScript') {
    const sql = promptDialog.input.trim();
    if (!sql) {
      ElMessage.warning('请输入 SQL 脚本');
      return;
    }
    openSqlInNewTab(sql, 'SQL Script', inst);
  }
  promptDialog.visible = false;
}

/** 执行当前光标所在语句（或选中片段）；不再整页发送 */
async function runSql() {
  if (!activeConnection.value || !activeTab.value) return;
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  const sql =
    sqlEditorRef.value?.getExecutableSql?.()?.trim() ||
    activeTab.value.sql?.trim() ||
    '';
  if (!sql) {
    ElMessage.warning('请输入 SQL，或将光标放到要执行的语句上');
    return;
  }
  activeTab.value.executing = true;
  activeTab.value.resultVisible = true;
  activeTab.value.resultTab = 'result';
  try {
    const res: any = await executeSql({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
      maxRows: 1000,
    });
    const data = res?.data || res;
    activeTab.value.result = {
      columns: data.columns || [],
      rows: data.rows || [],
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      message: data.message,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'result';
    // 查询成功后：编辑器:结果 ≈ 2:1
    applyEditorResultRatio();
  } catch (e: any) {
    // 业务失败（含 SQL 语法错误）写入 Messages，避免只弹 toast / 空白结果
    const errText = pickErrorMsg(e, '执行失败');
    activeTab.value.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'messages';
    applyEditorResultRatio();
  } finally {
    activeTab.value.executing = false;
  }
}

/** 从 axios / 业务 reject 对象中取出可读错误文案 */
function pickErrorMsg(e: any, fallback: string) {
  return (
    e?.msg ||
    e?.message ||
    e?.response?.data?.msg ||
    e?.response?.data?.message ||
    fallback
  );
}

/** 格式化当前选区或光标所在 SQL（与编辑器 F12 相同） */
function onFormatSql() {
  sqlEditorRef.value?.formatSql?.();
}

/**
 * 按右栏可用高度设置结果区为约 1/3（编辑器占约 2/3）
 * @author yanch
 */
function applyEditorResultRatio() {
  nextTick(() => {
    const paneH = rightPaneRef.value?.clientHeight || 600;
    // 扣除 QueryTabs + 操作条 + 分隔条大约占用
    const reserved = 100;
    const flexH = Math.max(paneH - reserved, 300);
    const next = Math.floor(flexH / 3);
    const minR = 120;
    const maxR = Math.max(minR, Math.floor(flexH * 0.55));
    resultHeight.value = Math.min(maxR, Math.max(minR, next));
  });
}

/**
 * 导出当前结果对应 SQL：后台重新执行后下载 xlsx（不用前端表格数据）
 * @author yanch
 */
async function onExportExcel() {
  if (!activeConnection.value || !activeTab.value) return;
  const sql = activeTab.value.result?.sourceSql?.trim();
  if (!sql) {
    ElMessage.warning('没有可导出的查询 SQL，请先执行查询');
    return;
  }
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  await downloadExcelBlob(
    {
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
      maxRows: visualClientConfig.exportMaxRows,
    },
    `SQL导出_${Date.now()}.xlsx`,
  );
}

/**
 * 表右键：按 SELECT * 后台重查并导出 Excel
 * @author yanch
 */
async function exportTableAsExcel(
  instanceName: string,
  tableName: string,
  schemaName?: string,
) {
  if (!activeConnection.value) return;
  if (!instanceName || !tableName) {
    ElMessage.warning('无法识别表名');
    return;
  }
  const sql = buildSelectAllSql(
    activeConnection.value.dbType,
    instanceName,
    tableName,
    schemaName,
  );
  await downloadExcelBlob(
    {
      dbConfigId: activeConnection.value.id,
      instanceName,
      sql,
      maxRows: visualClientConfig.exportMaxRows,
    },
    `${instanceName}_${tableName}.xlsx`,
  );
}

/** 按库方言拼 SELECT *（给导出用） */
function buildSelectAllSql(
  dbType: string,
  instanceName: string,
  tableName: string,
  schemaName?: string,
) {
  const d = resolveSqlDialect(dbType);
  const qualifyKey =
    d.family === 'ORACLE_LIKE' ? schemaName || instanceName : instanceName;
  return d.selectAllLimited(
    qualifyKey,
    tableName,
    visualClientConfig.exportMaxRows,
  );
}

async function downloadExcelBlob(
  data: {
    dbConfigId: number | string;
    instanceName?: string;
    sql: string;
    maxRows?: number;
  },
  downloadName: string,
) {
  exporting.value = true;
  try {
    const blob: any = await exportSqlExcel(data);
    const fileBlob =
      blob instanceof Blob
        ? blob
        : new Blob([blob], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
    if (fileBlob.type && fileBlob.type.includes('application/json')) {
      const text = await fileBlob.text();
      let msg = '导出失败';
      try {
        msg = JSON.parse(text)?.msg || msg;
      } catch {
        /* ignore */
      }
      ElMessage.error(msg);
      return;
    }
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    window.URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

/** 补全：按需加载字段并写入客户端缓存 */
async function loadEditorColumns(instanceName: string, tableName: string) {
  const conn = activeConnection.value;
  if (!conn) return { columns: [] as string[], primaryKeys: [] as string[] };
  const cached = getCachedColumns(conn.id, instanceName, tableName);
  if (cached) return cached;
  const res: any = await getTableColumns(conn.id, instanceName, tableName);
  const list = res?.data || res || [];
  const columns = (Array.isArray(list) ? list : [])
    .map((c: any) => c.fieldName)
    .filter(Boolean);
  const primaryKeys = (Array.isArray(list) ? list : [])
    .filter((c: any) => c.isPrimary === 1 || c.isPrimary === true)
    .map((c: any) => c.fieldName)
    .filter(Boolean);
  setCachedColumns(conn.id, instanceName, tableName, columns, primaryKeys);
  return { columns, primaryKeys };
}

/** 补全：当前库表清单未缓存时拉一次 */
async function loadEditorTables(instanceName: string) {
  const conn = activeConnection.value;
  if (!conn) return [] as string[];
  const res: any = await getTables(conn.id, instanceName);
  const list = (res?.data || res || []).map((t: any) => t.tableName).filter(Boolean);
  rememberInstanceTables(conn.id, instanceName, list);
  return list;
}

/**
 * 保存当前编辑器 SQL。
 * - 已关联 savedQueryId：弹窗可改名后覆盖更新
 * - 未关联：另存为新记录
 */
function onSaveQuery() {
  if (!activeConnection.value || !activeTab.value) return;
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}后再保存`);
    return;
  }
  if (!activeTab.value.sql?.trim()) {
    ElMessage.warning('SQL 内容为空，无法保存');
    return;
  }
  saveDialog.mode = activeTab.value.savedQueryId ? 'update' : 'create';
  saveDialog.queryName =
    activeTab.value.title && !/^Query\s+\d+$/i.test(activeTab.value.title)
      ? activeTab.value.title
      : '';
  saveDialog.visible = true;
}

/** 另存为：强制新建一条 */
function onSaveQueryAs() {
  if (!activeConnection.value || !activeTab.value) return;
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}后再保存`);
    return;
  }
  if (!activeTab.value.sql?.trim()) {
    ElMessage.warning('SQL 内容为空，无法保存');
    return;
  }
  saveDialog.mode = 'create';
  saveDialog.queryName = '';
  saveDialog.visible = true;
}

async function confirmSaveQuery() {
  if (!activeConnection.value || !activeTab.value) return;
  const name = saveDialog.queryName.trim();
  if (!name) {
    ElMessage.warning('请输入查询名称');
    return;
  }
  saveDialog.saving = true;
  try {
    const instanceName = activeTab.value.instanceName!;
    const sqlText = activeTab.value.sql;
    if (saveDialog.mode === 'update' && activeTab.value.savedQueryId) {
      await editSavedQuery({
        id: activeTab.value.savedQueryId,
        queryName: name,
        sqlText,
        dbConfigId: activeConnection.value.id,
        instanceName,
      });
      activeTab.value.title = name;
      ElMessage.success('已更新保存');
    } else {
      const res: any = await addSavedQuery({
        queryName: name,
        sqlText,
        dbConfigId: activeConnection.value.id,
        instanceName,
      });
      const data = res?.data || res;
      activeTab.value.savedQueryId = data?.id;
      activeTab.value.title = name;
      ElMessage.success('已保存');
    }
    saveDialog.visible = false;
    objectTreeRef.value?.reloadQueries?.(instanceName);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '保存失败');
  } finally {
    saveDialog.saving = false;
  }
}

/**
 * 结果行右键：修改 / 删除 触发的 DML
 * 成功后自动重新执行原查询以刷新结果。
 */
async function onRunDml(dmlSql: string) {
  if (!activeConnection.value || !activeTab.value) return;
  activeTab.value.executing = true;
  try {
    const res: any = await executeDml({
      dbConfigId: activeConnection.value.id,
      instanceName:
        resultTableRef.value?.schema ||
        activeTab.value.instanceName ||
        activeConnection.value.schemaName,
      sql: dmlSql,
    });
    const data = res?.data || res;
    ElMessage.success(data?.message || '执行成功');
    // 用产生结果的原 SELECT 刷新，避免覆盖用户正在编辑的 SQL
    const sourceSql = activeTab.value.result?.sourceSql?.trim();
    if (sourceSql) {
      await refreshQueryResult(sourceSql);
    } else if (activeTab.value.result) {
      activeTab.value.result.message =
        data?.message ||
        `DML OK, ${data?.affectedRows ?? '?'} row(s) affected`;
      activeTab.value.result.error = undefined;
      activeTab.value.resultTab = 'messages';
    }
  } catch (e: any) {
    const errText = pickErrorMsg(e, 'DML 执行失败');
    ElMessage.error(errText);
    if (activeTab.value.result) {
      activeTab.value.result.error = errText;
      activeTab.value.resultTab = 'messages';
    }
  } finally {
    activeTab.value.executing = false;
  }
}

/** 按指定 SQL 刷新结果区（不改动编辑器内容） */
async function refreshQueryResult(sql: string) {
  if (!activeConnection.value || !activeTab.value) return;
  if (!activeTab.value.instanceName) return;
  try {
    const res: any = await executeSql({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
      maxRows: 1000,
    });
    const data = res?.data || res;
    activeTab.value.result = {
      columns: data.columns || [],
      rows: data.rows || [],
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      message: data.message,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'result';
  } catch (e: any) {
    const errText = pickErrorMsg(e, '刷新结果失败');
    if (activeTab.value.result) {
      activeTab.value.result.error = errText;
      activeTab.value.resultTab = 'messages';
    } else {
      activeTab.value.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errText,
        message: errText,
        sourceSql: sql,
      };
      activeTab.value.resultTab = 'messages';
    }
  }
}

function onSmartSql(sql: string) {
  const tab = openSqlInNewTab(sql, 'Smart SQL');
  if (!tab) ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
}

/** ---------- 上下拖拽调整编辑器 / 结果区高度 ---------- */
let resizing = false;
let startY = 0;
let startResultH = 0;

function onSplitterDown(e: MouseEvent) {
  if (!activeTab.value?.resultVisible) return;
  resizing = true;
  startY = e.clientY;
  startResultH = resultHeight.value;
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onSplitterMove);
  window.addEventListener('mouseup', onSplitterUp);
}

function onSplitterMove(e: MouseEvent) {
  if (!resizing) return;
  // 向上拖 → 结果区变高；向下拖 → 结果区变矮
  const delta = startY - e.clientY;
  const paneH = rightPaneRef.value?.clientHeight || 600;
  const minResult = 100;
  const maxResult = Math.max(minResult, paneH - 180);
  resultHeight.value = Math.min(
    maxResult,
    Math.max(minResult, startResultH + delta),
  );
}

function onSplitterUp() {
  resizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', onSplitterMove);
  window.removeEventListener('mouseup', onSplitterUp);
}

onBeforeUnmount(() => {
  onSplitterUp();
  sessionPersist.stop();
});
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="db-client">
      <ClientToolbar
        :has-connection="hasConnection"
        @create="onCreateConnection"
        @open="onOpenConnection"
        @refresh="filterText = filterText"
        @group="goGroup"
        @relation="goRelation"
        @smart="smartVisible = true"
      />
      <ConnectionTabs
        :connections="openConnections"
        :active-id="activeConnectionId"
        @change="setActiveConnection"
        @close="closeConnection"
      />

      <div v-if="activeConnection" class="workspace">
        <aside class="left" :style="{ width: leftWidth + 'px' }">
          <div class="search">
            <ElInput
              v-model="filterText"
              clearable
              size="small"
              placeholder="Search As Input"
            />
          </div>
          <ObjectTreeHost
            ref="objectTreeRef"
            :db-config-id="activeConnection.id"
            :db-type="activeConnection.dbType"
            :filter-text="filterText"
            @open-table="onOpenTable"
            @insert-name="onInsertName"
            @select-instance="onSelectInstance"
            @open-saved-query="onOpenSavedQuery"
            @context-action="onTreeContextAction"
          />
        </aside>

        <section ref="rightPaneRef" class="right">
          <QueryTabs
            :tabs="tabs"
            :active-id="activeTabId"
            :max-tabs="MAX_TABS"
            @change="(id) => (activeTabId = id)"
            @add="
              () => {
                const t = addTab({
                  instanceName:
                    activeTab?.instanceName ||
                    activeConnection?.schemaName ||
                    instanceOptions[0],
                });
                if (!t) ElMessage.warning(`最多 ${MAX_TABS} 个查询`);
              }
            "
            @close="closeTab"
          />
          <div class="query-actions">
            <ElSelect
              v-if="activeTab"
              v-model="activeTab.instanceName"
              filterable
              clearable
              size="small"
              class="instance-select"
              :placeholder="`选择${instanceLabel}`"
            >
              <ElOption
                v-for="name in instanceOptions"
                :key="name"
                :label="name"
                :value="name"
              />
            </ElSelect>
            <ElButton
              type="primary"
              size="small"
              :loading="activeTab?.executing"
              @click="runSql"
            >
              执行 (Ctrl+Enter / F9)
            </ElButton>
            <ElButton size="small" @click="onFormatSql">格式化 (F12)</ElButton>
            <ElButton size="small" @click="onSaveQuery">保存 (Ctrl+S)</ElButton>
            <ElButton size="small" @click="onSaveQueryAs">另存为</ElButton>
            <ElButton
              size="small"
              @click="
                activeTab && (activeTab.resultVisible = !activeTab.resultVisible)
              "
            >
              {{ activeTab?.resultVisible ? '隐藏结果' : '显示结果' }}
            </ElButton>
          </div>

          <!-- SQL 编辑区（占满剩余空间） -->
          <div class="editor-area" :style="editorFlexStyle">
            <SqlEditor
              v-if="activeTab"
              :key="activeTab.id"
              ref="sqlEditorRef"
              v-model="activeTab.sql"
              :db-config-id="activeConnection?.id"
              :db-type="activeConnection?.dbType"
              :instance-name="activeTab.instanceName"
              :load-columns="loadEditorColumns"
              :load-tables="loadEditorTables"
              @execute="runSql"
              @save="onSaveQuery"
            />
          </div>

          <!-- 拖拽分隔条：仅在结果显示时可用 -->
          <div
            v-if="activeTab?.resultVisible"
            class="splitter-h"
            title="拖拽调整编辑器与结果区高度"
            @mousedown.prevent="onSplitterDown"
          />

          <div
            v-if="activeTab?.resultVisible"
            class="result-area"
            :style="{ height: resultHeight + 'px', flex: '0 0 auto' }"
          >
            <ResultPanel
              :visible="true"
              :active-tab="activeTab.resultTab"
              :result="activeTab.result"
              :executing="activeTab.executing"
              :exporting="exporting"
              :table-ref="resultTableRef"
              :db-type="activeConnection?.dbType"
              :primary-keys="resultPrimaryKeys"
              @update:visible="(v) => (activeTab!.resultVisible = v)"
              @update:active-tab="(v) => (activeTab!.resultTab = v)"
              @run-dml="onRunDml"
              @export="onExportExcel"
            />
          </div>
        </section>
      </div>
      <div v-else class="empty-workspace">
        从顶部「新建连接」或「打开连接」开始，像 SQLyog 一样工作。
      </div>
    </div>

    <ConnectionDialog
      v-model="dialogVisible"
      :mode="dialogMode"
      @created="handleOpened"
      @opened="handleOpened"
      @updated="handleConnectionUpdated"
    />

    <SqlDumpDialog
      v-model="sqlDump.visible"
      :db-config-id="activeConnection?.id"
      :db-name="activeConnection?.dbName"
      :db-type="activeConnection?.dbType"
      :instance-name="sqlDump.instanceName"
      :preselected-tables="sqlDump.preselectedTables"
    />

    <ElDialog
      v-model="saveDialog.visible"
      :title="saveDialog.mode === 'update' ? '更新已保存查询' : '保存查询'"
      width="480px"
      destroy-on-close
    >
      <ElForm label-width="100px">
        <ElFormItem :label="instanceLabel">
          <ElInput :model-value="activeTab?.instanceName" disabled />
        </ElFormItem>
        <ElFormItem label="查询名称" required>
          <ElInput
            v-model="saveDialog.queryName"
            clearable
            maxlength="100"
            show-word-limit
            placeholder="例如：用户列表查询"
            @keyup.enter="confirmSaveQuery"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="saveDialog.visible = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="saveDialog.saving"
          @click="confirmSaveQuery"
        >
          {{ saveDialog.mode === 'update' ? '更新' : '保存' }}
        </ElButton>
      </template>
    </ElDialog>

    <SmartQueryDrawer
      v-model="smartVisible"
      :db-config-id="activeConnectionId"
      @open-sql="onSmartSql"
    />

    <ElDialog
      v-model="promptDialog.visible"
      :title="promptDialog.title"
      width="560px"
      destroy-on-close
    >
      <ElInput
        v-if="promptDialog.mode === 'runSqlScript'"
        v-model="promptDialog.input"
        type="textarea"
        :rows="12"
        placeholder="粘贴 SQL 脚本，确认后打开到查询编辑器预览"
      />
      <ElForm v-else label-width="100px">
        <ElFormItem :label="promptDialog.mode === 'createDatabase' ? '数据库名' : '表名'">
          <ElInput v-model="promptDialog.input" clearable />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="promptDialog.visible = false">取消</ElButton>
        <ElButton type="primary" @click="confirmPromptDialog">
          {{ promptDialog.mode === 'runSqlScript' ? '打开到查询' : '生成 SQL' }}
        </ElButton>
      </template>
    </ElDialog>
  </Page>
</template>

<style scoped>
.db-client {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
}
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}
.left {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
  min-width: 180px;
  max-width: 480px;
}
.search {
  padding: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.query-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex: 0 0 auto;
  flex-wrap: wrap;
}
.instance-select {
  width: 180px;
}
.editor-area {
  min-height: 100px;
  overflow: hidden;
}
/* 水平分隔条：拖动改变结果区高度 */
.splitter-h {
  flex: 0 0 6px;
  cursor: row-resize;
  background: var(--el-border-color-lighter);
  position: relative;
  z-index: 2;
}
.splitter-h:hover,
.splitter-h:active {
  background: var(--el-color-primary-light-5);
}
.result-area {
  min-height: 100px;
  overflow: hidden;
}
.empty-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
</style>
