<script lang="ts" setup>
/**
 * 数据库客户端主壳（SQLyog 风格）
 * - 顶栏：新建/打开连接、表分组、关系画布、AI 助手
 * - 连接 Tab：已打开的数据源会话
 * - 左：对象树（含 Queries 已保存查询）；右：多查询 Tab + 库下拉 + SQL 编辑器 + 结果区
 * @author yanch
 */
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';

import { executeDdl, executeDml, executeDmlBatch, executeSql, cancelSql, exportSqlExcel, exportSqlInsert, exportTableSchemaExcel, getInstances, getObjectScript, getTableColumns, getTableDDL, getTableInfo, getTables } from '#/api/visual/database';
import { feedbackSchemaDoc } from '#/api/ai/agent';
import {
  addSavedQuery,
  deleteSavedQuery,
  editSavedQuery,
  getSavedQueryById,
} from '#/api/visual/savedQuery';
import { getDbConfigById } from '#/api/visual/vq';
import { Page } from '@vben/common-ui';

import { ElMessage, ElMessageBox } from 'element-plus';
import {
  downloadBlobAsFile,
  readBlobErrorMessage,
  unwrapFileBlob,
} from '#/utils/blobDownload';
import { Aim } from '@element-plus/icons-vue';

import type { TreeCtxAction } from './components/object-tree/ObjectTreeContextMenu.vue';

import ClientToolbar from './components/ClientToolbar.vue';
import ConnectionDialog from './components/ConnectionDialog.vue';
import ConnectionTabs from './components/ConnectionTabs.vue';
import EmptyWorkspace from './components/EmptyWorkspace.vue';
import ObjectTree from './components/object-tree/ObjectTree.vue';
import OracleObjectTree from './components/object-tree/OracleObjectTree.vue';
import PostgreSqlObjectTree from './components/object-tree/PostgreSqlObjectTree.vue';
import QueryTabs from './components/query/QueryTabs.vue';
import ResultPanel from './components/query/ResultPanel.vue';
import SqlEditor from './components/query/SqlEditor.vue';
import SqlDumpDialog from './components/SqlDumpDialog.vue';
import CreateDatabaseDialog from './components/CreateDatabaseDialog.vue';
import CopyDatabaseDialog from './components/CopyDatabaseDialog.vue';
import SqlScriptUploadDialog from './components/SqlScriptUploadDialog.vue';
import NativeImportDialog from './components/NativeImportDialog.vue';
import DatabaseToolDialog from './components/DatabaseToolDialog.vue';
import ClientTaskPanel from './components/ClientTaskPanel.vue';
import SystemFunctionsDialog from './components/SystemFunctionsDialog.vue';
import TableInfoDialog from './components/TableInfoDialog.vue';
import TableDesignerDialog from './components/TableDesignerDialog.vue';
import ClientPreferencesDialog from './components/ClientPreferencesDialog.vue';
import LicenseDialog from './components/LicenseDialog.vue';
import AiChatWindow from './components/ai/AiChatWindow.vue';
import AiDockBar from './components/ai/AiDockBar.vue';
import SchemaDocDrawer from './components/ai/SchemaDocDrawer.vue';
import QueryHistoryDrawer from './components/ai/QueryHistoryDrawer.vue';
import {
  bindVisualClientFontScope,
  useClientPreferences,
} from './composables/useClientPreferences';
import { getLicenseStatus } from '#/api/visual/license';
import { useConnectionStore } from './composables/useConnectionStore';
import { useClientTasks } from './composables/useClientTasks';
import { setupClientSessionPersist } from './composables/useClientSessionPersist';
import { notifyClientSessionChange } from './composables/clientSessionNotify';
import {
  consumePendingSavedQueryOpen,
  peekPendingSavedQueryOpen,
} from './composables/usePendingSavedQuery';
import {
  applyQueryTabsSnapshot,
  getQueryTabsSnapshot,
  isQueryTabDirty,
  replaceConnectionTabs,
  useQueryTabs,
} from './composables/useQueryTabs';
import { visualClientConfig } from './config';
import { resolveSqlDialect, resolveTableIdent } from './dialect/sqlDialect';
import { resolveDbType, resolveDialectFamily } from './dialect/dbTypes';
import type { TableDesignSqlResult } from './dialect/tableDesignerDialect';
import { isDestructiveDdl, looksLikeControlledDdl } from './utils/controlledDdl';
import {
  metadataTableName,
  parseQueryTables,
  type QueryTableRef,
  type TableRef,
} from './utils/resultRowSql';
import { confirmSqlWrite } from './utils/sqlWriteConfirmation';
import {
  askAiPrefillForError,
  describeSqlWriteRisk,
  isFreeDmlSql,
  isWriteOrDangerousSql,
} from './utils/sqlWriteGuard';
import {
  isMongoDbType,
  isMongoEditableQuery,
  mongoCommandKind,
  parseMongoCollection,
} from './utils/mongoCommand';
import type { ResultTableMeta } from './utils/resultJoinUpdate';
import {
  mergePrimaryKeys,
  primaryKeysFromColumns,
  primaryKeysFromDdl,
  primaryKeysFromIndexes,
} from './utils/resultPrimaryKeys';
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
  closeConnection: closeConnectionDirect,
  setActiveConnection,
  updateConnection,
} = useConnectionStore();

const {
  runningTasks,
  doneTasks,
  runningCount,
  panelVisible,
  activeTab: taskPanelTab,
  refreshing: tasksRefreshing,
  bootstrap: bootstrapTasks,
  dispose: disposeTasks,
  refreshAll: refreshClientTasks,
  trackCopy,
  trackSqlScript,
  cancel: cancelClientTask,
  openPanel: openTaskPanel,
  togglePanel: toggleTaskPanel,
} = useClientTasks();

const {
  MAX_TABS,
  tabs,
  activeTabId,
  activeTab,
  addTab,
  closeTab: closeTabDirect,
  closeAllTabs: closeAllTabsDirect,
  closeOtherTabs: closeOtherTabsDirect,
  reorderTabs,
  openSqlInNewTab,
  markTabSaved,
} = useQueryTabs(() => activeConnectionId.value);

/** 关闭查询页签前统一保护未保存 SQL，避免单关、全关、关其它三条路径静默丢稿。 */
async function confirmDiscardQueryTabs(targets: typeof tabs.value) {
  if (!targets.some((tab) => isQueryTabDirty(tab))) return true;
  try {
    await ElMessageBox.confirm(
      '要关闭的页签中有未保存 SQL，关闭后这些修改将丢失。是否继续？',
      '未保存的查询',
      { type: 'warning', confirmButtonText: '继续关闭', cancelButtonText: '取消' },
    );
    return true;
  } catch {
    return false;
  }
}

async function closeTab(tabId: string) {
  const target = tabs.value.find((tab) => tab.id === tabId);
  if (target && !(await confirmDiscardQueryTabs([target]))) return;
  closeTabDirect(tabId);
}

async function closeAllTabs() {
  if (!(await confirmDiscardQueryTabs(tabs.value))) return;
  closeAllTabsDirect();
}

async function closeOtherTabs(keepTabId: string) {
  const targets = tabs.value.filter((tab) => tab.id !== keepTabId);
  if (!(await confirmDiscardQueryTabs(targets))) return;
  closeOtherTabsDirect(keepTabId);
}

/** 关闭连接会一并隐藏其查询页签，因此同样检查该连接下的未保存 SQL。 */
async function closeConnection(sessionId: number | string) {
  const snapshot = getQueryTabsSnapshot();
  const connectionTabs = snapshot.tabsByConnection[String(sessionId)] || [];
  if (!(await confirmDiscardQueryTabs(connectionTabs))) return;
  closeConnectionDirect(sessionId);
}

const { queryTabsPlacement, queryTabsLeftWidth, TABS_LEFT_MIN, TABS_LEFT_MAX } =
  useClientPreferences();
let unbindClientFontScope: (() => void) | undefined;

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'open'>('open');
const filterText = ref('');
/** 左侧对象树宽度 */
const leftWidth = ref(260);
/** 结果区高度（可拖拽调整）；查询成功后默认按编辑器:结果 = 2:1 设置 */
const resultHeight = ref(220);
const systemFunctionsVisible = ref(false);
/** 系统功能弹窗：由顶栏下拉菜单指定导出/导入 */
const systemFunctionsMode = ref<'export' | 'import'>('export');
const preferencesVisible = ref(false);
const licenseVisible = ref(false);
const licenseForce = ref(false);
const licenseHint = ref('');
const licenseAllowed = ref(true);
const sqlEditorRef = ref<InstanceType<typeof SqlEditor>>();
const objectTreeRef = ref<any>();
/**
 * 不同方言族使用独立 Vue 组件入口。
 * ObjectTree 始终保持 MySQL/通用扁平树，PG 与 Oracle 的 Schema 层不会反向影响它。
 */
const objectTreeComponent = computed(() => {
  const dbType = activeConnection.value?.dbType;
  const family = resolveDialectFamily(dbType);
  if (family === 'POSTGRES_LIKE') return PostgreSqlObjectTree;
  if (family === 'ORACLE_LIKE') {
    // 达梦等 instanceKind=SCHEMA：一级节点已是用户/模式，再套 schemaMode 会变成「模式→同名 schema」。
    // 真 Oracle / OceanBase Oracle 一级是 service，仍走 OracleObjectTree。
    if (resolveDbType(dbType).instanceKind === 'SCHEMA') return ObjectTree;
    return OracleObjectTree;
  }
  return ObjectTree;
});
const connectionTabsRef = ref<InstanceType<typeof ConnectionTabs>>();
/** Electron 原生菜单订阅的取消函数 */
let offDesktopSessionExport: (() => void) | undefined;
let offDesktopSessionImport: (() => void) | undefined;
const aiChatRef = ref<InstanceType<typeof AiChatWindow>>();
const schemaDocVisible = ref(false);
const historyVisible = ref(false);
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

/** 跨主机复制对话框 */
const copyDb = reactive({
  visible: false,
  instanceName: '',
  sourceSchema: '',
  preselectedTables: [] as string[],
});

/** 会话持久化：恢复 + change/10s 落盘 */
const sessionPersist = setupClientSessionPersist({
  openConnections,
  activeConnectionId,
  getTabsSnapshot: getQueryTabsSnapshot,
  applyTabsSnapshot: applyQueryTabsSnapshot,
  replaceConnectionTabs,
  leftWidth,
  resultHeight,
});
sessionPersist.restore();

/**
 * 导出当前本地缓存中的已打开连接与 SQL Tab（不含密码、不含结果集）。
 * Web / Electron 均走浏览器下载；Electron 会写入当前服务端隔离的会话键对应内容。
 */
