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
// 路由离开守卫已停用，如需恢复请同时恢复 onBeforeRouteLeave 导入
import { useRouter } from 'vue-router';

import { executeDdl, executeDml, executeDmlBatch, executeSql, executeSqlBatch, cancelSql, explainPlan, exportSqlExcel, exportSqlInsert, exportTableSchemaExcel, getInstances, getObjectScript, getTableColumns, getTableDDL, getTableInfo, getTables } from '#/api/visual/database';
import { getDatabaseMetadataScope } from '#/api/visual/databaseMetadataCache';
import { feedbackSchemaDoc } from '#/api/ai/agent';
import {
  addSavedQuery,
  deleteSavedQuery,
  editSavedQuery,
  getSavedQueryById,
} from '#/api/visual/savedQuery';
import { getDbConfigById } from '#/api/visual/vq';
import {
  downloadDbBackupFile,
  getDbBackupTask,
} from '#/api/visual/dbBackup';
import { Page } from '@vben/common-ui';

import { ElMessage, ElMessageBox } from 'element-plus';
import {
  downloadBlobAsFile,
  readBlobErrorMessage,
  unwrapFileBlob,
} from '#/utils/blobDownload';
import { Aim } from '@element-plus/icons-vue';

import type { TreeCtxAction } from './components/object-tree/ObjectTreeContextMenu.vue';

import ChangeWindowBadge from './components/ChangeWindowBadge.vue';
import ClientToolbar from './components/ClientToolbar.vue';
import ConnectionDialog from './components/ConnectionDialog.vue';
import ConnectionTabs from './components/ConnectionTabs.vue';
import WorkspaceSnapshotDialog from './components/WorkspaceSnapshotDialog.vue';
import EmptyWorkspace from './components/EmptyWorkspace.vue';
import ObjectTree from './components/object-tree/ObjectTree.vue';
import OracleObjectTree from './components/object-tree/OracleObjectTree.vue';
import PostgreSqlObjectTree from './components/object-tree/PostgreSqlObjectTree.vue';
import type { ResultEditParameter } from './utils/resultComparison';
import { allResultStates, focusBatchResult, hasResultDraft, isResultSaving, putResultDraft } from './composables/resultDraftStore';
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
import DbBackupProgressPanel from './components/DbBackupProgressPanel.vue';
import SystemFunctionsDialog from './components/SystemFunctionsDialog.vue';
import TableInfoDialog from './components/TableInfoDialog.vue';
import TableDesignerDialog from './components/TableDesignerDialog.vue';
import ClientPreferencesDialog from './components/ClientPreferencesDialog.vue';
import LicenseDialog from './components/LicenseDialog.vue';
import AiChatWindow from './components/ai/AiChatWindow.vue';
import AiDockBar from './components/ai/AiDockBar.vue';
import SchemaDocDrawer from './components/ai/SchemaDocDrawer.vue';
import QueryHistoryDrawer from './components/ai/QueryHistoryDrawer.vue';
import ExecutedSqlDrawer from './components/query/ExecutedSqlDrawer.vue';
import { rememberExecutedSql } from './utils/executedSqlHistory';
import {
  bindVisualClientFontScope,
  useClientPreferences,
} from './composables/useClientPreferences';
import { getLicenseStatus } from '#/api/visual/license';
import { useConnectionStore } from './composables/useConnectionStore';
import { useClientTasks } from './composables/useClientTasks';
import {
  setupClientSessionPersist,
  type ClientSessionSnapshot,
} from './composables/useClientSessionPersist';
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
  type QueryResultSet,
} from './composables/useQueryTabs';
import { visualClientConfig } from './config';
import { resolveConnectionEnv } from './utils/connectionEnv';
import { isProductionConnection } from './utils/prodConnection';
import {
  buildAiOptimizePrompt,
  type ExplainPlanResult,
  supportsExplain,
  supportsExplainAnalyze,
} from './utils/explainPlan';
import { humanizeApiError } from './utils/humanizeApiError';
import { resolveSqlDialect, resolveTableIdent } from './dialect/sqlDialect';
import { resolveDbType, resolveDialectFamily } from './dialect/dbTypes';
import type { TableDesignSqlResult } from './dialect/tableDesignerDialect';
import { isDestructiveDdl, isFlushPrivileges, looksLikeControlledDdl } from './utils/controlledDdl';
import {
  metadataInstanceName,
  metadataTableName,
  parseQueryTables,
  type QueryTableRef,
  type TableRef,
} from './utils/resultRowSql';
import { canMuteSqlWriteConfirm, confirmSqlWrite } from './utils/sqlWriteConfirmation';
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
  bindEditorMetadataScope,
  expandSessionChain,
  getRememberedTables,
  isEditorSessionSql,
  isPreparedScriptSql,
  listSqlStatements,
  rememberInstanceTables,
} from './utils/sqlEditorAssist';

defineOptions({ name: 'VisualClient' });

// 同步表名索引与 API 缓存共用服务器和用户范围。@author yanch
bindEditorMetadataScope(getDatabaseMetadataScope);

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
  trackDbBackup,
  applyDbBackup,
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
  reorderTabs,
  openSqlInNewTab,
  markTabSaved,
} = useQueryTabs(() => activeConnectionId.value);

/** 关闭查询页签前统一保护未保存 SQL，避免单关、全关、关其它三条路径静默丢稿。 */
const closingQueryTabs = new Set<string>();

async function confirmDiscardQueryTabs(targets: typeof tabs.value) {
  if (!targets.some((tab) => isQueryTabDirty(tab) || allResultStates(tab.result).some(hasResultDraft) || (tab === activeTab.value && resultPanelRef.value?.hasPendingEdits()))) return true;
  try {
    await ElMessageBox.confirm(
      '要关闭的页签中有未保存 SQL 或结果编辑，关闭后这些修改将丢失。是否继续？',
      '未保存的查询',
      { type: 'warning', confirmButtonText: '继续关闭', cancelButtonText: '取消' },
    );
    return true;
  } catch {
    return false;
  }
}

/** 关闭前取消该批页签的查询；无法安全取消的写操作必须等待结束。 */
async function cancelClosingQueryTabs(targets: typeof tabs.value): Promise<boolean> {
  if (targets.some((tab) => closingQueryTabs.has(tab.id))) return false;
  if (targets.some((tab) => allResultStates(tab.result).some(isResultSaving))) {
    ElMessage.warning('结果正在保存，请等待完成后再关闭');
    return false;
  }
  if (targets.some((tab) => tab.executing && !sqlRuns.has(tab.id))) {
    ElMessage.warning('有操作正在执行，当前无法安全取消，请等待完成后再关闭');
    return false;
  }
  targets.forEach((tab) => closingQueryTabs.add(tab.id));
  try {
    await Promise.all(targets.map(async (tab) => {
      const run = sqlRuns.get(tab.id); if (!run) return;
      await cancelSql({ requestId: run.requestId });
      run.abort.abort();
      if (sqlRuns.get(tab.id) === run) sqlRuns.delete(tab.id);
    }));
    if (targets.some((tab) => sqlRuns.has(tab.id) || allResultStates(tab.result).some(isResultSaving))) {
      ElMessage.warning('查询状态已变化，页签已保留，请重新关闭'); return false;
    }
    return true;
  } catch {
    ElMessage.error('取消查询失败，页签已保留，请重试或等待查询结束');
    return false;
  } finally {
    targets.forEach((tab) => closingQueryTabs.delete(tab.id));
  }
}

/** 关闭单个页签，确认和取消都只针对最初选择的目标。 */
async function closeTab(tabId: string) {
  const target = tabs.value.find((tab) => tab.id === tabId);
  if (!target || !(await confirmDiscardQueryTabs([target])) || !(await cancelClosingQueryTabs([target]))) return;
  closeTabDirect(tabId);
}

/** 快捷键与点击关闭采用相同的草稿保护及取消策略。 */
function closeActiveQueryTabNow() {
  if (activeTabId.value) void closeTab(activeTabId.value);
}

async function closeAllTabs() {
  const targets = tabs.value.slice();
  if (!(await confirmDiscardQueryTabs(targets)) || !(await cancelClosingQueryTabs(targets))) return;
  targets.forEach((tab) => closeTabDirect(tab.id));
}

async function closeOtherTabs(keepTabId: string) {
  const targets = tabs.value.filter((tab) => tab.id !== keepTabId);
  if (!(await confirmDiscardQueryTabs(targets)) || !(await cancelClosingQueryTabs(targets))) return;
  targets.forEach((tab) => closeTabDirect(tab.id));
}

/** 取出这些连接上的查询页签，关闭前统一确认草稿并取消执行。 */
function queryTabsOfConnections(sessionIds: Array<number | string>) {
  const snap = getQueryTabsSnapshot().tabsByConnection;
  return sessionIds.flatMap((id) => (snap[String(id)] || []).slice());
}

