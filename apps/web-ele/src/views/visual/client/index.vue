<script lang="ts" setup>
/**
 * 数据库客户端主壳（SQLyog 风格）
 * - 顶栏：新建/打开连接、表分组、关系画布、智能 SQL
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

import { executeDdl, executeDml, executeSql, cancelSql, exportSqlExcel, exportSqlInsert, getInstances, getObjectScript, getTableColumns, getTableDDL, getTableInfo, getTables } from '#/api/visual/database';
import { feedbackSchemaDoc } from '#/api/ai/agent';
import {
  addSavedQuery,
  deleteSavedQuery,
  editSavedQuery,
} from '#/api/visual/savedQuery';
import { getDbConfigById } from '#/api/visual/vq';
import { Page } from '@vben/common-ui';

import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim } from '@element-plus/icons-vue';

import type { TreeCtxAction } from './components/object-tree/ObjectTreeContextMenu.vue';

import ClientToolbar from './components/ClientToolbar.vue';
import ConnectionDialog from './components/ConnectionDialog.vue';
import ConnectionTabs from './components/ConnectionTabs.vue';
import ObjectTree from './components/object-tree/ObjectTree.vue';
import QueryTabs from './components/query/QueryTabs.vue';
import ResultPanel from './components/query/ResultPanel.vue';
import SqlEditor from './components/query/SqlEditor.vue';
import SmartQueryDrawer from './components/SmartQueryDrawer.vue';
import SqlDumpDialog from './components/SqlDumpDialog.vue';
import CreateDatabaseDialog from './components/CreateDatabaseDialog.vue';
import CopyDatabaseDialog from './components/CopyDatabaseDialog.vue';
import CopyTaskProgressPanel from './components/CopyTaskProgressPanel.vue';
import SystemFunctionsDialog from './components/SystemFunctionsDialog.vue';
import TableInfoDialog from './components/TableInfoDialog.vue';
import ClientPreferencesDialog from './components/ClientPreferencesDialog.vue';
import LicenseDialog from './components/LicenseDialog.vue';
import AiChatWindow from './components/ai/AiChatWindow.vue';
import AiDockBar from './components/ai/AiDockBar.vue';
import SchemaDocDrawer from './components/ai/SchemaDocDrawer.vue';
import QueryHistoryDrawer from './components/ai/QueryHistoryDrawer.vue';
import { useClientPreferences } from './composables/useClientPreferences';
import { getLicenseStatus } from '#/api/visual/license';
import { useConnectionStore } from './composables/useConnectionStore';
import { useCopyTasks } from './composables/useCopyTasks';
import { setupClientSessionPersist } from './composables/useClientSessionPersist';
import { notifyClientSessionChange } from './composables/clientSessionNotify';
import {
  consumePendingSavedQueryOpen,
  peekPendingSavedQueryOpen,
} from './composables/usePendingSavedQuery';
import {
  applyQueryTabsSnapshot,
  getQueryTabsSnapshot,
  useQueryTabs,
} from './composables/useQueryTabs';
import { visualClientConfig } from './config';
import { resolveSqlDialect } from './dialect/sqlDialect';
import { formatSqlByDialect } from './utils/formatSql';
import { isDestructiveDdl, looksLikeControlledDdl } from './utils/controlledDdl';
import {
  describeSqlWriteRisk,
  isFreeDmlSql,
  isWriteOrDangerousSql,
} from './utils/sqlWriteGuard';
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
  tasks: copyTasks,
  activeTask: copyActiveTask,
  progressVisible: copyProgressVisible,
  runningCount: copyRunningCount,
  onTaskStarted,
  openTask: openCopyTask,
  hideProgress: hideCopyProgress,
  cancelActive: cancelCopyTask,
  refreshList: refreshCopyTasks,
} = useCopyTasks();

const {
  MAX_TABS,
  tabs,
  activeTabId,
  activeTab,
  addTab,
  closeTab,
  closeAllTabs,
  closeOtherTabs,
  openSqlInNewTab,
  markTabSaved,
} = useQueryTabs(() => activeConnectionId.value);

const { queryTabsPlacement, queryTabsLeftWidth, TABS_LEFT_MIN, TABS_LEFT_MAX } =
  useClientPreferences();

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'open'>('open');
const filterText = ref('');
/** 左侧对象树宽度 */
const leftWidth = ref(260);
/** 结果区高度（可拖拽调整）；查询成功后默认按编辑器:结果 = 2:1 设置 */
const resultHeight = ref(220);
const smartVisible = ref(false);
const systemFunctionsVisible = ref(false);
const preferencesVisible = ref(false);
const licenseVisible = ref(false);
const licenseForce = ref(false);
const licenseHint = ref('');
const licenseAllowed = ref(true);
const sqlEditorRef = ref<InstanceType<typeof SqlEditor>>();
const objectTreeRef = ref<InstanceType<typeof ObjectTree>>();
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