function exportTemporarySession() {
  try {
    const snap = sessionPersist.exportSnapshot();
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const blob = new Blob([JSON.stringify(snap, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lemon-temp-queries-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    ElMessage.success('临时查询记录已导出');
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败');
  }
}

/**
 * 导入另一台设备导出的临时查询 JSON，覆盖当前已打开连接与查询。
 * 校验失败则拒绝写入；成功后落盘到当前环境的会话键（Electron 按服务端隔离）。
 */
async function importTemporarySession(file: File) {
  try {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      ElMessage.error('导入失败：文件不是有效的 JSON');
      return;
    }
    await ElMessageBox.confirm(
      '导入将覆盖当前已打开的连接和临时查询，是否继续？',
      '导入临时查询记录',
      { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' },
    );
    const snap = sessionPersist.importSnapshot(raw);
    if (!snap) {
      ElMessage.error('导入失败：会话数据格式不正确或版本不兼容');
      return;
    }
    ElMessage.success('临时查询记录已导入');
  } catch (e: any) {
    if (e === 'cancel' || e?.action === 'cancel') return;
    ElMessage.error(e?.message || '导入失败');
  }
}

/**
 * 导出指定连接下的查询 Tab（不含其它连接）。
 */
function exportConnectionQueries(sessionId: number | string) {
  try {
    const bundle = sessionPersist.exportConnectionQueries(sessionId);
    if (!bundle) {
      ElMessage.warning('当前连接没有可导出的查询');
      return;
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const safeName = String(bundle.connection.dbName || 'connection')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 40);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lemon-conn-queries-${safeName}-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    ElMessage.success('本连接查询记录已导出');
  } catch (e: any) {
    ElMessage.error(e?.message || '导出失败');
  }
}

/**
 * 把单连接查询包导入到指定连接，仅覆盖该连接的查询 Tab。
 */
async function importConnectionQueries(
  sessionId: number | string,
  file: File,
) {
  try {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      ElMessage.error('导入失败：文件不是有效的 JSON');
      return;
    }
    await ElMessageBox.confirm(
      '导入将覆盖本连接下的临时查询，是否继续？',
      '导入本连接查询记录',
      { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' },
    );
    const bundle = sessionPersist.importConnectionQueries(sessionId, raw);
    if (!bundle) {
      ElMessage.error('导入失败：请选择本连接查询导出文件');
      return;
    }
    ElMessage.success('本连接查询记录已导入');
  } catch (e: any) {
    if (e === 'cancel' || e?.action === 'cancel') return;
    ElMessage.error(e?.message || '导入失败');
  }
}

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

/** 按方言族选项创建数据库 / Schema / 用户 */
const createDbDialog = reactive({
  visible: false,
  /** 执行 DDL 时连到的已有实例 */
  connectInstance: '',
});

/** 上传 SQL 文件后台执行 */
const sqlScriptDialog = reactive({
  visible: false,
  instanceName: '',
});

/** 使用服务端官方客户端导入备份 */
const nativeImportDialog = reactive({
  visible: false,
  instanceName: '',
});
const databaseToolVisible = ref(false);

/** 左侧对象树当前选中的表（单击 Tables 下某表，供 F11 打开） */
const selectedTreeTable = ref<{
  instanceName: string;
  tableName: string;
  schemaName?: string;
} | null>(null);

/** 查看表信息弹窗 */
const tableInfoDialog = reactive({
  visible: false,
  loading: false,
  /** 打开时默认页签；编辑器入口为 columns，对象树入口为 basic */
  defaultTab: 'basic' as 'basic' | 'columns' | 'ddl' | 'indexes',
  info: null as any,
});

/**
 * 新建/修改表共用的可视化设计器状态。
 * 修改表先读取后端聚合的字段、索引、外键和属性，再打开弹窗，避免用户看到半成品。
 */
const tableDesigner = reactive({
  visible: false,
  mode: 'create' as 'alter' | 'create',
  instanceName: '',
  schemaName: '',
  tableName: '',
  loading: false,
  saving: false,
  info: null as any,
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
  if (activeTab.value.instanceName !== instanceName) {
    activeTab.value.schemaName = undefined;
  }
  activeTab.value.instanceName = instanceName;
}

/** 单击 PG/Oracle Schema：同步当前 Tab，供保存查询和新建对象确定归属。 */
function onSelectSchema(payload: { instanceName: string; schemaName: string }) {
  if (!activeTab.value || !payload.instanceName || !payload.schemaName) return;
  activeTab.value.instanceName = payload.instanceName;
  activeTab.value.schemaName = payload.schemaName;
}

/** 结果集对应表：仅用「已执行 SQL」解析，避免编辑时反复触发副作用 */
const resultQueryTables = computed<QueryTableRef[]>(() => {
  const sql = activeTab.value?.result?.sourceSql || '';
  if (!sql) return [];
  if (isMongoDbType(activeConnection.value?.dbType)) {
    const table = parseMongoCollectionForResult(sql);
    return table ? [table] : [];
  }
  return parseQueryTables(sql);
});

function parseMongoCollectionForResult(sql: string): QueryTableRef | null {
  // Kept local so the metadata pipeline remains QueryTableRef-compatible.
  return isMongoEditableQuery(sql) ? parseMongoCollection(sql) : null;
}

const resultTableRef = computed<TableRef | null>(() => {
  const t = resultQueryTables.value[0];
  return t ? { schema: t.schema, table: t.table } : null;
});

/** 结果表主键：查询完成后按当前实例拉元数据，不用 SQL 里的 schema 冒充库名 */
const resultPrimaryKeys = ref<string[]>([]);
const resultPrimaryKeysReady = ref(false);
const resultTableMetas = ref<ResultTableMeta[]>([]);

/**
 * 拉一张表的列名 + 主键。不走空主键的补全缓存。
 */
async function fetchTableMeta(
  instanceName: string,
  tableName: string,
): Promise<{ columns: string[]; primaryKeys: string[] }> {
  const conn = activeConnection.value;
  if (!conn) return { columns: [], primaryKeys: [] };
  let columns: string[] = [];
  let fromCols: string[] = [];
  try {
    const colRes: any = await getTableColumns(conn.id, instanceName, tableName);
    const colList = colRes?.data || colRes || [];
    const arr = Array.isArray(colList) ? colList : [];
    columns = arr
      .map((c: any) => String(c?.fieldName || c?.columnName || c?.name || '').trim())
      .filter(Boolean);
    fromCols = primaryKeysFromColumns(arr);
  } catch (e) {
    console.warn('getTableColumns 读列/主键失败', e);
  }
  let keys = fromCols;
  if (!keys.length) {
    try {
      const infoRes: any = await getTableInfo(conn.id, instanceName, tableName);
      const info = infoRes?.data || infoRes || {};
      if (!columns.length && Array.isArray(info.columns)) {
        columns = info.columns
          .map((c: any) => String(c?.fieldName || c?.columnName || c?.name || '').trim())
          .filter(Boolean);
      }
      keys = mergePrimaryKeys(
        fromCols,
        primaryKeysFromColumns(info.columns || []),
        primaryKeysFromIndexes(info.indexes || []),
        primaryKeysFromDdl(info.ddl || ''),
      );
    } catch (e) {
      console.warn('getTableInfo 读主键失败', e);
    }
  }
  if (columns.length || keys.length) {
    const cached = getCachedColumns(conn.id, instanceName, tableName);
    setCachedColumns(
      conn.id,
      instanceName,
      tableName,
      columns.length ? columns : cached?.columns || [],
      keys,
    );
  }
  return { columns, primaryKeys: keys };
}

async function refreshResultPrimaryKeys() {
  const tables = resultQueryTables.value;
  const conn = activeConnection.value;
  const inst = activeTab.value?.instanceName || conn?.schemaName || '';
  if (!tables.length || !conn || !inst) {
    resultTableMetas.value = [];
    resultPrimaryKeys.value = [];
    resultPrimaryKeysReady.value = true;
    return;
  }
  resultPrimaryKeysReady.value = false;
  try {
    const metas: ResultTableMeta[] = await Promise.all(
      tables.map(async (t) => {
        const metaName = metadataTableName(t, conn.dbType);
        try {
          const { columns, primaryKeys } = await fetchTableMeta(inst, metaName);
          return {
            ref: { schema: t.schema, table: t.table },
            alias: t.alias,
            columns,
            primaryKeys,
          };
        } catch (e) {
          console.warn('读取联表元数据失败', t.table, e);
          return {
            ref: { schema: t.schema, table: t.table },
            alias: t.alias,
            columns: [] as string[],
            primaryKeys: [] as string[],
          };
        }
      }),
    );
    resultTableMetas.value = metas;
    resultPrimaryKeys.value = metas[0]?.primaryKeys || [];
  } catch (e) {
    console.warn('读取表主键失败', e);
    resultTableMetas.value = [];
    resultPrimaryKeys.value = [];
  } finally {
    resultPrimaryKeysReady.value = true;
  }
}

async function ensureResultPrimaryKeys(): Promise<string[]> {
  await refreshResultPrimaryKeys();
  return resultPrimaryKeys.value;
}

watch(
  () => [
    resultTableRef.value?.schema,
    resultTableRef.value?.table,
    activeTab.value?.result?.sourceSql,
    activeTab.value?.instanceName,
    activeConnection.value?.id,
  ],
  () => {
    void refreshResultPrimaryKeys();
  },
  { immediate: true },
);

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

/** 从客户端打开查询视图：直接写 SQL，无需先配表分组 */
function goQueryView() {
  if (!activeConnection.value) return;
  const instance =
    activeTab.value?.instanceName ||
    activeConnection.value.schemaName ||
    undefined;
  router.push({
    name: 'QueryConfig',
    query: {
      dbConfigId: String(activeConnection.value.id),
      mode: 'sql',
      ...(instance ? { instance } : {}),
    },
  });
}

function goRelation() {
  if (!activeConnection.value) return;
  const instance =
    activeTab.value?.instanceName ||
    activeConnection.value.schemaName ||
    undefined;
  router.push({
    name: 'RelationCanvas',
    query: {
      id: String(activeConnection.value.id),
      ...(instance ? { instance } : {}),
    },
  });
}

/** 打开已保存查询文件管理页（分组 / 树 / 搜索） */
function goSavedQueryManage() {
  router.push({ name: 'SavedQuerys' });
}

/** 跳转图表库（后台菜单路由名 Dashboard） */
function goChartLibrary() {
  router.push({ name: 'Dashboard' });
}

/** 跳转 Redis 工作台（后台菜单路由名 Redis） */
function goRedisConsole() {
  router.push({ name: 'Redis' });
}

function onAddQueryTab() {
  const t = addTab({
    instanceName:
      activeTab.value?.instanceName ||
      activeConnection.value?.schemaName ||
      instanceOptions.value[0],
    schemaName: activeTab.value?.schemaName,
  });
  if (!t) ElMessage.warning(`最多 ${MAX_TABS} 个查询`);
}

function onOpenSystemFunctions(mode: 'export' | 'import') {
  systemFunctionsMode.value = mode;
  systemFunctionsVisible.value = true;
}

function onOpenDatabaseTools() {
  databaseToolVisible.value = true;
}

function onOpenPreferences() {
  preferencesVisible.value = true;
}

function onOpenLicense() {
  licenseForce.value = false;
  licenseVisible.value = true;
}

/** 启动时拉取授权：试用可直接用；到期则强制导入 License */
async function refreshLicenseStatus() {
  try {
    const res: any = await getLicenseStatus();
    const data = res?.data || res || {};
    licenseAllowed.value = !!data.allowed;
    if (data.mode === 'TRIAL') {
      licenseHint.value = `试用剩余约 ${data.trialRemainingDays ?? '-'} 天`;
      licenseForce.value = false;
    } else if (data.mode === 'LICENSED') {
      licenseHint.value = data.customer
        ? `已授权：${data.customer}`
        : '已授权';
      licenseForce.value = false;
    } else if (!data.allowed) {
      licenseHint.value = data.message || '试用已结束，请导入 License';
      licenseForce.value = true;
      licenseVisible.value = true;
    } else {
      licenseHint.value = '';
      licenseForce.value = false;
    }
  } catch {
    // 状态接口失败不阻断页面（可能未登录）；真正业务接口会被后端 460 拦住
    licenseHint.value = '';
  }
}

function onLicenseActivated() {
  licenseForce.value = false;
  licenseVisible.value = false;
  void refreshLicenseStatus();
}

function onBundleImported() {
  objectTreeRef.value?.reload?.();
  const inst = activeTab.value?.instanceName;
  if (inst) objectTreeRef.value?.reloadQueries?.(inst);
}

/**
 * 刷新当前连接信息 + 左侧实例/对象树 + 编辑器库下拉。
 * 工具栏「刷新」与连接栏右键「刷新当前浏览对象」共用。
 */
async function refreshBrowseObjects(
  sessionId?: number | string,
  opts?: { silent?: boolean },
) {
  if (sessionId != null && String(sessionId) !== String(activeConnectionId.value)) {
    setActiveConnection(sessionId);
    await nextTick();
  }
  const conn = activeConnection.value;
  if (!conn) {
    if (!opts?.silent) ElMessage.warning('请先打开数据库连接');
    return;
  }
  try {
    const res: any = await getDbConfigById({ id: conn.id });
    const cfg = res?.data || res;
    if (cfg?.id) {
      updateConnection({
        id: cfg.id,
        dbName: cfg.dbName,
        schemaName: cfg.schemaName,
        dbType: cfg.dbType,
        dbHost: cfg.dbHost,
        dbPort: cfg.dbPort,
        username: cfg.username,
        description: cfg.description,
        connectionStatus: cfg.connectionStatus,
      });
    }
  } catch {
    // 配置拉取失败仍继续刷对象树
  }
  try {
    const res: any = await getInstances(conn.id);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    instanceOptions.value = instances
      .map((i: any) => i.instanceName)
      .filter(Boolean);
  } catch {
    instanceOptions.value = [];
  }
  await objectTreeRef.value?.reload?.();
  if (!opts?.silent) ElMessage.success('已刷新浏览对象');
}

/** 防止管理页打开查询时并发重复消费 */
let consumingPendingSavedQuery = false;

/**
 * 消费管理页「打开查询」请求：切到目标连接并打开 SQL 编辑器。
 * 会话 restore 可能覆盖管理页刚 open 的连接，故此处缺连接时会再拉配置打开。
 */
async function tryConsumePendingSavedQuery() {
  if (consumingPendingSavedQuery) return;
  const pending = peekPendingSavedQueryOpen();
  if (!pending) return;
  consumingPendingSavedQuery = true;
  try {
    let conn = openConnections.value.find(
      (c) => String(c.id) === String(pending.dbConfigId),
    );
    if (!conn) {
      try {
        const res: any = await getDbConfigById({ id: pending.dbConfigId });
        const cfg = res?.data || res;
        if (!cfg?.id) {
          ElMessage.error('目标连接不存在或无权访问');
          consumePendingSavedQueryOpen();
          return;
        }
        if (cfg.connectionStatus === 0) {
          ElMessage.warning('目标连接已禁用');
          consumePendingSavedQueryOpen();
          return;
        }
        const result = openConnection({
          id: cfg.id,
          dbName: cfg.dbName,
          schemaName: cfg.schemaName,
          dbType: cfg.dbType,
          dbHost: cfg.dbHost,
          dbPort: cfg.dbPort,
          username: cfg.username,
          description: cfg.description,
          connectionStatus: cfg.connectionStatus,
          aiEnabled: cfg.aiEnabled == null ? 1 : Number(cfg.aiEnabled),
          aiAllowSampleData:
            cfg.aiAllowSampleData == null ? 0 : Number(cfg.aiAllowSampleData),
        });
        if (!result.ok) {
          if (result.reason === 'max') {
            ElMessage.warning(
              `最多同时打开 ${visualClientConfig.maxOpenConnections} 个数据库连接，请先关闭其它连接`,
            );
          }
          return;
        }
        conn = openConnections.value.find(
          (c) => c.sessionId === result.sessionId,
        );
      } catch (e: any) {
        ElMessage.error(e?.msg || e?.message || '打开连接失败');
        consumePendingSavedQueryOpen();
        return;
      }
    }
    if (!conn) return;

    consumePendingSavedQueryOpen();
    setActiveConnection(conn.sessionId);
    await nextTick();
    const tab = openSqlInNewTab(
      pending.sqlText || '',
      pending.queryName,
      pending.instanceName,
      pending.id != null && pending.id !== '' ? pending.id : undefined,
    );
    if (!tab) {
      ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
    } else {
      tab.schemaName = pending.schemaName;
    }
  } finally {
    consumingPendingSavedQuery = false;
  }
}

/** 打开表：新开查询页签，查 200 条，输入:结果 ≈ 1:5 */
async function openTableInNewEditor(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开连接');
    return;
  }
  const d = activeDialect.value;
  const ident = resolveTableIdent(activeConnection.value.dbType, payload);
  const sql = d.selectAllLimited(ident.schema, ident.table, 200);
  const tab = openSqlInNewTab(
    sql,
    payload.tableName,
    payload.instanceName,
    undefined,
    payload.schemaName,
    true, // 双击/打开表：一次性页签，关闭不提示未保存
  );
  if (!tab) {
    ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
    return;
  }
  await nextTick();
  // 仅「打开表」给默认 1:5，之后用户拖拽高度不再被普通查询覆盖
  applyEditorResultRatio(1, 5);
  await runSql();
}

/** 打开表：新开编辑器查 200 条（右键 / 双击 / F11） */
function onOpenTable(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  void openTableInNewEditor(payload);
}

function onSelectTreeTable(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  selectedTreeTable.value = payload;
}

/** 查看表信息弹窗 */
async function showTableInfo(payload: {
  instanceName: string;
  tableName: string;
  /** 默认页签；SQL 编辑器右键进字段页 */
  defaultTab?: 'basic' | 'columns' | 'ddl' | 'indexes';
}) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  tableInfoDialog.defaultTab = payload.defaultTab || 'basic';
  tableInfoDialog.visible = true;
  tableInfoDialog.loading = true;
  tableInfoDialog.info = null;
  try {
    const res: any = await getTableInfo(
      activeConnection.value.id,
      payload.instanceName,
      payload.tableName,
    );
    tableInfoDialog.info = res?.data || res;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '获取表信息失败');
    tableInfoDialog.visible = false;
  } finally {
    tableInfoDialog.loading = false;
  }
}

/** SQL 编辑器右键「查看表信息」：复用对象树同一接口，默认落在字段页。 */
function onViewTableInfoFromEditor(payload: {
  instanceName: string;
  tableName: string;
}) {
  void showTableInfo({ ...payload, defaultTab: 'columns' });
}

/** 双击左侧已保存查询：打开/激活编辑器 */
function onOpenSavedQuery(payload: {
  id: number | string;
  queryName: string;
  sqlText: string;
  instanceName: string;
  schemaName?: string;
}) {
  const tab = openSqlInNewTab(
    payload.sqlText || '',
    payload.queryName,
    payload.instanceName,
    payload.id,
  );
  if (!tab) {
    ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
    return;
  }
  tab.schemaName = payload.schemaName;
}

function onInsertName(name: string) {
  sqlEditorRef.value?.insertText(name);
}

/** 左键点左侧栏时关掉对象树菜单；右键留给自定义菜单 */
function onLeftPaneMouseDown(e: MouseEvent) {
  if (e.button === 2) return;
  objectTreeRef.value?.closeContextMenu?.();
}

/** 点在实例树下方空白（含左侧栏空隙）：自定义菜单，不要浏览器菜单 */
function onLeftPaneContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (
    t?.closest(
      'input, textarea, .el-input, .el-tree-node, .obj-ctx-menu, .search',
    )
  ) {
    return;
  }
  e.preventDefault();
  objectTreeRef.value?.openBlankContextMenu?.(e);
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
    case 'refreshInstance':
      if (!instanceName) {
        ElMessage.warning(`请先选择${instanceLabel.value}`);
        return;
      }
      try {
        await objectTreeRef.value?.reloadInstance?.(instanceName);
        ElMessage.success(`已刷新 ${instanceName}`);
      } catch (e: any) {
        ElMessage.error(e?.msg || e?.message || '刷新失败');
      }
      return;
    case 'refreshTree':
      await refreshBrowseObjects(undefined, { silent: false });
      return;
    case 'importData':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      if (!instanceName) {
        ElMessage.warning(`请先选择${instanceLabel.value}`);
        return;
      }
      nativeImportDialog.instanceName = instanceName;
      nativeImportDialog.visible = true;
      return;
    case 'copyDbToHost': {
      copyDb.instanceName = instanceName;
      copyDb.sourceSchema = node?.schemaName || '';
      // 单表右键：预勾选 qualifiedName，便于 PG/Oracle 对上 schema.table
      copyDb.preselectedTables =
        node?.nodeType === 'table'
          ? [node.qualifiedName || node.name || tableName].filter(Boolean)
          : [];
      if (!copyDb.instanceName) {
        ElMessage.warning('请先选择数据库实例');
        return;
      }
      copyDb.visible = true;
      return;
    }
    case 'openTable':
      onOpenTable({
        instanceName,
        tableName,
        schemaName: node.schemaName,
      });
      return;
    case 'viewTableInfo':
      await showTableInfo({ instanceName, tableName });
      return;
    case 'createDatabase':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      createDbDialog.connectInstance =
        instanceName ||
        activeTab.value?.instanceName ||
        activeConnection.value.schemaName ||
        instanceOptions.value[0] ||
        '';
      if (!createDbDialog.connectInstance) {
        ElMessage.warning(
          `当前连接还没有可用的${instanceLabel.value}，请先刷新对象树`,
        );
        return;
      }
      createDbDialog.visible = true;
      return;
    case 'dropDatabase':
      try {
        await ElMessageBox.confirm(
          `确认删除「${instanceName}」？此操作不可恢复。`,
          '删除确认',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
        );
        if (!activeConnection.value) {
          ElMessage.warning('请先打开数据库连接');
          return;
        }
        const dropSql = activeDialect.value.dropDatabaseSql(instanceName);
        if (!dropSql || dropSql.trim().startsWith('--')) {
          ElMessage.warning(dropSql?.trim() || '当前数据库类型不支持在此删除实例');
          return;
        }
        const otherInst =
          (activeConnection.value.schemaName &&
          activeConnection.value.schemaName !== instanceName
            ? activeConnection.value.schemaName
            : '') ||
          instanceOptions.value.find((n) => n !== instanceName) ||
          '';
        if (!otherInst) {
          ElMessage.warning(
            `请先确保连接上还有其它${instanceLabel.value}可切换，再删除「${instanceName}」`,
          );
          return;
        }
        const res: any = await executeDdl({
          dbConfigId: activeConnection.value.id,
          instanceName: otherInst,
          sql: dropSql,
        });
        const data = res?.data || res;
        ElMessage.success(data?.message || `已删除 ${instanceName}`);
        // 清理所有仍指向已删实例的查询 Tab
        for (const t of tabs.value) {
          if (t.instanceName === instanceName) {
            t.instanceName = otherInst;
          }
        }
        await refreshBrowseObjects(undefined, { silent: true });
      } catch (e: any) {
        if (e !== 'cancel' && e !== 'close') {
          ElMessage.error(e?.msg || e?.message || '删除失败');
        }
      }
      return;
    case 'runSqlScript':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      if (!instanceName) {
        ElMessage.warning(`请先选择${instanceLabel.value}`);
        return;
      }
      sqlScriptDialog.instanceName = instanceName;
      sqlScriptDialog.visible = true;
      return;
    case 'createTable':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      tableDesigner.mode = 'create';
      tableDesigner.instanceName = instanceName;
      tableDesigner.schemaName = node.schemaName || '';
      tableDesigner.tableName = 'new_table';
      tableDesigner.info = null;
      tableDesigner.visible = true;
      return;
    case 'dropTable':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      try {
        await ElMessageBox.confirm(
          `确认删除表 ${instanceName}.${tableName}？此操作不可恢复。`,
          '删除表',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
        );
        const ident = resolveTableIdent(activeConnection.value.dbType, {
          instanceName,
          schemaName: node.schemaName,
          tableName,
        });
        const dropSql = activeDialect.value.dropTableSql(ident.schema, ident.table);
        const res: any = await executeDdl({
          dbConfigId: activeConnection.value.id,
          instanceName,
          sql: dropSql,
        });
        const data = res?.data || res;
        ElMessage.success(data?.message || '表已删除');
        objectTreeRef.value?.reloadTables?.(instanceName);
      } catch (e: any) {
        if (e !== 'cancel' && e !== 'close') {
          ElMessage.error(e?.msg || e?.message || '删除表失败');
        }
      }
      return;
    case 'truncateTable':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      try {
        const ident = resolveTableIdent(activeConnection.value.dbType, {
          instanceName,
          schemaName: node.schemaName,
          tableName,
        });
        const truncateSql = activeDialect.value.truncateTableSql(
          ident.schema,
          ident.table,
        );
        const viaDml = !!activeDialect.value.truncateViaDml;
        const how = viaDml
          ? '当前库不支持 TRUNCATE，将执行 DELETE FROM 清空全部行。'
          : '将执行 TRUNCATE TABLE，表结构保留。若存在外键引用可能失败。';
        await ElMessageBox.confirm(
          `确认清空表 ${instanceName}.${tableName}？数据不可恢复。${how}`,
          '清空表',
          { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
        );
        const res: any = viaDml
          ? await executeDml({
              dbConfigId: activeConnection.value.id,
              instanceName,
              sql: truncateSql,
            })
          : await executeDdl({
              dbConfigId: activeConnection.value.id,
              instanceName,
              sql: truncateSql,
            });
        const data = res?.data || res;
        ElMessage.success(data?.message || '表已清空');
      } catch (e: any) {
        if (e !== 'cancel' && e !== 'close') {
          ElMessage.error(e?.msg || e?.message || '清空表失败');
        }
      }
      return;
    case 'alterTable':
      if (!activeConnection.value) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      tableDesigner.mode = 'alter';
      tableDesigner.instanceName = instanceName;
      tableDesigner.schemaName = node.schemaName || '';
      tableDesigner.tableName = tableName;
      tableDesigner.info = null;
      tableDesigner.loading = true;
      tableDesigner.visible = true;
      try {
        const res: any = await getTableInfo(
          activeConnection.value.id,
          instanceName,
          tableName,
        );
        tableDesigner.info = res?.data || res;
        tableDesigner.schemaName = tableDesigner.info?.schemaName || node.schemaName || '';
      } catch (e: any) {
        tableDesigner.visible = false;
        ElMessage.error(e?.msg || e?.message || '读取表结构失败');
      } finally {
        tableDesigner.loading = false;
      }
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
    case 'exportTableSchemaExcel':
      await exportInstanceSchemaExcel(instanceName);
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
          tab.savedSqlBaseline = undefined;
        }
      } catch {
        /* cancel */
      }
      return;
    }
    case 'executeProgramObject':
      await openProgramObjectScript(node, 'execute');
      return;
    case 'createProgramObject':
      await openProgramObjectScript(node, 'create');
      return;
    case 'alterProgramObject':
      await openProgramObjectScript(node, 'alter');
      return;
    case 'dropProgramObject':
      await openProgramObjectScript(node, 'drop');
      return;
    default:
      break;
  }
}