/** 确认期间这些连接又新开了页签时，不能按旧名单静默关掉。 */
function connectionQueryTabsChanged(
  sessionIds: Array<number | string>,
  targets: typeof tabs.value,
) {
  const snap = getQueryTabsSnapshot().tabsByConnection;
  return sessionIds.some((id) => {
    const current = snap[String(id)] || [];
    return current.some((tab) => !targets.some((target) => target.id === tab.id));
  });
}

/**
 * 关闭一批连接。草稿确认和取消查询只做一次，避免「关闭所有」连续弹窗。
 * 只关闭调用时已经打开的这些 session，等待期间新开的连接会留下。
 */
async function closeConnections(sessionIds: Array<number | string>) {
  const ids = sessionIds.filter((id) => id != null && String(id) !== '');
  if (!ids.length) return false;
  const targets = queryTabsOfConnections(ids);
  if (!(await confirmDiscardQueryTabs(targets)) || !(await cancelClosingQueryTabs(targets))) return false;
  if (connectionQueryTabsChanged(ids, targets)) {
    ElMessage.warning('连接中的页签已变化，请重新关闭');
    return false;
  }
  ids.forEach((id) => closeConnectionDirect(id));
  return true;
}

/** 关闭连接前保护该连接上的全部查询，不因等待期间新增页签而静默丢稿。 */
async function closeConnection(sessionId: number | string) {
  await closeConnections([sessionId]);
}

/** 连接栏右键「关闭所有」：关掉当前打开的每一条连接。 */
async function closeAllConnections() {
  await closeConnections(openConnections.value.map((conn) => conn.sessionId));
}

/** 连接栏右键「关闭其他」：保留右键的这条，并把它切成当前连接。 */
async function closeOtherConnections(keepSessionId: number | string) {
  const targets = openConnections.value
    .map((conn) => conn.sessionId)
    .filter((id) => String(id) !== String(keepSessionId));
  if (!(await closeConnections(targets))) return;
  if (openConnections.value.some((conn) => String(conn.sessionId) === String(keepSessionId))) {
    setActiveConnection(keepSessionId);
  }
}

/** 收集全部连接中的页签，离开工作台不能只检查当前连接。 */
function allWorkspaceQueryTabs() {
  return Object.values(getQueryTabsSnapshot().tabsByConnection).flat();
}

/** 浏览器原生离开提示不存储结果数据，同时覆盖未保存行/SQL及执行中的请求。 */
function protectWorkspaceUnload(event: BeforeUnloadEvent) {
  if (!allWorkspaceQueryTabs().some((tab) => tab.executing || isQueryTabDirty(tab) || allResultStates(tab.result).some((result) => isResultSaving(result) || hasResultDraft(result)))
      && !resultPanelRef.value?.hasPendingEdits() && !resultPanelRef.value?.isSaving()) return;
  event.preventDefault(); event.returnValue = '';
}

onMounted(() => window.addEventListener('beforeunload', protectWorkspaceUnload));
/*
 * 切换到其他模块时的离开确认已停用：每次切换菜单都会弹窗，打断操作。
 * 浏览器刷新/关闭页面仍由上方 beforeunload 保护。
 * onBeforeRouteLeave(async () => {
 *   if (resultPanelRef.value?.isSaving()) { ElMessage.warning('结果正在保存，请等待完成后离开'); return false; }
 *   const targets = allWorkspaceQueryTabs();
 *   if (!(await confirmDiscardQueryTabs(targets))) return false;
 *   return cancelClosingQueryTabs(targets);
 * });
 */

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
/** 连接栏右键「已执行 SQL」：只看这个连接在前端记下的最近语句 */
const executedSqlDrawer = reactive({
  visible: false,
  dbConfigId: '' as string | number,
  connectionName: '',
});
/** 右侧工作区 DOM，用于计算可拖拽高度上下限 */
const rightPaneRef = ref<HTMLElement | null>(null);
/** 导出 Excel loading */
const exporting = ref(false);