/** 创建库 / 创建表 / 执行脚本 等简易对话框（建库已拆到 CreateDatabaseDialog） */
const promptDialog = reactive({
  visible: false,
  title: '',
  mode: '' as TreeCtxAction | '',
  instanceName: '',
  input: '',
  sqlPreview: '',
});

/** 按方言族选项创建数据库 / Schema / 用户 */
const createDbDialog = reactive({
  visible: false,
  /** 执行 DDL 时连到的已有实例 */
  connectInstance: '',
});

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

function onAddQueryTab() {
  const t = addTab({
    instanceName:
      activeTab.value?.instanceName ||
      activeConnection.value?.schemaName ||
      instanceOptions.value[0],
  });
  if (!t) ElMessage.warning(`最多 ${MAX_TABS} 个查询`);
}

function onOpenSystemFunctions() {
  systemFunctionsVisible.value = true;
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
      pending.id,
    );
    if (!tab) {
      ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
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
  // 一级节点是 schema 的库（Oracle/达梦/H2）用真实 schema 限定，否则用库名
  const qualifyKey =
    d.instanceKind === 'schema'
      ? payload.schemaName || payload.instanceName
      : payload.instanceName;
  const sql = d.selectAllLimited(qualifyKey, payload.tableName, 200);
  const tab = openSqlInNewTab(sql, payload.tableName, payload.instanceName);
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
}) {
  if (!activeConnection.value) {
    ElMessage.warning('请先打开数据库连接');
    return;
  }
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
      ElMessage.info('功能预留，后续版本开放');
      return;
    case 'copyDbToHost': {
      copyDb.instanceName = instanceName;
      // 单表右键：预勾选该表；库/tables 文件夹：默认全选（对话框内加载后处理）
      copyDb.preselectedTables =
        node?.nodeType === 'table' ? [tableName].filter(Boolean) : [];
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
        '';
      if (!createDbDialog.connectInstance) {
        ElMessage.warning(`请先在对象树选中一个${instanceLabel.value}`);
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
        const dropSql = activeDialect.value.dropTableSql(instanceName, tableName);
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
 * 视图/过程/函数/触发器/事件：向后端按方言取脚本，格式化后打开编辑器。
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
  const objectName =
    action === 'create' ? undefined : node.name || node.objectName || undefined;
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
    let sql = String(data.sql || '').trim();
    if (!sql) {
      ElMessage.warning('未生成脚本');
      return;
    }
    // DELIMITER 脚本不宜被 sql-formatter 拆坏；其余尝试格式化
    const hasDelimiter = /^\s*DELIMITER\b/im.test(sql);
    if (!hasDelimiter) {
      try {
        sql = formatSqlByDialect(sql, activeConnection.value.dbType) || sql;
      } catch {
        // 保留后端原文
      }
    }
    openSqlInNewTab(
      sql,
      data.title || `${action} ${objectName || objectKind}`,
      instanceName,
    );
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '生成脚本失败');
  }
}