/**
 * 视图/过程/函数/触发器/事件：向后端按方言取脚本后原样打开编辑器（不自动格式化）。
 * 用户可在编辑器中执行：SELECT/SHOW 走只读查询；DDL/CALL 自动改走受控 executeDdl。
 */
async function openProgramObjectScript(
  node: any,
  action: 'execute' | 'create' | 'alter' | 'drop',
) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  const instanceName = node.instanceName || activeTab.value?.instanceName || '';
  if (!instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  const objectKind =
    node.nodeType === 'folder'
      ? node.objectKind
      : node.nodeType || node.objectKind || '';
  const createBaseName = `new_${String(objectKind || 'object').replace(/s$/, '')}`;
  const objectName = action === 'create'
    ? (node.schemaName ? `${node.schemaName}.${createBaseName}` : undefined)
    : node.name || node.objectName || undefined;
  if (action !== 'create' && !objectName) {
    ElMessage.warning('对象名称不能为空');
    return;
  }
  try {
    const res: any = await getObjectScript({
      dbConfigId: activeConnection.value.id,
      instanceName,
      objectKind,
      action,
      objectName,
    });
    const data = res?.data || res || {};
    const sql = String(data.sql || '').trim();
    if (!sql) {
      ElMessage.warning('未生成脚本');
      return;
    }
    const tab = openSqlInNewTab(
      sql,
      data.title || `${action} ${objectName || objectKind}`,
      instanceName,
      undefined,
      node.schemaName,
      true, // 视图/过程等脚本：一次性页签，关闭不提示未保存
    );
    if (!tab) {
      ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
    }
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '生成脚本失败');
  }
}