/** SQL 转储对话框 */
const sqlDump = reactive({
  background: false,
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
 * Web / Electron 均走浏览器下载；落盘键按登录用户隔离，Electron 再按服务端隔离。
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
 * 校验失败则拒绝写入；成功后落盘到当前用户的会话键（Electron 再按服务端隔离）。
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

/** 服务器工作现场：保存时带上当前快照，加载时按返回的 id 记回本地缓存。 */
const workspaceDialog = reactive({
  visible: false,
  mode: 'save' as 'load' | 'save',
  persistId: '',
  persistAlias: '',
  snapshot: null as ClientSessionSnapshot | null,
});

function syncWorkspaceMeta() {
  const meta = sessionPersist.getPersistMeta();
  workspaceDialog.persistId = meta.id;
  workspaceDialog.persistAlias = meta.alias;
}

function openSaveWorkspace() {
  const snap = sessionPersist.exportSnapshot();
  if (!snap.connections.length) {
    ElMessage.warning('当前没有可保存的连接');
    return;
  }
  syncWorkspaceMeta();
  workspaceDialog.snapshot = snap;
  workspaceDialog.mode = 'save';
  workspaceDialog.visible = true;
}

function openLoadWorkspace() {
  syncWorkspaceMeta();
  workspaceDialog.snapshot = null;
  workspaceDialog.mode = 'load';
  workspaceDialog.visible = true;
}

function onWorkspaceSaved(payload: { id: string; alias: string }) {
  sessionPersist.setPersistMeta(payload.id, payload.alias);
  syncWorkspaceMeta();
  ElMessage.success('工作现场已保存，可在另一台电脑登录同一账号后加载');
}

function onWorkspaceLoaded(payload: { id: string; alias: string; snapshot: unknown }) {
  const snap = sessionPersist.applyOwnedSnapshot(payload.snapshot, {
    id: payload.id,
    alias: payload.alias,
  });
  if (!snap) {
    ElMessage.error('这份现场无法打开');
    return;
  }
  syncWorkspaceMeta();
  ElMessage.success(`已加载工作现场「${payload.alias || '未命名'}」`);
}

function onWorkspaceUnlinked() {
  sessionPersist.setPersistMeta('', '');
  syncWorkspaceMeta();
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
  executionError: '',
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
  async (id, _oldId, onCleanup) => {
    let stale = false;
    onCleanup(() => { stale = true; });
    instanceOptions.value = [];
    if (id == null) return;
    try {
      const res: any = await getInstances(id);
      if (stale) return;
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
      if (stale) return;
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
  const tables=parseQueryTables(sql);
  const metadata=activeTab.value?.result?.columnMetadata || [];
  const family=resolveSqlDialect(activeConnection.value?.dbType).family;
  for(const table of tables) {
    const namespaces=new Map(metadata.filter((column)=>column.table && column.table.toLowerCase()===table.table.toLowerCase())
      .map((column)=>[JSON.stringify([column.catalog,column.schema,column.table]),column]));
    // 未限定同名表对应多个物理命名空间时无法安全推断，保持只读。
    if(!table.schema && namespaces.size>1)return [];
    if(namespaces.size===1) {
      const physical=[...namespaces.values()][0]!;
      if(physical.table)table.table=physical.table;
      if(physical.schema)table.schema=physical.schema;
      if(family==='MYSQL_LIKE' && physical.catalog)table.schema=physical.catalog;
      if(family==='SQLSERVER_LIKE' && physical.catalog)table.catalog=physical.catalog;
    }
  }
  return tables;
});

function parseMongoCollectionForResult(sql: string): QueryTableRef | null {
  // Kept local so the metadata pipeline remains QueryTableRef-compatible.
  return isMongoEditableQuery(sql) ? parseMongoCollection(sql) : null;
}

const resultTableRef = computed<TableRef | null>(() => {
  const t = resultQueryTables.value[0];
  return t ? { catalog: t.catalog, schema: t.schema, table: t.table } : null;
});

/** 结果表主键。MySQL 的 `库`.`表` 按 SQL 里的库查，其它方言仍用当前库。 */
const resultPrimaryKeys = ref<string[]>([]);
const resultPrimaryKeysReady = ref(false);
const resultTableMetas = ref<ResultTableMeta[]>([]);

/**
 * 拉一张表的列名 + 主键。不走空主键的补全缓存。
 */
async function fetchTableMeta(
  instanceName: string,
  tableName: string,
  conn = activeConnection.value,
): Promise<{ columns: string[]; primaryKeys: string[] }> {
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
  if (!columns.length) throw new Error('无法确认表列和主键，已禁止结果回写');
  return { columns, primaryKeys: keys };
}

let metadataGeneration = 0;
async function refreshResultPrimaryKeys() {
  const generation = ++metadataGeneration;
  const tables = resultQueryTables.value;
  const conn = activeConnection.value;
  const currentInstance = activeTab.value?.result?.sourceInstanceName || activeTab.value?.instanceName || conn?.schemaName || '';
  if (!tables.length || !conn) {
    resultTableMetas.value = [];
    resultPrimaryKeys.value = [];
    resultPrimaryKeysReady.value = true;
    return;
  }
  resultPrimaryKeysReady.value = false;
  try {
    const metas: ResultTableMeta[] = await Promise.all(
      tables.map(async (t) => {
        // 跨库 SELECT `lemon_cms`.`t` 时，当前选中库不能拿来查这张表的主键。
        const inst = metadataInstanceName(t, conn.dbType, currentInstance);
        const metaName = metadataTableName(t, conn.dbType);
        if (!inst) {
          return {
            ref: { catalog: t.catalog, schema: t.schema, table: t.table },
            alias: t.alias,
            columns: [] as string[],
            primaryKeys: [] as string[],
          };
        }
        try {
          const { columns, primaryKeys } = await fetchTableMeta(inst, metaName, conn);
          return {
            ref: { catalog: t.catalog, schema: t.schema, table: t.table },
            alias: t.alias,
            columns,
            primaryKeys,
          };
        } catch (e) {
          console.warn('读取联表元数据失败', t.table, e);
          return {
            ref: { catalog: t.catalog, schema: t.schema, table: t.table },
            alias: t.alias,
            columns: [] as string[],
            primaryKeys: [] as string[],
          };
        }
      }),
    );
    if (generation !== metadataGeneration) return;
    resultTableMetas.value = metas;
    resultPrimaryKeys.value = metas[0]?.primaryKeys || [];
  } catch (e) {
    console.warn('读取表主键失败', e);
    resultTableMetas.value = [];
    resultPrimaryKeys.value = [];
  } finally {
    if (generation === metadataGeneration) resultPrimaryKeysReady.value = resultTableMetas.value.every((meta) => meta.columns.length > 0);
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

async function handleOpened(conn: any) {
  if (isProductionConnection(conn)) {
    // env 显式标记为 PROD 时直接说明；未标记时是按名称关键词推断
    const explicit = resolveConnectionEnv(conn).source === 'FIELD';
    try {
      await ElMessageBox.confirm(
        explicit
          ? `「${conn?.dbName || '未命名'}」是生产环境连接（${conn?.dbHost || '未知主机'}）。确认打开吗？`
          : `「${conn?.dbName || '未命名'}」看起来是生产连接（${conn?.dbHost || '未知主机'}）。确认打开吗？`,
        '打开生产连接',
        {
          type: 'warning',
          confirmButtonText: '确认打开生产',
          cancelButtonText: '取消',
          distinguishCancelAndClose: true,
        },
      );
    } catch {
      return;
    }
  }
  const result = openConnection(conn);
  if (!result.ok) {
    if (result.reason === 'max') {
      ElMessage.warning(
        `最多同时打开 ${visualClientConfig.maxOpenConnections} 个数据库连接，请先关闭部分连接`,
      );
    }
    return;
  }
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

/** 提交为工单：有选区用选区，否则带编辑器全文（不用「当前可执行语句」） */
function submitAsWorkOrder() {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  const selected =
    (sqlEditorRef.value?.getSelectedText?.() as string | undefined)?.trim() || '';
  const full =
    (sqlEditorRef.value?.getValue?.() as string | undefined)?.trim() ||
    activeTab.value?.sql?.trim() ||
    '';
  const sql = selected || full;
  if (!sql) {
    ElMessage.warning('请先在编辑器中填写要提交的 SQL');
    return;
  }
  const title = `客户端提交 · ${activeConnection.value.dbName || ''}`;
  const instance =
    activeTab.value?.instanceName ||
    activeConnection.value.schemaName ||
    '';
  // 每次点击用新 nonce，避免和已打开的工单页 fullPath 相同导致不重新进入
  const nonce = String(Date.now());
  try {
    sessionStorage.setItem(
      'lemon.sqlWorkOrder.prefill',
      JSON.stringify({
        sql,
        title,
        dbConfigId: String(activeConnection.value.id),
        instanceName: instance,
        nonce,
      }),
    );
  } catch {
    // ignore quota
  }
  // 路由 name 以后台菜单为准（SqlWork），勿写死 path
  router.push({
    name: 'SqlWork',
    query: {
      create: '1',
      nonce,
      dbConfigId: String(activeConnection.value.id),
      instance,
      title,
    },
  });
}

function goChartLibrary() {
  router.push({ name: 'Dashboard' });
}

/** 跳转变更窗口配置页（路由名以后台菜单为准：DbChangeWindow） */
function goChangeWindow() {
  router.push({ name: 'DbChangeWindow' });
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
        env: cfg.env,
        envLabel: cfg.envLabel,
        connectionStatus: cfg.connectionStatus,
      });
    }
  } catch {
    // 配置拉取失败仍继续刷对象树
  }
  // 对象树先清理当前 dbId 并重载实例，下拉框随后复用同一份新缓存。@author yanch
  await objectTreeRef.value?.reload?.();
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
          env: cfg.env,
          envLabel: cfg.envLabel,
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

/** SQL 编辑器右键「改变表」：与对象树 alterTable 同一套设计器。 */
async function onAlterTableFromEditor(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  await openAlterTableDesigner({
    instanceName: payload.instanceName,
    tableName: payload.tableName,
    schemaName: payload.schemaName || '',
  });
}

/**
 * 打开「改变表」可视化设计器（对象树 / SQL 编辑器共用）。
 */
async function openAlterTableDesigner(payload: {
  instanceName: string;
  tableName: string;
  schemaName?: string;
}) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
  const instanceName = (payload.instanceName || '').trim();
  const tableName = (payload.tableName || '').trim();
  if (!instanceName || !tableName) {
    ElMessage.warning('请先选中表名');
    return;
  }
  tableDesigner.mode = 'alter';
  tableDesigner.executionError = '';
  tableDesigner.instanceName = instanceName;
  tableDesigner.schemaName = payload.schemaName || '';
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
    tableDesigner.schemaName =
      tableDesigner.info?.schemaName || payload.schemaName || '';
  } catch (e: any) {
    tableDesigner.visible = false;
    ElMessage.error(e?.msg || e?.message || '读取表结构失败');
  } finally {
    tableDesigner.loading = false;
  }
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
  const action=payload.action;const node={...payload.node};
  // 所有确认框和后续请求固定发起连接/方言；切页签不能把清空 A 改成清空 B。
  const actionConnection=activeConnection.value?{...activeConnection.value}:null;
  const actionDialect=resolveSqlDialect(actionConnection?.dbType);
  const actionInstances=instanceOptions.value.slice();
  const actionTabs=tabs.value.slice();
  const instanceName = node.instanceName || '';
  const tableName = node.name || node.tableName || '';

  switch (action) {
    case 'refreshInstance':
      if (!instanceName) {
        ElMessage.warning(`请先选择${instanceLabel.value}`);
        return;
      }
      try {
        await objectTreeRef.value?.reloadInstance?.(instanceName, node.schemaName);
        ElMessage.success(`已刷新 ${instanceName}`);
      } catch (e: any) {
        ElMessage.error(e?.msg || e?.message || '刷新失败');
      }
      return;
    case 'refreshTree':
      await refreshBrowseObjects(undefined, { silent: false });
      return;
    case 'refreshTables':
      if (!instanceName) {
        ElMessage.warning(`请先选择${instanceLabel.value}`);
        return;
      }
      if (await objectTreeRef.value?.reloadTables?.(instanceName, node.schemaName)) {
        ElMessage.success('已刷新 Tables');
      }
      return;
    case 'importData':
      if (!actionConnection) {
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
    case 'exportInstanceSql':
      await startInstanceBackup(instanceName);
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
      if (!actionConnection) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      createDbDialog.connectInstance =
        instanceName ||
        activeTab.value?.instanceName ||
        actionConnection.schemaName ||
        actionInstances[0] ||
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
        if (!actionConnection) {
          ElMessage.warning('请先打开数据库连接');
          return;
        }
        const dropSql = actionDialect.dropDatabaseSql(instanceName);
        if (!dropSql || dropSql.trim().startsWith('--')) {
          ElMessage.warning(dropSql?.trim() || '当前数据库类型不支持在此删除实例');
          return;
        }
        const otherInst =
          (actionConnection.schemaName &&
          actionConnection.schemaName !== instanceName
            ? actionConnection.schemaName
            : '') ||
          actionInstances.find((n) => n !== instanceName) ||
          '';
        if (!otherInst) {
          ElMessage.warning(
            `请先确保连接上还有其它${instanceLabel.value}可切换，再删除「${instanceName}」`,
          );
          return;
        }
        const res: any = await executeDdl({
          dbConfigId: actionConnection.id,
          instanceName: otherInst,
          sql: dropSql,
        });
        const data = res?.data || res;
        ElMessage.success(data?.message || `已删除 ${instanceName}`);
        // 清理所有仍指向已删实例的查询 Tab
        for (const t of actionTabs) {
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
      if (!actionConnection) {
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
      if (!actionConnection) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      tableDesigner.mode = 'create';
      tableDesigner.executionError = '';
      tableDesigner.instanceName = instanceName;
      tableDesigner.schemaName = node.schemaName || '';
      tableDesigner.tableName = 'new_table';
      tableDesigner.info = null;
      tableDesigner.visible = true;
      return;
    case 'dropTable':
      if (!actionConnection) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      try {
        await ElMessageBox.confirm(
          `确认删除表 ${instanceName}.${tableName}？此操作不可恢复。`,
          '删除表',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
        );
        const ident = resolveTableIdent(actionConnection.dbType, {
          instanceName,
          schemaName: node.schemaName,
          tableName,
        });
        const dropSql = actionDialect.dropTableSql(ident.schema, ident.table);
        const res: any = await executeDdl({
          dbConfigId: actionConnection.id,
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
      if (!actionConnection) {
        ElMessage.warning('请先打开数据库连接');
        return;
      }
      try {
        const ident = resolveTableIdent(actionConnection.dbType, {
          instanceName,
          schemaName: node.schemaName,
          tableName,
        });
        const truncateSql = actionDialect.truncateTableSql(
          ident.schema,
          ident.table,
        );
        const viaDml = !!actionDialect.truncateViaDml;
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
              dbConfigId: actionConnection.id,
              instanceName,
              sql: truncateSql,
            })
          : await executeDdl({
              dbConfigId: actionConnection.id,
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
      await openAlterTableDesigner({
        instanceName,
        tableName,
        schemaName: node.schemaName || '',
      });
      return;
    case 'copyDdl': {
      try {
        const res: any = await getTableDDL(
          actionConnection?.id,
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
      sqlDump.background = false;
      sqlDump.instanceName = instanceName;
      // 必须带限定名。只用裸表名时，PG/Oracle 会导出到默认 schema 里的同名空表，文件里就只剩结构。
      sqlDump.preselectedTables = tableName
        ? [node.qualifiedName || node.name || tableName]
        : [];
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
        const tab = actionTabs.find(
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
        const tab = actionTabs.find(
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
  if (!activeConnection.value || tableDesigner.saving || tableDesigner.executionError || result.errors.length) return;
  // 固定整个 DDL 计划的连接，避免异步执行期间切换连接后把后续语句发到其他主机。
  const connectionId = activeConnection.value.id;
  tableDesigner.saving = true;
  let completedStatements = 0;
  try {
    for (const sql of result.statements) {
      await executeDdl({
        dbConfigId: connectionId,
        instanceName: tableDesigner.instanceName,
        permissionTableName:
          tableDesigner.mode === 'alter' ? tableDesigner.tableName : undefined,
        sql,
      });
      completedStatements++;
    }
    ElMessage.success(tableDesigner.mode === 'create' ? '表创建成功' : '表结构修改成功');
    tableDesigner.visible = false;
    objectTreeRef.value?.reloadTables?.(tableDesigner.instanceName);
  } catch (e: any) {
    const reason = e?.msg || e?.message || '保存表结构失败';
    if (completedStatements) {
      // 多条 DDL 在部分产品会隐式提交，不能把整个创建计划从头重放。
      tableDesigner.executionError = `已执行 ${completedStatements}/${result.statements.length} 条语句，后续执行失败：${reason}。请关闭弹窗，查看当前表结构后重新修改；已执行语句可能已提交。`;
      objectTreeRef.value?.reloadTables?.(tableDesigner.instanceName);
      ElMessage.error(tableDesigner.executionError);
    } else ElMessage.error(reason);
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

/** 整库备份进度框。最小化后任务仍在右上角后台任务里。 */
const backupDialog = reactive({
  visible: false,
  taskId: '',
});
const backupDownloading = ref(false);
let backupTimer: null | ReturnType<typeof setInterval> = null;

const backupTask = computed(() => {
  const id = backupDialog.taskId;
  if (!id) return null;
  return (
    runningTasks.value.find((task) => task.source === 'dbBackup' && task.id === id) ||
    doneTasks.value.find((task) => task.source === 'dbBackup' && task.id === id) ||
    null
  );
});

function stopBackupPoll() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

async function pollBackupTask() {
  if (!backupDialog.taskId) return;
  try {
    const res: any = await getDbBackupTask(backupDialog.taskId, false);
    const raw = res?.data ?? res;
    if (raw?.taskId) applyDbBackup(raw);
  } catch {
    /* 轮询失败不打断进度框 */
  }
}

watch(
  () => backupDialog.visible,
  (open) => {
    stopBackupPoll();
    if (!open || !backupDialog.taskId) return;
    void pollBackupTask();
    backupTimer = setInterval(() => {
      void pollBackupTask();
    }, 1500);
  },
);

/** 库级导出也先配置表清单、执行引擎和文件选项。 @author yanch */
function startInstanceBackup(instanceName: string) {
  if (!activeConnection.value || !instanceName) {
    ElMessage.warning('请先选择数据库连接和数据库');
    return;
  }
  sqlDump.instanceName = instanceName;
  sqlDump.preselectedTables = [];
  sqlDump.background = true;
  sqlDump.visible = true;
}

/** 配置提交成功后接续原后台进度面板。 @author yanch */
function onConfiguredBackupStarted(task: import('#/api/visual/dbBackup').DbBackupTaskVO) {
  trackDbBackup(task);
  backupDialog.taskId = task.taskId;
  backupDialog.visible = true;
}

function minimizeBackup() {
  const status = backupTask.value?.status;
  const running = status === 'PENDING' || status === 'RUNNING';
  backupDialog.visible = false;
  openTaskPanel(running ? 'running' : 'done');
}

async function cancelBackupFromDialog() {
  if (!backupTask.value) return;
  try {
    await cancelClientTask(backupTask.value);
    ElMessage.success('已请求取消');
    await pollBackupTask();
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '取消失败');
  }
}

async function downloadBackupTask(task: { id: string; fileName?: string }) {
  if (!task?.id || backupDownloading.value) return;
  backupDownloading.value = true;
  try {
    const res: any = await downloadDbBackupFile(task.id);
    const blob = unwrapFileBlob(res);
    if (!blob) {
      ElMessage.error('下载失败：未收到文件');
      return;
    }
    const err = await readBlobErrorMessage(blob);
    if (err) {
      ElMessage.error(err);
      return;
    }
    await downloadBlobAsFile(blob, task.fileName || 'backup.sql');
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '下载失败');
  } finally {
    backupDownloading.value = false;
  }
}

/** 当前正在执行的自由 SQL（用于停止） */
/** 每个查询页签拥有独立的取消句柄，多标签并行执行不会互相覆盖。 */
const resultPanelRef = ref<InstanceType<typeof ResultPanel> | null>(null);
const sqlRuns = new Map<string, { requestId: string; abort: AbortController }>();

function newSqlRequestId() {
  return `sql-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 选区（或传入的整段 SQL）里是否包含多条可执行语句。
 * 无选区时 getExecutableSql 只会返回光标所在的一条，不会进这里。
 */
function shouldExecuteAsBatch(sql: string): boolean {
  if (listSqlStatements(sql).length > 1) return true;
  // Mongo 脚本常常不写分号，换行后的下一条 db./use 也算多条
  if (!isMongoDbType(activeConnection.value?.dbType)) return false;
  const commands = sql.match(/^(?:db\.|use\s*\(|use\s+)/gim);
  return (commands?.length || 0) > 1;
}

/** 多条里只要有写操作，就确认一次。结构变更不走数据写入的 30 天免确认。 */
async function confirmSqlBatch(sql: string): Promise<boolean> {
  const mongo = isMongoDbType(activeConnection.value?.dbType);
  const parts = mongo ? sql.split(/;|\n/).map((s) => s.trim()).filter(Boolean) : listSqlStatements(sql);
  const writes = parts.filter((part) => {
    if (mongo) {
      const kind = mongoCommandKind(part);
      return kind === 'data' || kind === 'schema' || kind === 'manage';
    }
    return isWriteOrDangerousSql(part) || looksLikeControlledDdl(part) || isPreparedScriptSql(part);
  });
  if (!writes.length) return true;
  const sample = writes.find((part) => !canMuteSqlWriteConfirm(part)) || writes[0]!;
  return confirmSqlWrite(sample, {
    title: '执行多条 SQL',
    message: `即将按顺序执行 ${parts.length} 条语句，其中 ${writes.length} 条会修改数据或结构。这些语句共用一个数据库会话，前面 SET 的变量后面仍然能用。某一条失败后会停止，此前已成功的语句不会自动回滚。确认继续？`,
  });
}

/** 把后台分步结果转成结果区能直接渲染的条目 */
function mapBatchResultSet(item: any, index: number): QueryResultSet {
  const columns = item?.columns || [];
  const rows = markRaw(item?.rows || []);
  return {
    sourceInstanceName: item?.sourceInstanceName,
    readOnlyReason: item?.readOnlyReason,
    sourceConnectionFingerprint: item?.sourceConnectionFingerprint,
    index: item?.index ?? index + 1,
    sql: String(item?.sql || ''),
    kind: item?.kind,
    success: item?.success !== false && !item?.error,
    columns,
    columnTables: item?.columnTables || [],
    columnMetadata: item?.columnMetadata || [],
    rows,
    rowCount: item?.rowCount ?? rows.length ?? 0,
    affectedRows: item?.affectedRows,
    elapsedMs: item?.elapsedMs,
    message: item?.message,
    error: item?.error,
    truncated: item?.truncated === true,
  };
}

/** 聚焦某一条分步结果，导出、表格编辑和主键解析都跟着这条 SQL */
function onFocusResultSet(index: number) {
  const tab = activeTab.value;
  if (!tab?.result || tab.executing) return;
  tab.result = focusBatchResult(tab.result, index);
}

/** 重跑整个查询前也保护其它分步结果的草稿；刷新单条结果则保留其它结果。 */
async function confirmReplaceBatchDrafts(tab: typeof activeTab.value) {
  const current = tab?.result;
  if (!current) return true;
  const hidden = allResultStates(current).filter((result) => result !== current);
  if (hidden.some(isResultSaving)) { ElMessage.warning('其它分步结果正在保存，请等待完成'); return false; }
  if (!hidden.some(hasResultDraft)) return true;
  try {
    await ElMessageBox.confirm('重新执行将丢弃其它分步结果中的未保存修改，是否继续？', '未保存的分步结果', { type: 'warning', confirmButtonText: '丢弃并继续', cancelButtonText: '取消' });
    if (tab?.result !== current) return false;
    hidden.forEach((result) => putResultDraft(result, null)); return true;
  } catch { return false; }
}

/**
 * 选中多条 SQL：后台逐条执行，前台把每条结果都铺开展示。
 * 查询显示表格，DML/DDL 显示影响行数；失败的那条停在结果列表里。
 */
async function runSqlBatch(sql: string, source: string) {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  if (!(await confirmReplaceBatchDrafts(tab)) || activeTab.value !== tab) return;
  const instanceName = tab.instanceName;
  if (!(await confirmSqlBatch(sql))) return;
  if (tab.executing || closingQueryTabs.has(tab.id)) return;
  const requestId = newSqlRequestId();
  const abort = new AbortController();
  sqlRuns.set(tab.id, { requestId, abort });
  tab.executing = true;
  tab.resultVisible = true;
  tab.resultTab = 'result';
  if (resultHeight.value < 280) resultHeight.value = 360;
  const t0 = performance.now();
  try {
    const res: any = await executeSqlBatch(
      {
        dbConfigId: conn.id,
        instanceName,
        sql,
        maxRows: visualClientConfig.defaultQueryMaxRows,
        requestId,
        source,
      },
      { signal: abort.signal },
    );
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    const sets = (data?.items || []).map(mapBatchResultSet);
    if (!sets.length) {
      throw new Error(data?.message || '没有返回执行结果');
    }
    const preferred = sets.findIndex((set: QueryResultSet) => set.columns.length > 0);
    const activeSet = preferred >= 0 ? preferred : 0;
    const current = sets[activeSet]!;
    tab.result = {
      columns: current.columns,
      columnTables: current.columnTables,
      columnMetadata: current.columnMetadata,
      readOnlyReason: current.readOnlyReason,
      sourceConnectionFingerprint: current.sourceConnectionFingerprint,
      rows: current.rows,
      rowCount: current.rowCount,
      elapsedMs: data?.elapsedMs ?? current.elapsedMs,
      clientElapsedMs,
      message: data?.message || current.message,
      error: sets.length > 1 ? undefined : current.error,
      sourceSql: current.sql,
      sourceInstanceName: current.sourceInstanceName || instanceName,
      sets: sets.length > 1 ? sets : undefined,
      activeSet: sets.length > 1 ? activeSet : undefined,
    };
    tab.resultTab = current.columns.length || sets.length > 1 ? 'result' : 'messages';
    if (sets.length === 1 && current.error) {
      tab.result.error = current.error;
      tab.result.message = current.error;
      tab.resultTab = 'messages';
    }
    const summary = String(data?.message || '');
    if (data?.stopped || sets.some((set: QueryResultSet) => !set.success)) {
      ElMessage.warning(summary || '分步执行未全部完成');
    } else if (sets.some((set: QueryResultSet) => set.kind && set.kind !== 'query')) {
      ElMessage.success(summary || `已执行 ${sets.length} 条 SQL`);
    }
    const ddl = [...sets].reverse().find((set: QueryResultSet) => set.success && set.kind === 'ddl');
    if (ddl) {
      if (isMongoDbType(conn?.dbType)) {
        objectTreeRef.value?.reload?.();
      } else {
        refreshObjectTreeAfterDdl(ddl.sql, tab.instanceName || '');
      }
    }
    const feedbackSql = sets.find((set: QueryResultSet) => set.success && set.kind === 'query')?.sql;
    if (feedbackSql) void feedbackSchemaDocSilent(feedbackSql);
    const batchOk = !data?.stopped && !sets.some((set: QueryResultSet) => !set.success);
    recordExecutedSql(sql, batchOk, conn, instanceName);
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const cancelled = abort.signal.aborted || /查询已取消|canceled|cancelled/i.test(String(e?.msg || e?.message || ''));
    const errText = cancelled ? '查询已取消' : pickErrorMsg(e, '执行失败');
    if (!cancelled) recordExecutedSql(sql, false, conn, instanceName);
    tab.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      clientElapsedMs,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'messages';
  } finally {
    if (sqlRuns.get(tab.id)?.requestId === requestId) sqlRuns.delete(tab.id);
    tab.executing = false;
  }
}

/** 执行当前光标所在语句（或选中片段）；不重置用户已调好的结果区高度 */
async function runSql(opts?: { sql?: string; source?: string }) {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  if (!(await confirmReplaceBatchDrafts(tab)) || activeTab.value !== tab) return;
  const instanceName = tab.instanceName;
  if (tab.executing) {
    ElMessage.warning('当前查询正在执行，请先停止或等待完成');
    return;
  }
  if (!tab.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  let sql =
    opts?.sql?.trim() ||
    sqlEditorRef.value?.getExecutableSql?.()?.trim() ||
    tab.sql?.trim() ||
    '';
  if (!sql) {
    ElMessage.warning('请输入 SQL，或将光标放到要执行的语句上');
    return;
  }
  if (resultPanelRef.value && !(await resultPanelRef.value.confirmLeaveSheet('重新执行查询'))) return;
  if (activeTab.value !== tab) return;
  if (tab.executing || closingQueryTabs.has(tab.id)) return;
  const source = opts?.source || 'manual';
  // 没框选时，光标落在 SET @变量 或 PREPARE 上要带上前后依赖的语句。
  // 用户自己选中一段时按选区执行，不把选区外面的 SQL 加进来。
  if (
    !opts?.sql?.trim()
    && !sqlEditorRef.value?.hasUserSelection?.()
    && !isMongoDbType(conn.dbType)
  ) {
    const fullText = sqlEditorRef.value?.getValue?.() || tab.sql || sql;
    sql = expandSessionChain(fullText, sql, sqlEditorRef.value?.getCursorOffset?.());
  }

  // 多条语句，或单独的 SET / PREPARE，都走分步执行。分步执行共用一个连接，变量才不会丢。
  if (shouldExecuteAsBatch(sql) || (!isMongoDbType(conn.dbType) && isEditorSessionSql(sql))) {
    await runSqlBatch(sql, source);
    return;
  }

  if (isMongoDbType(conn.dbType)) {
    const kind = mongoCommandKind(sql);
    if (kind === 'unknown') {
      ElMessage.warning('无法识别 MongoDB 命令，请使用 db.collection.find/aggregate/insert/update/delete 等 mongosh 语法');
      return;
    }
    if (kind === 'session') {
      ElMessage.warning('use() 只对同一次选中的脚本生效。请把 use() 和后面的命令一起选中执行；单独执行不会改变左侧当前库');
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

  if (closingQueryTabs.has(tab.id)) return;
  const requestId = newSqlRequestId();
  const abort = new AbortController();
  sqlRuns.set(tab.id, { requestId, abort });
  tab.executing = true;
  tab.resultVisible = true;
  tab.resultTab = 'result';
  if (resultHeight.value < 160) resultHeight.value = 220;
  const t0 = performance.now();
  try {
    const res: any = await executeSql(
      {
        dbConfigId: conn.id,
        instanceName,
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
    tab.result = {
      columns: data.columns || [],
      columnTables: data.columnTables || [],
      columnMetadata: data.columnMetadata || [],
      sourceConnectionFingerprint: data.sourceConnectionFingerprint,
      rows: markRaw(data.rows || []),
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      clientElapsedMs,
      message: data.message,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'result';
    void feedbackSchemaDocSilent(sql, conn, instanceName);
    recordExecutedSql(sql, true, conn, instanceName);
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    if (abort.signal.aborted || /查询已取消|canceled|cancelled/i.test(String(e?.msg || e?.message || ''))) {
      tab.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: '查询已取消',
        message: '查询已取消',
        clientElapsedMs,
        sourceSql: sql,
      sourceInstanceName: instanceName,
      };
      tab.resultTab = 'messages';
    } else {
      // 业务失败（含 SQL 语法错误）写入 Messages，避免只弹 toast / 空白结果
      const errText = pickErrorMsg(e, '执行失败');
      tab.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errText,
        message: errText,
        clientElapsedMs,
        sourceSql: sql,
      sourceInstanceName: instanceName,
      };
      tab.resultTab = 'messages';
      recordExecutedSql(sql, false, conn, instanceName);
    }
  } finally {
    if (sqlRuns.get(tab.id)?.requestId === requestId) sqlRuns.delete(tab.id);
    tab.executing = false;
  }
}

/** 执行成功后把 JOIN 反馈给 Schema 文档（失败静默） */
function feedbackSchemaDocSilent(sql: string, conn = activeConnection.value, inst = activeTab.value?.instanceName) {
  if (!conn?.id || !inst || !sql) return;
  feedbackSchemaDoc({
    dbConfigId: conn.id,
    instanceName: inst,
    sql,
  }).catch(() => {});
}

/** 受控 DDL / CALL：DROP、TRUNCATE、REVOKE、FLUSH PRIVILEGES 需要确认；AI 入口一律确认 */
async function runControlledDdl(
  sql: string,
  opts?: { skipConfirm?: boolean; forceConfirm?: boolean },
) {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  const instanceName = tab.instanceName;
  if (!opts?.skipConfirm && (opts?.forceConfirm || isDestructiveDdl(sql) || isFlushPrivileges(sql))) {
    const head = String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    const tip = /^\s*TRUNCATE\b/i.test(head)
      ? '即将执行 TRUNCATE 清空表，确认继续？'
      : /^\s*REVOKE\b/i.test(head)
        ? '即将执行 REVOKE 收回权限，确认继续？'
        : isFlushPrivileges(sql)
          ? '即将执行 FLUSH PRIVILEGES，重新加载服务器权限缓存，确认继续？'
          : isDestructiveDdl(sql)
            ? '即将执行删除类 DDL（DROP），确认继续？'
            : describeSqlWriteRisk(sql);
    if (!(await confirmSqlWrite(sql, { message: tip }))) return;
  }
  if (tab.executing || closingQueryTabs.has(tab.id)) return;
  tab.executing = true;
  tab.resultVisible = true;
  const t0 = performance.now();
  try {
    const res: any = await executeDdl({
      dbConfigId: conn.id,
      instanceName,
      sql,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    const msg =
      data?.message ||
      `DDL/CALL OK${data?.affectedRows != null ? `, ${data.affectedRows} row(s)` : ''}`;
    tab.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: data?.elapsedMs,
      clientElapsedMs,
      message: msg,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'messages';
    ElMessage.success(msg);
    recordExecutedSql(sql, true, conn, instanceName);
    if (isMongoDbType(conn?.dbType)) {
      objectTreeRef.value?.reload?.();
    } else {
      refreshObjectTreeAfterDdl(sql, tab.instanceName || '');
    }
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, '执行 DDL 失败');
    recordExecutedSql(sql, false, conn, instanceName);
    tab.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      clientElapsedMs,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'messages';
  } finally {
    tab.executing = false;
  }
}

/**
 * 自由 DML（INSERT/UPDATE/DELETE/REPLACE/MERGE）：确认后走 executeDml
 * （只读 executeSql 会直接拒绝写语句）
 */
async function runFreeDml(sql: string, _source?: string, opts?: { skipConfirm?: boolean }) {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  const instanceName = tab.instanceName;
  if (!opts?.skipConfirm) {
    if (!(await confirmSqlWrite(sql))) return;
  }
  if (tab.executing || closingQueryTabs.has(tab.id)) return;
  tab.executing = true;
  tab.resultVisible = true;
  const t0 = performance.now();
  try {
    const res: any = await executeDml({
      dbConfigId: conn.id,
      instanceName,
      sql,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    const msg =
      data?.message ||
      `DML OK, ${data?.affectedRows ?? '?'} row(s) affected`;
    tab.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: data?.elapsedMs,
      clientElapsedMs,
      message: msg,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'messages';
    ElMessage.success(msg);
    recordExecutedSql(sql, true, conn, instanceName);
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, 'DML 执行失败');
    recordExecutedSql(sql, false, conn, instanceName);
    tab.result = {
      columns: [],
      rows: [],
      rowCount: 0,
      error: errText,
      message: errText,
      clientElapsedMs,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'messages';
  } finally {
    tab.executing = false;
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
  const run = sqlRuns.get(activeTab.value.id);
  if (!run) { ElMessage.info('该操作暂不支持取消，请等待执行完成'); return; }
  const { requestId, abort } = run;
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

/** 当前连接是否支持可视化执行计划 / EXPLAIN ANALYZE */
const explainSupported = computed(() =>
  supportsExplain(activeConnection.value?.dbType),
);
const explainAnalyzeSupported = computed(() =>
  supportsExplainAnalyze(activeConnection.value?.dbType),
);
const activeConnectionProd = computed(
  () => !!activeConnection.value && isProductionConnection(activeConnection.value),
);
const activeConnectionAiEnabled = computed(
  () => !!activeConnection.value && Number(activeConnection.value.aiEnabled) !== 0,
);

/** 生产环境 EXPLAIN ANALYZE 二次确认（会真实执行查询） */
async function confirmProdAnalyze(message?: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      message ||
        '当前是生产环境连接，EXPLAIN ANALYZE 会真实执行查询，需要确认后才能继续',
      '生产环境 ANALYZE 确认',
      {
        type: 'warning',
        confirmButtonText: '确认执行 ANALYZE',
        cancelButtonText: '取消',
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 查看执行计划（Ctrl+Shift+E / 工具栏「执行计划」）：
 * - 普通 EXPLAIN 只生成计划、不执行语句；
 * - ANALYZE 仅限只读 SELECT，生产环境先确认（后端同样校验，可配置为禁止）；
 * - 复用 requestId / AbortController，执行中可点「停止」取消。
 */
async function runExplain(opts?: {
  analyze?: boolean;
  confirmProd?: boolean;
  sql?: string;
}) {
  const conn = activeConnection.value;
  const tab = activeTab.value;
  if (!conn || !tab) return;
  if (tab.executing) {
    ElMessage.warning('当前查询正在执行，请先停止或等待完成');
    return;
  }
  if (!supportsExplain(conn.dbType)) {
    ElMessage.warning('当前数据库类型不支持可视化执行计划');
    return;
  }
  if (!tab.instanceName) {
    ElMessage.warning(`请先选择${instanceLabel.value}实例`);
    return;
  }
  const sql =
    opts?.sql?.trim() ||
    sqlEditorRef.value?.getExecutableSql?.()?.trim() ||
    tab.sql?.trim() ||
    '';
  if (!sql) {
    ElMessage.warning('请选中 SELECT 语句，或将光标放到要分析的语句上');
    return;
  }
  if (shouldExecuteAsBatch(sql)) {
    ElMessage.warning('执行计划一次只能分析一条语句，请只选中一条');
    return;
  }
  const analyze = !!opts?.analyze && supportsExplainAnalyze(conn.dbType);
  let confirmProd = !!opts?.confirmProd;
  if (analyze && !confirmProd && isProductionConnection(conn)) {
    if (!(await confirmProdAnalyze())) return;
    confirmProd = true;
  }

  if (closingQueryTabs.has(tab.id)) return;
  const requestId = newSqlRequestId();
  const abort = new AbortController();
  sqlRuns.set(tab.id, { requestId, abort });
  tab.executing = true;
  tab.plan = { sql, loading: true, analyze, result: null };
  tab.resultVisible = true;
  tab.resultTab = 'plan';
  if (resultHeight.value < 280) resultHeight.value = 360;
  let confirmMessage: null | string = null;
  try {
    const res: any = await explainPlan(
      {
        dbConfigId: conn.id,
        instanceName: tab.instanceName,
        sql,
        analyze,
        confirmProd,
        requestId,
        source: analyze ? 'explain_analyze' : 'explain',
      },
      { signal: abort.signal },
    );
    const data = (res?.data ?? res) as ExplainPlanResult | null;
    if (!data) throw new Error('没有返回执行计划');
    if (data.requireProdConfirm && !confirmProd) {
      // 前端未识别为生产，但后端按环境标签判定需要确认
      confirmMessage = data.message || '';
      tab.plan = { sql, loading: false, analyze, result: null };
    } else {
      tab.plan = { sql, loading: false, analyze, result: data };
    }
  } catch (e: any) {
    const cancelled =
      abort.signal.aborted ||
      /查询已取消|canceled|cancelled/i.test(String(e?.msg || e?.message || ''));
    tab.plan = {
      sql,
      loading: false,
      analyze,
      result: null,
      error: cancelled ? '查询已取消' : pickErrorMsg(e, '获取执行计划失败'),
    };
  } finally {
    if (sqlRuns.get(tab.id)?.requestId === requestId) sqlRuns.delete(tab.id);
    tab.executing = false;
  }
  if (confirmMessage != null && activeTab.value === tab && activeConnection.value?.id === conn.id) {
    if (await confirmProdAnalyze(confirmMessage || undefined)) {
      await runExplain({ analyze: true, confirmProd: true, sql });
    } else if (tab.plan) {
      tab.plan.error = '已取消生产环境 ANALYZE';
    }
  }
}

/** 执行计划页签「让 AI 优化」：把 SQL + 计划摘要预填到 AI 助手 */
function onAskAiOptimizePlan() {
  const plan = activeTab.value?.plan;
  if (!plan?.result || !ensureAiReady()) return;
  openAiAssistant({
    scene: 'sql',
    prefill: buildAiOptimizePrompt(plan.sql, plan.result),
    context: { selectedSql: plan.sql, editorSql: activeTab.value?.sql || plan.sql },
  });
}

/** 从 axios / 业务 reject 对象中取出可读错误文案 */
function pickErrorMsg(e: any, fallback: string) {
  return humanizeApiError(e, fallback);
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
 * 导出当前结果对应 SQL：后台按原始 SQL 重新执行后下载 xlsx。
 * 不传行数上限。SQL 自己写了 LIMIT/TOP 就导出那么多，没写就导出全部结果，不受页面预览 200 行影响。
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
      }),
    `SQL导出_${Date.now()}.xlsx`,
    '导出成功',
  );
}

/**
 * 导出当前结果为 INSERT .sql：后台按原始 SQL 重查后按库方言拼装。
 * 行数规则与导出 Excel 相同，不套页面预览或 5 万行上限。
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
      }),
    `${schemaPart}${tableRef.table}_insert_${Date.now()}.sql`.replace(
      /[\\/:*?"<>|]/g,
      '_',
    ),
    'SQL 导出成功',
  );
}

/**
 * 表右键：按不带行数限制的 SELECT *（MongoDB 为 find）导出整表 Excel
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

/** 按库方言拼不限行数的整表查询，供表右键导出使用 */
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
  if (isMongoDbType(dbType)) {
    return `db.getCollection(${JSON.stringify(ident.table)}).find({});`;
  }
  return `SELECT * FROM ${d.qualifyTable(ident.schema, ident.table)}`;
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


/** 补全：统一通过 API 的 IndexedDB 缓存读取字段和主键。 */
async function loadEditorColumns(instanceName: string, tableName: string) {
  const conn = activeConnection.value;
  if (!conn) return { columns: [] as string[], primaryKeys: [] as string[] };
  const res: any = await getTableColumns(conn.id, instanceName, tableName);
  const list = res?.data || res || [];
  const arr = Array.isArray(list) ? list : [];
  const columns = arr.map((c: any) => c.fieldName).filter(Boolean);
  const primaryKeys = primaryKeysFromColumns(arr);
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
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  const instanceName = tab.instanceName || conn.schemaName || '';
  const name = opts.queryName.trim();
  if (!name) {
    ElMessage.warning('请输入查询名称');
    return false;
  }
  if (saveDialog.saving) return false;

  const schemaName = tab.schemaName;
  const sqlText = tab.sql;
  saveDialog.saving = true;
  try {
    let doUpdate = false;
    if (opts.preferUpdate && tab.savedQueryId != null) {
      doUpdate = await checkSavedQueryMineExists(tab.savedQueryId);
      if (!doUpdate) {
        // 库中已无此记录：清空关联，按新建处理，名称不变
        tab.savedQueryId = undefined;
      }
    }

    if (doUpdate && tab.savedQueryId != null) {
      await editSavedQuery({
        id: tab.savedQueryId,
        queryName: name,
        sqlText,
        dbConfigId: conn.id,
        instanceName,
        schemaName,
      });
      tab.title = name;
      markTabSaved(tab, sqlText);
      ElMessage.success('已更新保存');
    } else {
      const res: any = await addSavedQuery({
        queryName: name,
        sqlText,
        dbConfigId: conn.id,
        instanceName,
        schemaName,
      });
      const data = res?.data || res;
      tab.savedQueryId = data?.id;
      tab.title = name;
      markTabSaved(tab, sqlText);
      ElMessage.success('已保存');
    }
    if (activeConnection.value?.id === conn.id) objectTreeRef.value?.reloadQueries?.(instanceName);
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
async function executeRowDml(sql: string, conn = activeConnection.value, instanceName = activeTab.value?.result?.sourceInstanceName || activeTab.value?.instanceName || activeConnection.value?.schemaName, fingerprint?: string) {
  if (!conn) {
    throw new Error('无可用连接');
  }
  const res: any = await executeDml({
    dbConfigId: conn.id,
    instanceName,
    sql,
    source: 'result-grid',
    requireSingleRow: true,
    sourceConnectionFingerprint: fingerprint,
  });
  return res?.data || res;
}

async function executeRowDmlBatch(sqls: string[], conn = activeConnection.value, instanceName = activeTab.value?.result?.sourceInstanceName || activeTab.value?.instanceName || activeConnection.value?.schemaName, parameters?: ResultEditParameter[][], fingerprint?: string) {
  if (!conn) {
    throw new Error('无可用连接');
  }
  const res: any = await executeDmlBatch({
    dbConfigId: conn.id,
    instanceName,
    sqls,
    parameters,
    source: 'result-grid',
    requireSingleRow: true,
    sourceConnectionFingerprint: fingerprint,
  });
  return res?.data || res;
}

/** 给结果组件的函数捕获该次渲染的目标，异步逐行操作不能跟随当前连接切换。 */
const resultRowDml = computed(() => {
  const tab = activeTab.value;
  const conn = activeConnection.value;
  const instance = activeTab.value?.result?.sourceInstanceName || activeTab.value?.instanceName || conn?.schemaName;
  const fingerprint=tab?.result?.sourceConnectionFingerprint;
  return (sql: string) => {
    if (tab && closingQueryTabs.has(tab.id)) throw new Error('页签正在关闭，不能开始写入');
    return executeRowDml(sql, conn, instance, fingerprint);
  };
});
const resultRowDmlBatch = computed(() => {
  const tab = activeTab.value;
  const conn = activeConnection.value;
  const instance = activeTab.value?.result?.sourceInstanceName || activeTab.value?.instanceName || conn?.schemaName;
  const fingerprint=tab?.result?.sourceConnectionFingerprint;
  return (sqls: string[], parameters?: ResultEditParameter[][]) => {
    if (tab && closingQueryTabs.has(tab.id)) throw new Error('页签正在关闭，不能开始写入');
    return executeRowDmlBatch(sqls, conn, instance, parameters, fingerprint);
  };
});

/** 表格编辑全部保存成功后，按原 SELECT 重查 */
async function onRefreshResult() {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;
  const previous = tab.result;
  const sourceSql = tab.result?.sourceSql?.trim();
  if (!sourceSql) return;
  if (closingQueryTabs.has(tab.id)) return;
  if (resultPanelRef.value && !(await resultPanelRef.value.confirmLeaveSheet('刷新结果'))) return;
  if (activeTab.value !== tab) return;
  tab.executing = true;
  try {
    await refreshQueryResult(sourceSql, conn, tab);
    if (previous?.sets && tab.result) {
      // 只刷新聚焦的语句，其它分步结果与编辑草稿保持原身份。
      const sets = previous.sets.slice(); const index = previous.activeSet ?? 0;
      const old = sets[index];
      if (old) sets[index] = { ...old, columns: tab.result.columns, columnTables: tab.result.columnTables,
        columnMetadata: tab.result.columnMetadata, rows: tab.result.rows, rowCount: tab.result.rowCount,
        elapsedMs: tab.result.elapsedMs, message: tab.result.message, error: tab.result.error };
      tab.result.sets = sets; tab.result.activeSet = index;
    }
  } finally {
    tab.executing = false;
  }
}

/**
 * 结果行右键：修改 / 删除 触发的 DML
 * 成功后自动重新执行原查询以刷新结果。
 */
async function onRunDml(dmlSql: string) {
  if (!activeConnection.value || !activeTab.value) return;
  const conn = { ...activeConnection.value };
  const tab = activeTab.value;

  tab.executing = true;
  try {
    const res: any = await (isMongoDbType(conn.dbType) ? executeDml({
      dbConfigId: conn.id,
      // 切库用当前对象树实例，不能把 FROM schema.table 的 schema 当成库名
      instanceName:
        tab.result?.sourceInstanceName || tab.instanceName || conn.schemaName,
      sql: dmlSql,
      source: 'result-grid',requireSingleRow:true,sourceConnectionFingerprint:tab.result?.sourceConnectionFingerprint,
    }) : executeDmlBatch({ dbConfigId: conn.id, instanceName: tab.result?.sourceInstanceName || tab.instanceName || conn.schemaName, sqls: [dmlSql], requireSingleRow: true, source: 'result-grid',sourceConnectionFingerprint:tab.result?.sourceConnectionFingerprint }));
    const data = res?.data || res;
    ElMessage.success(data?.message || '执行成功');
    // 用产生结果的原 SELECT 刷新，避免覆盖用户正在编辑的 SQL
    const sourceSql = tab.result?.sourceSql?.trim();
    if (sourceSql) {
      await refreshQueryResult(sourceSql, conn, tab);
    } else if (tab.result) {
      tab.result.message =
        data?.message ||
        `DML OK, ${data?.affectedRows ?? '?'} row(s) affected`;
      tab.result.error = undefined;
      tab.resultTab = 'messages';
    }
  } catch (e: any) {
    const errText = pickErrorMsg(e, 'DML 执行失败');
    ElMessage.error(errText);
    if (tab.result) {
      tab.result.error = errText;
      tab.resultTab = 'messages';
    }
  } finally {
    tab.executing = false;
  }
}

/** 按指定 SQL 刷新结果区（不改动编辑器内容） */
async function refreshQueryResult(sql: string, conn = activeConnection.value, tab = activeTab.value) {
  if (!conn || !tab) return;
  const instanceName = tab.result?.sourceInstanceName || tab.instanceName;
  if (!tab.instanceName) return;
  const t0 = performance.now();
  try {
    const res: any = await executeSql({
      dbConfigId: conn.id,
      instanceName,
      sql,
      maxRows: visualClientConfig.defaultQueryMaxRows,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    tab.result = {
      columns: data.columns || [],
      columnTables: data.columnTables || [],
      columnMetadata: data.columnMetadata || [],
      sourceConnectionFingerprint: data.sourceConnectionFingerprint,
      rows: markRaw(data.rows || []),
      rowCount: data.rowCount || 0,
      elapsedMs: data.elapsedMs,
      clientElapsedMs,
      message: data.message,
      sourceSql: sql,
      sourceInstanceName: instanceName,
    };
    tab.resultTab = 'result';
  } catch (e: any) {
    const clientElapsedMs = Math.round(performance.now() - t0);
    const errText = pickErrorMsg(e, '刷新结果失败');
    if (tab.result) {
      tab.result.error = errText;
      tab.result.clientElapsedMs = clientElapsedMs;
      tab.resultTab = 'messages';
    } else {
      tab.result = {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errText,
        message: errText,
        clientElapsedMs,
        sourceSql: sql,
      sourceInstanceName: instanceName,
      };
      tab.resultTab = 'messages';
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
  window.addEventListener('keydown', onGlobalKeydown, true);
  // Electron「文件」菜单：与连接栏空白右键共用同一套导入/导出逻辑
  offDesktopSessionExport = window.lemonDesktop?.onExportTemporarySession?.(
    () => exportTemporarySession(),
  );
  offDesktopSessionImport = window.lemonDesktop?.onImportTemporarySession?.(
    () => connectionTabsRef.value?.openImportPicker(),
  );
});

function onGlobalKeydown(e: KeyboardEvent) {
  // Ctrl+Q：直接关闭当前查询页签。Ctrl+W 会关网页，Ctrl+Alt+W 会唤起微信。
  const isCloseQueryKey =
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    (e.code === 'KeyQ' || e.key.toLowerCase() === 'q');
  if (isCloseQueryKey) {
    if (!activeConnection.value || !activeTabId.value) return;
    // 捕获阶段先关掉，避免 Monaco 把 Ctrl+Q 吃掉后快捷键失效
    e.preventDefault();
    e.stopPropagation();
    closeActiveQueryTabNow();
    return;
  }
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

/**
 * AI 输入框 @ 补全的数据源：优先用对象树 / 编辑器已缓存的表清单，没有时拉一次并写入缓存。
 * 只在当前激活连接上生效，避免 AI 窗口拿到别的连接的表。
 */
async function getAiTableNames(
  dbConfigId: number | string,
  instanceName: string,
): Promise<string[]> {
  const conn = activeConnection.value;
  if (!conn || String(conn.id) !== String(dbConfigId) || !instanceName) return [];
  const cached = getRememberedTables(dbConfigId, instanceName);
  if (cached.length) return cached.map((t) => t.tableName);
  try {
    return await loadEditorTables(instanceName);
  } catch {
    return [];
  }
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

/** 连接页签右键：打开该库最近执行过的 SQL（仅前端缓存） */
function onShowExecutedSql(sessionId: number | string) {
  const conn = openConnections.value.find(
    (item) => String(item.sessionId) === String(sessionId),
  );
  if (!conn) return;
  executedSqlDrawer.dbConfigId = conn.id;
  executedSqlDrawer.connectionName = conn.dbName || '';
  executedSqlDrawer.visible = true;
}

/** 把用户在编辑器里执行的语句记到当前连接，最多 200 条 */
function recordExecutedSql(sql: string, success: boolean, conn = activeConnection.value, instanceName = activeTab.value?.instanceName) {
  const id = conn?.id;
  if (id == null || !String(sql || '').trim()) return;
  rememberExecutedSql({
    dbConfigId: id,
    instanceName:
      instanceName || conn?.schemaName || '',
    sql,
    success,
  });
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
  for (const { requestId, abort } of sqlRuns.values()) {
    void cancelSql({ requestId }).catch(() => {});
    abort.abort();
  }
  sqlRuns.clear();
  stopBackupPoll();
  unbindClientFontScope?.();
  window.removeEventListener('keydown', onGlobalKeydown, true);
  window.removeEventListener('beforeunload', protectWorkspaceUnload);
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
        @change-window="goChangeWindow"
        @submit-work-order="submitAsWorkOrder"
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
        @close-all="closeAllConnections"
        @close-others="closeOtherConnections"
        @refresh="refreshBrowseObjects"
        @open="onOpenConnection"
        @export-session="exportTemporarySession"
        @import-session="importTemporarySession"
        @save-workspace="openSaveWorkspace"
        @load-workspace="openLoadWorkspace"
        @export-connection-queries="exportConnectionQueries"
        @import-connection-queries="importConnectionQueries"
        @executed-sql="onShowExecutedSql"
      />
      <WorkspaceSnapshotDialog
        v-model="workspaceDialog.visible"
        :mode="workspaceDialog.mode"
        :persist-id="workspaceDialog.persistId"
        :persist-alias="workspaceDialog.persistAlias"
        :snapshot="workspaceDialog.snapshot"
        @saved="onWorkspaceSaved"
        @loaded="onWorkspaceLoaded"
        @unlinked="onWorkspaceUnlinked"
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
              :placeholder="$tr('搜索库/表/对象')"
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
              v-if="explainSupported"
              size="small"
              :disabled="activeTab?.executing"
              :title="$tr('查看选中/当前语句的执行计划，普通 EXPLAIN 不会执行语句')"
              @click="runExplain()"
            >
              {{ $tr('执行计划 (Ctrl+Shift+E)') }}
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
            <ChangeWindowBadge :connection="activeConnection" />
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
              :schema-name="activeTab.schemaName"
              :read-only="!!activeTab.executing"
              :load-columns="loadEditorColumns"
              :load-tables="loadEditorTables"
              @execute="runSql"
              @explain="runExplain()"
              @save="onSaveQuery"
              @close-tab="closeActiveQueryTabNow"
              @import-file="onImportSqlFile"
              @ask-ai="onAskAiFromEditor"
              @view-table-info="onViewTableInfoFromEditor"
              @alter-table="onAlterTableFromEditor"
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
              ref="resultPanelRef"
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
              :execute-row-dml="resultRowDml"
              :execute-row-dml-batch="resultRowDmlBatch"
              @run-dml="onRunDml"
              @refresh-result="onRefreshResult"
              @export-excel="onExportExcel"
              @export-sql="onExportSqlInsert"
              @ask-ai-fix="onAskAiFix"
              @focus-result-set="onFocusResultSet"
              :plan="activeTab.plan ?? null"
              :can-analyze="explainAnalyzeSupported"
              :prod="activeConnectionProd"
              :ai-enabled="activeConnectionAiEnabled"
              @explain-rerun="(o) => runExplain({ analyze: o.analyze, sql: activeTab?.plan?.sql })"
              @ask-ai-optimize="onAskAiOptimizePlan"
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
      :get-table-names="getAiTableNames"
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

    <ExecutedSqlDrawer
      v-model="executedSqlDrawer.visible"
      :db-config-id="executedSqlDrawer.dbConfigId"
      :connection-name="executedSqlDrawer.connectionName"
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
      :background="sqlDump.background"
      @started="onConfiguredBackupStarted"
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
      :execution-error="tableDesigner.executionError"
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
      @download="downloadBackupTask"
      @refresh="refreshClientTasks"
    />

    <DbBackupProgressPanel
      v-model="backupDialog.visible"
      :task="backupTask"
      :downloading="backupDownloading"
      @minimize="minimizeBackup"
      @cancel="cancelBackupFromDialog"
      @download="backupTask && downloadBackupTask(backupTask)"
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