function confirmPromptDialog() {
  const mode = promptDialog.mode;
  const name = promptDialog.input.trim();
  const inst = promptDialog.instanceName;
  const d = activeDialect.value;

  if (mode === 'createTable') {
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

/** 建库成功：刷新对象树，并尽量切到新实例 */
function onDatabaseCreated(newInstanceName: string) {
  objectTreeRef.value?.reload?.();
  if (newInstanceName && activeTab.value) {
    activeTab.value.instanceName = newInstanceName;
  }
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
        maxRows: 1000,
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
    const tip = isDestructiveDdl(sql)
      ? '即将执行删除类 DDL（DROP），确认继续？'
      : describeSqlWriteRisk(sql);
    try {
      await ElMessageBox.confirm(tip, '写操作确认', {
        type: 'warning',
        confirmButtonText: '确认执行',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
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
    refreshObjectTreeAfterDdl(sql, activeTab.value.instanceName || '');
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
 * 自由 DML（INSERT/UPDATE/DELETE）：确认后走 executeDml
 * （只读 executeSql 会直接拒绝写语句）
 */
async function runFreeDml(sql: string, _source?: string, opts?: { skipConfirm?: boolean }) {
  if (!activeConnection.value || !activeTab.value) return;
  if (!opts?.skipConfirm) {
    try {
      await ElMessageBox.confirm(describeSqlWriteRisk(sql), '写操作确认', {
        type: 'warning',
        confirmButtonText: '确认执行',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
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
  const m = head.match(
    /^(?:CREATE\s+(?:OR\s+REPLACE\s+|OR\s+ALTER\s+)?|DROP\s+(?:IF\s+EXISTS\s+)?|ALTER\s+)(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|TABLE|DATABASE|SCHEMA)\b/i,
  );
  const kind = (m?.[1] || '').toUpperCase();
  if (kind === 'TABLE') {
    objectTreeRef.value.reloadTables?.(instanceName);
  } else if (kind === 'DATABASE' || kind === 'SCHEMA') {
    void refreshBrowseObjects(undefined, { silent: true });
  } else if (kind) {
    const folder =
      kind === 'VIEW'
        ? 'views'
        : kind === 'PROCEDURE'
          ? 'procedures'
          : kind === 'FUNCTION'
            ? 'functions'
            : kind === 'TRIGGER'
              ? 'triggers'
              : kind === 'EVENT'
                ? 'events'
                : '';
    if (folder) {
      objectTreeRef.value.reloadFolder?.(folder, instanceName);
    } else {
      objectTreeRef.value.reload?.();
    }
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

/** 按库方言拼 SELECT *（给导出用） */
function buildSelectAllSql(
  dbType: string,
  instanceName: string,
  tableName: string,
  schemaName?: string,
) {
  const d = resolveSqlDialect(dbType);
  const qualifyKey =
    d.instanceKind === 'schema' ? schemaName || instanceName : instanceName;
  return d.selectAllLimited(
    qualifyKey,
    tableName,
    visualClientConfig.exportMaxRows,
  );
}

/**
 * 从接口响应中取出真正的 Blob（兼容直出 Blob 与历史 { data: Blob } 包装）
 * @author yanch
 */
function unwrapFileBlob(res: any): Blob | null {
  if (res instanceof Blob) return res;
  if (res?.data instanceof Blob) return res.data;
  return null;
}

/**
 * 通用文件流下载（Excel / SQL INSERT 共用）
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
      markTabSaved(activeTab.value);
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
      markTabSaved(activeTab.value);
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
  const t0 = performance.now();
  try {
    const res: any = await executeSql({
      dbConfigId: activeConnection.value.id,
      instanceName: activeTab.value.instanceName,
      sql,
      maxRows: 1000,
    });
    const clientElapsedMs = Math.round(performance.now() - t0);
    const data = res?.data || res;
    activeTab.value.result = {
      columns: data.columns || [],
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

function onSmartSql(sql: string) {
  const tab = openSqlInNewTab(sql, 'Smart SQL');
  if (!tab) ElMessage.warning(`同一连接最多 ${MAX_TABS} 个查询编辑器`);
}

/** 打开复制任务列表面板 */
async function onOpenCopyTasks() {
  await refreshCopyTasks();
  if (!copyTasks.value.length) {
    ElMessage.info('暂无复制任务');
    return;
  }
  const running = copyTasks.value.find(
    (t) => t.status === 'PENDING' || t.status === 'RUNNING',
  );
  const first = running || copyTasks.value[0];
  if (!first?.taskId) {
    ElMessage.info('暂无复制任务');
    return;
  }
  openCopyTask(first.taskId);
}

async function onCancelCopyTask() {
  try {
    await ElMessageBox.confirm('确认取消当前复制任务？', '取消确认', {
      type: 'warning',
    });
    await cancelCopyTask();
    ElMessage.success('已请求取消');
  } catch {
    /* 用户取消确认框 */
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
  nextTick(() => {
    void tryConsumePendingSavedQuery();
    void refreshLicenseStatus();
  });
  window.addEventListener('keydown', onGlobalKeydown);
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
    prefill: '请根据报错修复 SQL。',
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
      try {
        await ElMessageBox.confirm(describeSqlWriteRisk(s), '写操作确认', {
          type: 'warning',
          confirmButtonText: '确认执行',
          cancelButtonText: '取消',
        });
      } catch {
        return;
      }
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

function onSchemaDocAskAi(payload: { message: string }) {
  openAiAssistant({
    scene: 'schema_doc',
    prefill: payload.message,
  });
}

/** 连接列表变化时再试一次（管理页先开连接再跳转时可能晚一拍） */
watch(
  () => openConnections.value.map((c) => c.sessionId).join(','),
  () => {
    void tryConsumePendingSavedQuery();
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  onSplitterUp();
  onLeftSplitterUp();
  onTabsLeftSplitterUp();
  sessionPersist.stop();
});
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="db-client">
      <ClientToolbar
        :has-connection="hasConnection"
        :copy-task-count="copyRunningCount"
        :license-hint="licenseHint"
        @create="onCreateConnection"
        @open="onOpenConnection"
        @refresh="refreshBrowseObjects"
        @group="goGroup"
        @relation="goRelation"
        @saved-queries="goSavedQueryManage"
        @smart="smartVisible = true"
        @copy-tasks="onOpenCopyTasks"
        @system="onOpenSystemFunctions"
        @preferences="onOpenPreferences"
        @license="onOpenLicense"
        @ai="openAiAssistant()"
        @schema-doc="onOpenSchemaDoc"
        @history="onOpenHistory"
      />
      <ConnectionTabs
        :connections="openConnections"
        :active-id="activeConnectionId"
        @change="setActiveConnection"
        @close="closeConnection"
        @refresh="refreshBrowseObjects"
      />

      <div
        v-if="activeConnection"
        ref="workspaceRef"
        class="workspace"
      >
        <aside
          class="left"
          :style="{ flex: `0 0 ${leftWidth}px`, width: leftWidth + 'px' }"
          @mousedown="objectTreeRef?.closeContextMenu?.()"
        >
          <div class="search">
            <ElInput
              v-model="filterText"
              clearable
              size="small"
              placeholder="Search As Input"
            />
          </div>
          <ObjectTree
            ref="objectTreeRef"
            :db-config-id="activeConnection.id"
            :db-type="activeConnection.dbType"
            :filter-text="filterText"
            @open-table="onOpenTable"
            @insert-name="onInsertName"
            @select-instance="onSelectInstance"
            @select-table="onSelectTreeTable"
            @open-saved-query="onOpenSavedQuery"
            @context-action="onTreeContextAction"
          />
        </aside>
        <div
          class="splitter-v"
          title="拖拽调整对象树宽度"
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
            />
          </div>
          <div
            v-if="queryTabsPlacement === 'left'"
            class="splitter-v"
            title="拖拽调整查询页签宽度"
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
          />
          <div class="query-main">
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
              :disabled="activeTab?.executing"
              @click="runSql"
            >
              执行 (Ctrl+Enter / F9)
            </ElButton>
            <ElButton
              v-if="activeTab?.executing"
              type="danger"
              size="small"
              @click="stopSql"
            >
              停止
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onFormatSql"
            >
              格式化 (F12)
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onSaveQuery"
            >
              保存 (Ctrl+S)
            </ElButton>
            <ElButton
              size="small"
              :disabled="activeTab?.executing"
              @click="onSaveQueryAs"
            >
              另存为
            </ElButton>
            <ElButton
              size="small"
              @click="
                activeTab && (activeTab.resultVisible = !activeTab.resultVisible)
              "
            >
              {{ activeTab?.resultVisible ? '隐藏结果' : '显示结果' }}
            </ElButton>
            <ElButton
              size="small"
              :icon="Aim"
              title="在对象树中定位"
              :disabled="!activeTab"
              @click="locateCurrentInTree"
            />
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
              :read-only="!!activeTab.executing"
              :load-columns="loadEditorColumns"
              :load-tables="loadEditorTables"
              @execute="runSql"
              @save="onSaveQuery"
              @import-file="onImportSqlFile"
              @ask-ai="onAskAiFromEditor"
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
              @export-excel="onExportExcel"
              @export-sql="onExportSqlInsert"
              @ask-ai-fix="onAskAiFix"
            />
          </div>
          </div>
        </section>
      </div>
      <div v-else class="empty-workspace">
        从顶部「新建连接」或「打开连接」开始，像 SQLyog 一样工作。
      </div>
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
    />

    <SchemaDocDrawer
      v-model="schemaDocVisible"
      :db-config-id="activeConnection?.id"
      :instance-name="activeTab?.instanceName"
      @ask-ai="onSchemaDocAskAi"
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
    />

    <CopyDatabaseDialog
      v-model="copyDb.visible"
      :source-connection="activeConnection"
      :source-instance="copyDb.instanceName"
      :preselected-tables="copyDb.preselectedTables"
      :open-connections="openConnections"
      @started="onTaskStarted"
    />

    <CopyTaskProgressPanel
      v-model="copyProgressVisible"
      :task="copyActiveTask"
      :tasks="copyTasks"
      @hide="hideCopyProgress"
      @cancel="onCancelCopyTask"
      @select="openCopyTask"
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
      :db-config-id="activeConnection?.id ?? null"
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
        <ElFormItem label="表名">
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
      @imported="onBundleImported"
    />
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
.empty-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
</style>