/**
 * 按预览顺序执行设计器生成的结构语句。
 * 每条语句都继续走后端受控 DDL 权限与审计，不绕过原有安全边界。
 */
async function saveTableDesign(result: TableDesignSqlResult) {
  if (!activeConnection.value || tableDesigner.saving) return;
  tableDesigner.saving = true;
  try {
    for (const sql of result.statements) {
      await executeDdl({
        dbConfigId: activeConnection.value.id,
        instanceName: tableDesigner.instanceName,
        permissionTableName:
          tableDesigner.mode === 'alter' ? tableDesigner.tableName : undefined,
        sql,
      });
    }
    ElMessage.success(tableDesigner.mode === 'create' ? '表创建成功' : '表结构修改成功');
    tableDesigner.visible = false;
    objectTreeRef.value?.reloadTables?.(tableDesigner.instanceName);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '保存表结构失败');
  } finally {
    tableDesigner.saving = false;
  }
}

/** 建库成功：刷新对象树，并尽量切到新实例 */
function onDatabaseCreated(newInstanceName: string) {
  objectTreeRef.value?.reload?.();
  if (newInstanceName && activeTab.value) {
    activeTab.value.instanceName = newInstanceName;
  }
}

function onSqlScriptStarted(task: { taskId: string }) {
  trackSqlScript(task as any);
}

/** 当前正在执行的自由 SQL（用于停止） */
let sqlRunAbort: AbortController | null = null;
let sqlRunRequestId: string | null = null;

function newSqlRequestId() {
  return `sql-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 执行当前光标所在语句（或选中片段）；不重置用户已调好的结果区高度 */
async function runSql(opts?: { sql?: string; source?: string }) {
  if (!activeConnection.value || !activeTab.value) return;
  if (activeTab.value.executing) {
    ElMessage.warning('当前查询正在执行，请先停止或等待完成');
    return;
  }
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  const sql =
    opts?.sql?.trim() ||
    sqlEditorRef.value?.getExecutableSql?.()?.trim() ||
    activeTab.value.sql?.trim() ||
    '';
  if (!sql) {
    ElMessage.warning('请输入 SQL，或将光标放到要执行的语句上');
    return;
  }
  const source = opts?.source || 'manual';

  if (isMongoDbType(activeConnection.value.dbType)) {
    const kind = mongoCommandKind(sql);
    if (kind === 'unknown') {
      ElMessage.warning('无法识别 MongoDB 命令，请使用 db.collection.find/aggregate/insert/update/delete 等 mongosh 语法');
      return;
    }
    if (kind === 'session') {
      ElMessage.warning('编辑器执行不支持 use() 切库，请在左侧选择数据库；use() 可放在 MongoDB 脚本中执行');
      return;
    }
    if (kind === 'data') {
      await runFreeDml(sql, source);
      return;
    }
    if (kind === 'schema' || kind === 'manage') {
      await runControlledDdl(sql, { forceConfirm: /\.drop(Database)?\s*\(/i.test(sql) });
      return;
    }
  }

  // 自由 DML：只读 executeSql 会拒绝；确认后走 executeDml
  if (isFreeDmlSql(sql)) {
    await runFreeDml(sql, source);
    return;
  }

  // 视图/过程等 DDL 与 CALL：走受控 executeDdl（只读 executeSql 无法执行）
  if (looksLikeControlledDdl(sql)) {
    await runControlledDdl(sql);
    return;
  }

  const requestId = newSqlRequestId();
  const abort = new AbortController();
  sqlRunAbort = abort;
  sqlRunRequestId = requestId;
  activeTab.value.executing = true;
  activeTab.value.resultVisible = true;
  activeTab.value.resultTab = 'result';
  const t0 = performance.now();
  try {
    const res: any = await executeSql(
      {
        dbConfigId: activeConnection.value.id,
        instanceName: activeTab.value.instanceName,
        sql,
        maxRows: visualClientConfig.defaultQueryMaxRows,
        requestId,
        source,
      },
      { signal: abort.signal },
    );
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    // markRaw：避免对成百上千行做深层响应式代理，减轻结果表卡顿
    activeTab.value.result = {
      columns: data.columns || [],
      columnTables: data.columnTables || [],
      rows: markRaw(data.rows || []),
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      clientElapsedMs,
      message: data.message,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'result';
    void feedbackSchemaDocSilent(sql);
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    if (abort.signal.aborted || /查询已取消|canceled|cancelled/i.test(String(e?.msg || e?.message || ''))) {
      activeTab.value.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: '查询已取消',
        message: '查询已取消',
        clientElapsedMs,
        sourceSql: sql,
      };
      activeTab.value.resultTab = 'messages';
    } else {
      // 业务失败（含 SQL 语法错误）写入 Messages，避免只弹 toast / 空白结果
      const errText = pickErrorMsg(e, '执行失败');
      activeTab.value.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errText,
        message: errText,
        clientElapsedMs,
        sourceSql: sql,
      };
      activeTab.value.resultTab = 'messages';
    }
  } finally {
    if (sqlRunRequestId === requestId) {
      sqlRunAbort = null;
      sqlRunRequestId = null;
    }
    activeTab.value.executing = false;
  }
}

/** 执行成功后把 JOIN 反馈给 Schema 文档（失败静默） */
function feedbackSchemaDocSilent(sql: string) {
  const conn = activeConnection.value;
  const inst = activeTab.value?.instanceName;
  if (!conn?.id || !inst || !sql) return;
  feedbackSchemaDoc({
    dbConfigId: conn.id,
    instanceName: inst,
    sql,
  }).catch(() => {});
}

/** 受控 DDL / CALL：默认仅 DROP 等删除类需确认；AI 入口可 forceConfirm */
async function runControlledDdl(
  sql: string,
  opts?: { skipConfirm?: boolean; forceConfirm?: boolean },
) {
  if (!activeConnection.value || !activeTab.value) return;
  if (!opts?.skipConfirm && (opts?.forceConfirm || isDestructiveDdl(sql))) {
    const head = String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    const tip = /^\s*TRUNCATE\b/i.test(head)
      ? '即将执行 TRUNCATE 清空表，确认继续？'
      : /^\s*REVOKE\b/i.test(head)
        ? '即将执行 REVOKE 收回权限，确认继续？'
        : isDestructiveDdl(sql)
          ? '即将执行删除类 DDL（DROP），确认继续？'
          : describeSqlWriteRisk(sql);
    if (!(await confirmSqlWrite(sql, { message: tip }))) return;
  }
  activeTab.value.executing = true;
  activeTab.value.resultVisible = true;
  const t0 = performance.now();
  try {
    const res: any = await executeDdl({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    const msg =
      data?.message ||
      `DDL/CALL OK${data?.affectedRows != null ? `, ${data.affectedRows} row(s)` : ''}`;
    activeTab.value.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: data?.elapsedMs,
      clientElapsedMs,
      message: msg,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'messages';
    ElMessage.success(msg);
    if (isMongoDbType(activeConnection.value?.dbType)) {
      objectTreeRef.value?.reload?.();
    } else {
      refreshObjectTreeAfterDdl(sql, activeTab.value.instanceName || '');
    }
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, '执行 DDL 失败');
    activeTab.value.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      clientElapsedMs,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'messages';
  } finally {
    activeTab.value.executing = false;
  }
}

/**
 * 自由 DML（INSERT/UPDATE/DELETE/REPLACE/MERGE）：确认后走 executeDml
 * （只读 executeSql 会直接拒绝写语句）
 */
async function runFreeDml(sql: string, _source?: string, opts?: { skipConfirm?: boolean }) {
  if (!activeConnection.value || !activeTab.value) return;
  if (!opts?.skipConfirm) {
    if (!(await confirmSqlWrite(sql))) return;
  }
  activeTab.value.executing = true;
  activeTab.value.resultVisible = true;
  const t0 = performance.now();
  try {
    const res: any = await executeDml({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    const msg =
      data?.message ||
      `DML OK, ${data?.affectedRows ?? '?'} row(s) affected`;
    activeTab.value.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: data?.elapsedMs,
      clientElapsedMs,
      message: msg,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'messages';
    ElMessage.success(msg);
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, 'DML 执行失败');
    activeTab.value.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      clientElapsedMs,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'messages';
  } finally {
    activeTab.value.executing = false;
  }
}

function refreshObjectTreeAfterDdl(sql: string, instanceName: string) {
  if (!instanceName || !objectTreeRef.value) return;
  const head = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .trim();
  const text = head.toUpperCase();
  if (
    /\bTABLE\b/.test(text) &&
    /\b(CREATE|DROP|ALTER|TRUNCATE|RENAME|OPTIMIZE|ANALYZE|REPAIR|COMMENT)\b/.test(
      text,
    )
  ) {
    objectTreeRef.value.reloadTables?.(instanceName);
  }
  if (/\b(MATERIALIZED\s+VIEW|\bVIEW\b)/.test(text)) {
    objectTreeRef.value.reloadFolder?.('views', instanceName);
  }
  if (/\bPROCEDURE\b/.test(text)) {
    objectTreeRef.value.reloadFolder?.('procedures', instanceName);
  }
  if (/\b(FUNCTION|ALIAS)\b/.test(text)) {
    objectTreeRef.value.reloadFolder?.('functions', instanceName);
  }
  if (/\bTRIGGER\b/.test(text)) {
    objectTreeRef.value.reloadFolder?.('triggers', instanceName);
  }
  if (/\bEVENT\b/.test(text)) {
    objectTreeRef.value.reloadFolder?.('events', instanceName);
  }
  if (/\b(DATABASE|SCHEMA)\b/.test(text) && /\b(CREATE|DROP|ALTER)\b/.test(text)) {
    void refreshBrowseObjects(undefined, { silent: true });
  }
}

/** 停止当前自由 SQL：先通知后端 cancel/kill，再 abort HTTP */
async function stopSql() {
  if (!activeTab.value?.executing) return;
  const requestId = sqlRunRequestId;
  const abort = sqlRunAbort;
  try {
    if (requestId) {
      await cancelSql({ requestId });
    }
  } catch {
    // 仍尝试中断前端请求
  } finally {
    abort?.abort();
  }
  ElMessage.info('已请求停止查询');
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
 * 在左侧对象树定位当前编辑器：
 * - 已保存：展开实例 → Queries，高亮对应查询
 * - 未保存：高亮当前数据库实例
 */
function locateCurrentInTree() {
  const tab = activeTab.value;
  if (!tab) return;
  const instanceName = tab.instanceName?.trim();
  if (!instanceName) {
    ElMessage.warning('请先选择当前库/模式');
    return;
  }
  objectTreeRef.value?.locateTarget?.({
    instanceName,
    schemaName: tab.schemaName,
    savedQueryId: tab.savedQueryId,
  });
}

/**
 * 按右栏可用高度分配编辑器与结果区比例（仅「打开表」等场景主动调用；普通查询不改用户拖拽高度）
 * @author yanch
 */
function applyEditorResultRatio(editorParts = 2, resultParts = 1) {
  nextTick(() => {
    const paneH = rightPaneRef.value?.clientHeight || 600;
    // 扣除 QueryTabs + 操作条 + 分隔条大约占用
    const reserved = 100;
    const flexH = Math.max(paneH - reserved, 300);
    const total = Math.max(1, editorParts + resultParts);
    const next = Math.floor((flexH * resultParts) / total);
    const minR = 120;
    // 给编辑器至少留一点高度，避免完全挤没
    const maxR = Math.max(minR, flexH - 80);
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
  await downloadFileBlob(
    () =>
      exportSqlExcel({
        dbConfigId: activeConnection.value!.id,
        instanceName: activeTab.value!.instanceName,
        sql,
        maxRows: visualClientConfig.exportMaxRows,
      }),
    `SQL导出_${Date.now()}.xlsx`,
    '导出成功',
  );
}

/**
 * 导出当前结果为 INSERT .sql：后台重查 + 库方言拼装（多库兼容）
 * @author yanch
 */
async function onExportSqlInsert() {
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
  const tableRef = resultTableRef.value;
  if (!tableRef?.table) {
    ElMessage.warning('无法识别结果对应的表，请使用单表 SELECT（如 SELECT * FROM db.table）');
    return;
  }
  const schemaPart = tableRef.schema ? `${tableRef.schema}_` : '';
  await downloadFileBlob(
    () =>
      exportSqlInsert({
        dbConfigId: activeConnection.value!.id,
        instanceName: activeTab.value!.instanceName,
        sql,
        tableName: tableRef.table,
        schemaName: tableRef.schema,
        maxRows: visualClientConfig.exportMaxRows,
      }),
    `${schemaPart}${tableRef.table}_insert_${Date.now()}.sql`.replace(
      /[\\/:*?"<>|]/g,
      '_',
    ),
    'SQL 导出成功',
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
  await downloadFileBlob(
    () =>
      exportSqlExcel({
        dbConfigId: activeConnection.value!.id,
        instanceName,
        sql,
        maxRows: visualClientConfig.exportMaxRows,
      }),
    `${instanceName}_${tableName}.xlsx`,
    '导出成功',
  );
}

/**
 * 实例右键：导出该库/模式下全部表结构（列名、注释、类型、最大长度）
 * @author yanch
 */
async function exportInstanceSchemaExcel(instanceName: string) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  if (!instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}`);
    return;
  }
  await downloadFileBlob(
    () =>
      exportTableSchemaExcel({
        dbConfigId: activeConnection.value!.id,
        instanceName,
      }),
    `${instanceName}_表结构.xlsx`.replace(/[\\/:*?"<>|]/g, '_'),
    '表结构已导出',
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
  const ident = resolveTableIdent(dbType, {
    instanceName,
    schemaName,
    tableName,
  });
  return d.selectAllLimited(
    ident.schema,
    ident.table,
    visualClientConfig.exportMaxRows,
  );
}

/**
 * 从接口响应中取出真正的 Blob（兼容直出 Blob 与历史 { data: Blob } 包装）
 * @author yanch
 */
/**
 * 通用文件下载（Excel / SQL INSERT 等）
 * 业务失败常为 HTTP 200 + JSON blob，需嗅探内容再 toast
 * @author yanch
 */
async function downloadFileBlob(
  fetchBlob: () => Promise<any>,
  downloadName: string,
  successTip: string,
) {
  exporting.value = true;
  try {
    const res: any = await fetchBlob();
    const fileBlob = unwrapFileBlob(res);
    if (!fileBlob) {
      ElMessage.error('导出失败：未收到有效文件');
      return;
    }
    const errMsg = await readBlobErrorMessage(fileBlob);
    if (errMsg) {
      ElMessage.error(errMsg);
      return;
    }
    await downloadBlobAsFile(fileBlob, downloadName);
    ElMessage.success(successTip);
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
  if (cached?.primaryKeys?.length) return cached;
  const res: any = await getTableColumns(conn.id, instanceName, tableName);
  const list = res?.data || res || [];
  const arr = Array.isArray(list) ? list : [];
  const columns = arr.map((c: any) => c.fieldName).filter(Boolean);
  const primaryKeys = primaryKeysFromColumns(arr);
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

/** Tab 标题可作为保存名时返回；默认 Query N 视为未命名 */
function resolveDefaultQueryName(tab: { title?: string }): string {
  return tab.title && !/^Query\s+\d+$/i.test(tab.title) ? tab.title : '';
}

/** 当前用户名下是否仍存在该已保存查询（导入/删库后 ID 可能失效） */
async function checkSavedQueryMineExists(
  id: number | string,
): Promise<boolean> {
  try {
    const res: any = await getSavedQueryById(id);
    const data = res?.data ?? res;
    return data != null && data.id != null;
  } catch {
    return false;
  }
}

/**
 * 将当前 Tab 落库（新建或更新）。
 * 更新前先按 ID 查库：不存在则改为新建，避免误改他人数据或更新幽灵 ID。
 */
async function persistActiveQuery(opts: {
  preferUpdate: boolean;
  queryName: string;
}): Promise<boolean> {
  if (!activeConnection.value || !activeTab.value) return false;
  const name = opts.queryName.trim();
  if (!name) {
    ElMessage.warning('请输入查询名称');
    return false;
  }
  if (saveDialog.saving) return false;

  const instanceName = activeTab.value.instanceName!;
  const sqlText = activeTab.value.sql;
  saveDialog.saving = true;
  try {
    let doUpdate = false;
    if (opts.preferUpdate && activeTab.value.savedQueryId != null) {
      doUpdate = await checkSavedQueryMineExists(activeTab.value.savedQueryId);
      if (!doUpdate) {
        // 库中已无此记录：清空关联，按新建处理，名称不变
        activeTab.value.savedQueryId = undefined;
      }
    }

    if (doUpdate && activeTab.value.savedQueryId != null) {
      await editSavedQuery({
        id: activeTab.value.savedQueryId,
        queryName: name,
        sqlText,
        dbConfigId: activeConnection.value.id,
        instanceName,
        schemaName: activeTab.value.schemaName,
      });
      activeTab.value.title = name;
      markTabSaved(activeTab.value);
      ElMessage.success('已更新保存');
    } else {
      const res: any = await addSavedQuery({
        queryName: name,
        sqlText,
        dbConfigId: activeConnection.value.id,
        instanceName,
        schemaName: activeTab.value.schemaName,
      });
      const data = res?.data || res;
      activeTab.value.savedQueryId = data?.id;
      activeTab.value.title = name;
      markTabSaved(activeTab.value);
      ElMessage.success('已保存');
    }
    objectTreeRef.value?.reloadQueries?.(instanceName);
    return true;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '保存失败');
    return false;
  } finally {
    saveDialog.saving = false;
  }
}

/**
 * 保存当前编辑器 SQL。
 * - 已关联 savedQueryId：直接更新，不弹确认框；若库中无此 ID 则新建（保留名称）
 * - 未关联：弹出命名框后新建
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

  // 已保存过：静默更新，不弹窗
  if (activeTab.value.savedQueryId != null) {
    const name =
      resolveDefaultQueryName(activeTab.value) ||
      String(activeTab.value.title || '').trim() ||
      'untitled';
    void persistActiveQuery({ preferUpdate: true, queryName: name });
    return;
  }

  saveDialog.mode = 'create';
  saveDialog.queryName = resolveDefaultQueryName(activeTab.value);
  saveDialog.visible = true;
}

/**
 * 拖入 .sql/.txt：内容已写入编辑器，弹出保存对话框并预填文件名，保存到当前库。
 */
async function onImportSqlFile(payload: { fileName: string; content: string }) {
  if (!activeConnection.value || !activeTab.value) return;
  if (!activeTab.value.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}后再保存导入的查询`);
    return;
  }
  // 去掉扩展名作为默认查询名
  const base = (payload.fileName || 'imported')
    .replace(/\.(sql|txt)$/i, '')
    .trim()
    .slice(0, 100);
  activeTab.value.sql = payload.content;
  // 导入视为新建保存，不覆盖已有关联
  activeTab.value.savedQueryId = undefined;
  activeTab.value.savedSqlBaseline = undefined;
  activeTab.value.title = base || 'imported';
  saveDialog.mode = 'create';
  saveDialog.queryName = base || 'imported';
  saveDialog.visible = true;
  ElMessage.success('已导入文件内容，请确认名称后保存到当前库');
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
  saveDialog.queryName = resolveDefaultQueryName(activeTab.value);
  saveDialog.visible = true;
}

async function confirmSaveQuery() {
  if (!activeConnection.value || !activeTab.value) return;
  const name = saveDialog.queryName.trim();
  if (!name) {
    ElMessage.warning('请输入查询名称');
    return;
  }
  const ok = await persistActiveQuery({
    preferUpdate: saveDialog.mode === 'update',
    queryName: name,
  });
  if (ok) saveDialog.visible = false;
}

/**
 * 表格编辑按行 UPDATE：只执行、不刷新，失败时由结果区保住未保存脏行。
 */
async function executeRowDml(sql: string) {
  if (!activeConnection.value || !activeTab.value) {
    throw new Error('无可用连接');
  }
  const res: any = await executeDml({
    dbConfigId: activeConnection.value.id,
    instanceName:
      activeTab.value.instanceName || activeConnection.value.schemaName,
    sql,
  });
  return res?.data || res;
}

async function executeRowDmlBatch(sqls: string[]) {
  if (!activeConnection.value || !activeTab.value) {
    throw new Error('无可用连接');
  }
  const res: any = await executeDmlBatch({
    dbConfigId: activeConnection.value.id,
    instanceName:
      activeTab.value.instanceName || activeConnection.value.schemaName,
    sqls,
    source: 'result-grid',
  });
  return res?.data || res;
}

/** 表格编辑全部保存成功后，按原 SELECT 重查 */
async function onRefreshResult() {
  if (!activeTab.value) return;
  const sourceSql = activeTab.value.result?.sourceSql?.trim();
  if (!sourceSql) return;
  activeTab.value.executing = true;
  try {
    await refreshQueryResult(sourceSql);
  } finally {
    activeTab.value.executing = false;
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
      // 切库用当前对象树实例，不能把 FROM schema.table 的 schema 当成库名
      instanceName:
        activeTab.value.instanceName || activeConnection.value.schemaName,
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
  const t0 = performance.now();
  try {
    const res: any = await executeSql({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
      maxRows: visualClientConfig.defaultQueryMaxRows,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    activeTab.value.result = {
      columns: data.columns || [],
      columnTables: data.columnTables || [],
      rows: markRaw(data.rows || []),
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      clientElapsedMs,
      message: data.message,
      sourceSql: sql,
    };
    activeTab.value.resultTab = 'result';
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, '刷新结果失败');
    if (activeTab.value.result) {
      activeTab.value.result.error = errText;
      activeTab.value.result.clientElapsedMs = clientElapsedMs;
      activeTab.value.resultTab = 'messages';
    } else {
      activeTab.value.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errText,
        message: errText,
        clientElapsedMs,
        sourceSql: sql,
      };
      activeTab.value.resultTab = 'messages';
    }
  }
}

/** 打开右上角后台任务面板（复制 + 结构文档） */
function onOpenTaskPanel() {
  toggleTaskPanel();
}

/** 从 AI 结构文档打开任务面板时始终保持面板可见。 */
function onShowTaskPanel() {
  openTaskPanel(runningCount.value ? 'running' : 'done');
}

async function onCancelClientTask(task: Parameters<typeof cancelClientTask>[0]) {
  try {
    await cancelClientTask(task);
    ElMessage.success('已请求取消');
  } catch (e: any) {
    ElMessage.error(e?.message || '取消失败');
  }
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

/** ---------- 左右拖拽：对象树宽度 ---------- */
const LEFT_MIN = 100;
const LEFT_MAX = 600;
const workspaceRef = ref<HTMLElement | null>(null);
let resizingLeft = false;
let startXLeft = 0;
let startLeftW = 0;

function onLeftSplitterDown(e: MouseEvent) {
  resizingLeft = true;
  startXLeft = e.clientX;
  startLeftW = leftWidth.value;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onLeftSplitterMove);
  window.addEventListener('mouseup', onLeftSplitterUp);
}

function onLeftSplitterMove(e: MouseEvent) {
  if (!resizingLeft) return;
  const delta = e.clientX - startXLeft;
  const workspaceW = workspaceRef.value?.clientWidth || 1200;
  // 右侧至少留约 320px 给查询区
  const maxW = Math.min(LEFT_MAX, Math.max(LEFT_MIN, workspaceW - 320));
  leftWidth.value = Math.min(maxW, Math.max(LEFT_MIN, startLeftW + delta));
}

function onLeftSplitterUp() {
  resizingLeft = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', onLeftSplitterMove);
  window.removeEventListener('mouseup', onLeftSplitterUp);
}

/** ---------- 左右拖拽：竖排查询 Tabs 宽度 ---------- */
let resizingTabsLeft = false;
let startXTabs = 0;
let startTabsW = 0;

function onTabsLeftSplitterDown(e: MouseEvent) {
  if (queryTabsPlacement.value !== 'left') return;
  resizingTabsLeft = true;
  startXTabs = e.clientX;
  startTabsW = queryTabsLeftWidth.value;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onTabsLeftSplitterMove);
  window.addEventListener('mouseup', onTabsLeftSplitterUp);
}

function onTabsLeftSplitterMove(e: MouseEvent) {
  if (!resizingTabsLeft) return;
  const delta = e.clientX - startXTabs;
  const paneW = rightPaneRef.value?.clientWidth || 800;
  const maxW = Math.min(
    TABS_LEFT_MAX,
    Math.max(TABS_LEFT_MIN, paneW - 280),
  );
  queryTabsLeftWidth.value = Math.min(
    maxW,
    Math.max(TABS_LEFT_MIN, startTabsW + delta),
  );
}

function onTabsLeftSplitterUp() {
  resizingTabsLeft = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', onTabsLeftSplitterMove);
  window.removeEventListener('mouseup', onTabsLeftSplitterUp);
}

onMounted(() => {
  unbindClientFontScope = bindVisualClientFontScope();
  nextTick(() => {
    void tryConsumePendingSavedQuery();
    void refreshLicenseStatus();
    void bootstrapTasks();
  });
  window.addEventListener('keydown', onGlobalKeydown);
  // Electron「文件」菜单：与连接栏空白右键共用同一套导入/导出逻辑
  offDesktopSessionExport = window.lemonDesktop?.onExportTemporarySession?.(
    () => exportTemporarySession(),
  );
  offDesktopSessionImport = window.lemonDesktop?.onImportTemporarySession?.(
    () => connectionTabsRef.value?.openImportPicker(),
  );
});

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    // 输入框内不抢；Monaco 自己走 addAction
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (t?.closest?.('.monaco-editor')) return;
    if (!activeConnection.value) return;
    e.preventDefault();
    openAiAssistant();
    return;
  }
  if (e.key !== 'F11') return;
  // 仅当焦点在客户端工作区时响应，避免整页全屏
  if (!activeConnection.value) return;
  e.preventDefault();
  if (selectedTreeTable.value) {
    void openTableInNewEditor(selectedTreeTable.value);
  } else {
    ElMessage.warning('请先在左侧 Tables 中单击选中一个表');
  }
}

/**
 * AI 入口联动：
 * 工具条 @ai → openAiAssistant；编辑器 Ctrl+K → onAskAiFromEditor；
 * 结果集报错 → onAskAiFix；结构文档问 AI → onSchemaDocAskAi（先切实例）；
 * 浮窗 SQL 卡片 → onAiInsertSql / onAiReplaceSql / onAiRunSql（成功后 feedbackSchemaDocSilent）。
 */
function ensureAiReady(): boolean {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开连接');
    return false;
  }
  if (Number(activeConnection.value.aiEnabled) === 0) {
    ElMessage.warning('该连接已关闭 AI 助手，请在连接编辑中开启');
    return false;
  }
  if (!activeTab.value?.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return false;
  }
  return true;
}

function openAiAssistant(payload?: {
  scene?: 'sql' | 'chart' | 'schema_doc' | 'free';
  prefill?: string;
  context?: { selectedSql?: string; editorSql?: string; lastError?: string };
}) {
  if (!ensureAiReady()) return;
  const selected = payload?.context?.selectedSql ?? sqlEditorRef.value?.getSelectedText?.() ?? '';
  const editorSql =
    payload?.context?.editorSql ??
    sqlEditorRef.value?.getValue?.() ??
    activeTab.value?.sql ??
    '';
  aiChatRef.value?.open({
    scene: payload?.scene || 'sql',
    prefill: payload?.prefill,
    context: {
      selectedSql: selected,
      editorSql,
      lastError: payload?.context?.lastError ?? activeTab.value?.result?.error,
    },
  });
}

function onAskAiFromEditor(payload: { selectedSql: string; editorSql: string }) {
  openAiAssistant({ scene: 'sql', context: payload });
}

function onAskAiFix(payload: { sql: string; error: string }) {
  openAiAssistant({
    scene: 'sql',
    prefill: askAiPrefillForError(payload.error),
    context: {
      selectedSql: payload.sql,
      editorSql: payload.sql,
      lastError: payload.error,
    },
  });
}

function onAiInsertSql(sql: string) {
  const s = (sql || '').trim();
  if (!s) {
    ElMessage.warning('没有可插入的 SQL');
    return;
  }
  sqlEditorRef.value?.insertText?.(s);
  ElMessage.success('已插入到编辑器光标处');
}

function onAiReplaceSql(sql: string, silent = false) {
  const s = (sql || '').trim();
  if (!s) {
    if (!silent) ElMessage.warning('没有可替换的 SQL');
    return false;
  }
  if (sqlEditorRef.value?.replaceSelectionOrAll) {
    sqlEditorRef.value.replaceSelectionOrAll(s);
  } else if (activeTab.value) {
    activeTab.value.sql = s;
  }
  if (!silent) ElMessage.success('已替换编辑器中的 SQL');
  return true;
}

function onAiRunSql(sql: string) {
  const s = (sql || '').trim();
  if (!s) {
    ElMessage.warning('没有可运行的 SQL');
    return;
  }
  onAiReplaceSql(s, true);
  void (async () => {
    // UPDATE/DELETE/INSERT：确认后走 DML 接口（只读 executeSql 会拒绝）
    if (isFreeDmlSql(s)) {
      await runFreeDml(s, 'ai');
      return;
    }
    // DROP/CREATE/...：AI 运行一律先确认
    if (looksLikeControlledDdl(s) || isWriteOrDangerousSql(s)) {
      if (looksLikeControlledDdl(s)) {
        await runControlledDdl(s, { forceConfirm: true });
        return;
      }
      if (!(await confirmSqlWrite(s))) return;
      ElMessage.warning(
        '当前语句无法通过客户端安全通道执行，已写入编辑器，请确认后手工处理。',
      );
      return;
    }
    await runSql({ sql: s, source: 'ai' });
  })();
}

function onAiOpenSqlTab(sql: string) {
  const s = (sql || '').trim();
  if (!s) {
    ElMessage.warning('没有可打开的 SQL');
    return;
  }
  openSqlInNewTab(s, 'AI SQL', activeTab.value?.instanceName);
}

function onOpenSchemaDoc() {
  if (!ensureAiReady()) return;
  schemaDocVisible.value = true;
}

/** AI 浮窗内打开结构文档时先收起浮窗，避免遮挡抽屉内容。 */
function onAiOpenSchemaDoc() {
  if (!ensureAiReady()) return;
  aiChatRef.value?.minimize();
  schemaDocVisible.value = true;
}

function onOpenHistory() {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开连接');
    return;
  }
  historyVisible.value = true;
}

function onHistoryOpenSql(sql: string) {
  openSqlInNewTab(sql, '历史 SQL', activeTab.value?.instanceName);
}

function onSchemaDocAskAi(payload: { message: string; instanceName?: string }) {
  const inst = payload.instanceName || activeTab.value?.instanceName;
  if (inst && activeTab.value) {
    activeTab.value.instanceName = inst;
  }
  openAiAssistant({
    scene: 'schema_doc',
    prefill: payload.message,
  });
}

function onSchemaDocOpenSql(payload: { tableName?: string; instanceName?: string; sql?: string }) {
  if (payload.instanceName && activeTab.value) {
    activeTab.value.instanceName = payload.instanceName;
  }
  if (payload.tableName) {
    void openTableInNewEditor({
      instanceName: payload.instanceName || activeTab.value?.instanceName || '',
      tableName: payload.tableName,
    });
    return;
  }
  if (payload.sql) {
    // 同上：浏览对象打开的 SQL，一次性页签
    openSqlInNewTab(payload.sql, '表', payload.instanceName, undefined, undefined, true);
  }
}

/** 连接列表变化时再试一次（管理页先开连接再跳转时可能晚一拍） */
watch(
  () => openConnections.value.map((c) => c.sessionId).join(','),
  () => {
    void tryConsumePendingSavedQuery();
  },
);

onBeforeUnmount(() => {
  unbindClientFontScope?.();
  window.removeEventListener('keydown', onGlobalKeydown);
  offDesktopSessionExport?.();
  offDesktopSessionImport?.();
  offDesktopSessionExport = undefined;
  offDesktopSessionImport = undefined;
  onSplitterUp();
  onLeftSplitterUp();
  onTabsLeftSplitterUp();
  sessionPersist.stop();
  disposeTasks();
});
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="db-client">
      <ClientToolbar
        :has-connection="hasConnection"
        :task-count="runningCount"
        :license-hint="licenseHint"
        @create="onCreateConnection"
        @open="onOpenConnection"
        @refresh="refreshBrowseObjects"
        @group="goGroup"
        @query-view="goQueryView"
        @relation="goRelation"
        @saved-queries="goSavedQueryManage"
        @chart-library="goChartLibrary"
        @redis="goRedisConsole"
        @progress="onOpenTaskPanel"
        @system="onOpenSystemFunctions"
        @tools="onOpenDatabaseTools"
        @preferences="onOpenPreferences"
        @license="onOpenLicense"
        @ai="openAiAssistant()"
        @schema-doc="onOpenSchemaDoc"
        @history="onOpenHistory"
      />
      <ConnectionTabs
        ref="connectionTabsRef"
        :connections="openConnections"
        :active-id="activeConnectionId"
        @change="setActiveConnection"
        @close="closeConnection"
        @refresh="refreshBrowseObjects"
        @open="onOpenConnection"
        @export-session="exportTemporarySession"
        @import-session="importTemporarySession"
        @export-connection-queries="exportConnectionQueries"
        @import-connection-queries="importConnectionQueries"
      />

      <div
        v-if="activeConnection"
        ref="workspaceRef"
        class="workspace"
      >
        <aside
          class="left"
          :style="{ flex: `0 0 ${leftWidth}px`, width: leftWidth + 'px' }"
          @mousedown="onLeftPaneMouseDown"
          @contextmenu="onLeftPaneContextMenu"
        >
          <div class="search">
            <ElInput
              v-model="filterText"
              clearable
              size="small"
              placeholder="Search As Input"
            />
          </div>
          <component
            :is="objectTreeComponent"
            ref="objectTreeRef"
            :db-config-id="activeConnection.id"
            :db-type="activeConnection.dbType"
            :filter-text="filterText"
            :active-instance-name="activeTab?.instanceName || ''"
            @open-table="onOpenTable"
            @insert-name="onInsertName"
            @select-instance="onSelectInstance"
            @select-schema="onSelectSchema"
            @select-table="onSelectTreeTable"
            @open-saved-query="onOpenSavedQuery"
            @context-action="onTreeContextAction"
          />
        </aside>
        <div
          class="splitter-v"
          :title="$tr('拖拽调整对象树宽度')"
          @mousedown.prevent="onLeftSplitterDown"
        />

        <section
          ref="rightPaneRef"
          class="right"
          :class="{ 'tabs-left': queryTabsPlacement === 'left' }"
        >
          <div
            v-if="queryTabsPlacement === 'left'"
            class="query-tabs-rail"
            :style="{
              flex: `0 0 ${queryTabsLeftWidth}px`,
              width: queryTabsLeftWidth + 'px',
            }"
          >
            <QueryTabs
              :tabs="tabs"
              :active-id="activeTabId"
              :max-tabs="MAX_TABS"
              placement="left"
              @change="(id) => (activeTabId = id)"
              @add="onAddQueryTab"
              @close="closeTab"
              @close-all="closeAllTabs"
              @close-others="closeOtherTabs"
              @reorder="reorderTabs"
            />
          </div>
          <div
            v-if="queryTabsPlacement === 'left'"
            class="splitter-v"
            :title="$tr('拖拽调整查询页签宽度')"
            @mousedown.prevent="onTabsLeftSplitterDown"
          />
          <QueryTabs
            v-if="queryTabsPlacement === 'top'"
            :tabs="tabs"
            :active-id="activeTabId"
            :max-tabs="MAX_TABS"
            placement="top"
            @change="(id) => (activeTabId = id)"
            @add="onAddQueryTab"
            @close="closeTab"
            @close-all="closeAllTabs"
            @close-others="closeOtherTabs"
            @reorder="reorderTabs"
          />
          <div class="query-main">
          <!-- 禁浏览器右键，避免执行/格式化等按钮弹出系统菜单 -->
          <div class="query-actions" @contextmenu.prevent>
                        <ElSelect
              v-if="activeTab"
              v-model="activeTab.instanceName"
              filterable
              clearable
              size="small"
              class="instance-select"
              :class="{ 'has-instance': !!activeTab.instanceName }"
              :placeholder="`选择${instanceLabel}`"
            >
              <template #label="{ label }">
                <span class="instance-select-label">
                  <span>{{ label }}</span>
                  <span
                    v-if="label"
                    class="instance-active-dot"
                    :title="$tr('当前 SQL 编辑器选中的库实例')"
                  />
                </span>
              </template>
              <ElOption
                v-for="name in instanceOptions"
                :key="name"
                :label="name"
                :value="name"
              >
                <span class="instance-option-row">
                  <span>{{ name }}</span>
                  <span
                    v-if="name === activeTab.instanceName"
                    class="instance-active-dot"
                    :title="$tr('当前 SQL 编辑器选中的库实例')"
                  />
                </span>
              </ElOption>
            </ElSelect>
            <ElButton
              type="primary"
              size="small"
              :loading="activeTab?.executing"
              :disabled="activeTab?.executing"
              @click="runSql"
            >
              {{ $tr('执行 (Ctrl+Enter / F9)') }}
            </ElButton>
            <ElButton
              v-if="activeTab?.executing"
              type="danger"
              size="small"
              @click="stopSql"
            >
              {{ $tr('停止') }}
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onFormatSql"
            >
              {{ $tr('格式化 (F12)') }}
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onSaveQuery"
            >
              {{ $tr('保存 (Ctrl+S)') }}
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onSaveQueryAs"
            >
              {{ $tr('另存为') }}
            </ElButton>
            <ElButton
              size="small"
              @click="
                activeTab && (activeTab.resultVisible = !activeTab.resultVisible)
              "
            >
              {{ $tr(activeTab?.resultVisible ? '隐藏结果' : '显示结果') }}
            </ElButton>
            <ElButton
              size="small"
              :icon="Aim"
              :title="$tr('在对象树中定位')"
              :disabled="!activeTab"
              @click="locateCurrentInTree"
            />
          </div>

          <!-- SQL 编辑区（占满剩余空间） -->
          <div class="editor-area" :style="editorFlexStyle">
            <SqlEditor
              v-if="activeTab"
              ref="sqlEditorRef"
              v-model="activeTab.sql"
              :tab-id="activeTab.id"
              :alive-tab-ids="tabs.map((t) => t.id)"
              :db-config-id="activeConnection?.id"
              :db-type="activeConnection?.dbType"
              :instance-name="activeTab.instanceName"
              :read-only="!!activeTab.executing"
              :load-columns="loadEditorColumns"
              :load-tables="loadEditorTables"
              @execute="runSql"
              @save="onSaveQuery"
              @import-file="onImportSqlFile"
              @ask-ai="onAskAiFromEditor"
              @view-table-info="onViewTableInfoFromEditor"
            />
          </div>

          <!-- 拖拽分隔条：仅在结果显示时可用 -->
          <div
            v-if="activeTab?.resultVisible"
            class="splitter-h"
            :title="$tr('拖拽调整编辑器与结果区高度')"
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
              :table-metas="resultTableMetas"
              :db-type="activeConnection?.dbType"
              :primary-keys="resultPrimaryKeys"
              :primary-keys-ready="resultPrimaryKeysReady"
              :ensure-primary-keys="ensureResultPrimaryKeys"
              @update:visible="(v) => (activeTab!.resultVisible = v)"
              @update:active-tab="(v) => (activeTab!.resultTab = v)"
              :execute-row-dml="executeRowDml"
              :execute-row-dml-batch="executeRowDmlBatch"
              @run-dml="onRunDml"
              @refresh-result="onRefreshResult"
              @export-excel="onExportExcel"
              @export-sql="onExportSqlInsert"
              @ask-ai-fix="onAskAiFix"
            />
          </div>
          </div>
        </section>
      </div>
      <EmptyWorkspace
        v-else
        :active="!activeConnection"
        @open="handleOpened"
        @create="onCreateConnection"
      />
      <AiDockBar />
    </div>

    <AiChatWindow
      ref="aiChatRef"
      :db-config-id="activeConnection?.id"
      :instance-name="activeTab?.instanceName"
      :conn-label="activeConnection?.dbName"
      :ai-allow-sample-data="activeConnection?.aiAllowSampleData"
      @insert-sql="onAiInsertSql"
      @replace-sql="onAiReplaceSql"
      @run-sql="onAiRunSql"
      @open-sql-in-new-tab="onAiOpenSqlTab"
      @open-schema-doc="onAiOpenSchemaDoc"
    />

    <SchemaDocDrawer
      v-model="schemaDocVisible"
      :db-config-id="activeConnection?.id"
      :instance-name="activeTab?.instanceName"
      :conn-label="activeConnection?.dbName"
      :instance-options="instanceOptions"
      :instance-label="instanceLabel"
      @ask-ai="onSchemaDocAskAi"
      @select-instance="onSelectInstance"
      @open-sql="onSchemaDocOpenSql"
      @open-progress="onShowTaskPanel"
    />

    <QueryHistoryDrawer
      v-model="historyVisible"
      :db-config-id="activeConnection?.id"
      :instance-name="activeTab?.instanceName"
      @open-sql="onHistoryOpenSql"
    />

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

    <TableInfoDialog
      v-model="tableInfoDialog.visible"
      :loading="tableInfoDialog.loading"
      :info="tableInfoDialog.info"
      :default-tab="tableInfoDialog.defaultTab"
    />

    <TableDesignerDialog
      v-model="tableDesigner.visible"
      :mode="tableDesigner.mode"
      :db-type="activeConnection?.dbType"
      :instance-name="tableDesigner.instanceName"
      :schema-name="tableDesigner.schemaName"
      :table-name="tableDesigner.tableName"
      :info="tableDesigner.info"
      :loading="tableDesigner.loading"
      :saving="tableDesigner.saving"
      @save="saveTableDesign"
    />

    <CopyDatabaseDialog
      v-model="copyDb.visible"
      :source-connection="activeConnection"
      :source-instance="copyDb.instanceName"
      :source-schema="copyDb.sourceSchema"
      :preselected-tables="copyDb.preselectedTables"
      :open-connections="openConnections"
      @started="trackCopy"
    />

    <ClientTaskPanel
      v-model="panelVisible"
      v-model:tab="taskPanelTab"
      :running="runningTasks"
      :done="doneTasks"
      :refreshing="tasksRefreshing"
      @cancel="onCancelClientTask"
      @refresh="refreshClientTasks"
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
        <ElFormItem :label="$tr('查询名称')" required>
          <ElInput
            v-model="saveDialog.queryName"
            clearable
            maxlength="100"
            show-word-limit
            :placeholder="$tr('例如：用户列表查询')"
            @keyup.enter="confirmSaveQuery"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="saveDialog.visible = false">{{ $tr('取消') }}</ElButton>
        <ElButton
          type="primary"
          :loading="saveDialog.saving"
          @click="confirmSaveQuery"
        >
          {{ $tr(saveDialog.mode === 'update' ? '更新' : '保存') }}
        </ElButton>
      </template>
    </ElDialog>

    <SqlScriptUploadDialog
      v-if="activeConnection"
      v-model="sqlScriptDialog.visible"
      :db-config-id="activeConnection.id"
      :db-type="activeConnection.dbType"
      :instance-name="sqlScriptDialog.instanceName"
      @started="onSqlScriptStarted"
    />

    <NativeImportDialog
      v-if="activeConnection"
      v-model="nativeImportDialog.visible"
      :db-config-id="activeConnection.id"
      :db-type="activeConnection.dbType"
      :instance-name="nativeImportDialog.instanceName"
      @started="onSqlScriptStarted"
    />

    <CreateDatabaseDialog
      v-if="activeConnection"
      v-model="createDbDialog.visible"
      :db-config-id="activeConnection.id"
      :db-type="activeConnection.dbType"
      :connect-instance="createDbDialog.connectInstance"
      @created="onDatabaseCreated"
    />
    <SystemFunctionsDialog
      v-model="systemFunctionsVisible"
      :mode="systemFunctionsMode"
      @imported="onBundleImported"
    />
    <DatabaseToolDialog v-model="databaseToolVisible" />
    <ClientPreferencesDialog
      v-model="preferencesVisible"
      v-model:query-tabs-placement="queryTabsPlacement"
    />
    <LicenseDialog
      v-model="licenseVisible"
      :force="licenseForce"
      @activated="onLicenseActivated"
    />
  </Page>
</template>

<style scoped>
.db-client {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
  font-size: var(--vc-ui-font-size, 13px);
}
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}
.left {
  display: flex;
  flex-direction: column;
  border-right: none;
  min-width: 100px;
  flex: 0 0 auto;
  overflow: hidden;
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
.right.tabs-left {
  flex-direction: row;
}
.query-tabs-rail {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}
.query-main {
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
  width: 220px;
}
/* 已选库时用主题主色底，亮/暗色与品牌色自动适配 */
.instance-select.has-instance :deep(.el-select__wrapper) {
  background: color-mix(in srgb, var(--el-color-primary) 14%, var(--el-bg-color));
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
}
.instance-select.has-instance :deep(.el-select__selected-item) {
  color: var(--el-color-primary);
  font-weight: 600;
}
.instance-select-label,
.instance-option-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
.instance-active-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 28%, transparent);
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
/* 垂直分隔条：对象树 / 左侧 Tabs 宽度 */
.splitter-v {
  flex: 0 0 5px;
  cursor: col-resize;
  background: var(--el-border-color-lighter);
  position: relative;
  z-index: 2;
  align-self: stretch;
}
.splitter-v:hover,
.splitter-v:active {
  background: var(--el-color-primary-light-5);
}
.result-area {
  min-height: 100px;
  overflow: hidden;
}
</style>
