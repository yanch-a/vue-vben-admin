<script setup lang="ts">
import { parseEtlJson } from './etlSafeJson';
/**
 * SQL ETL 操作台：工作区在左侧可收起列表，任务用可停靠标签栏。
 * 步骤排成流水线并标出当前步骤；结果预览可停靠右侧/下方或隐藏。JSON 与步骤共用同一份文档。
 * @author yanch
 */
import {
  computed,
  defineAsyncComponent,
  markRaw,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  toRaw,
  watch,
} from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { Page } from '@vben/common-ui';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown,
  Fold,
  Expand,
  Plus,
  VideoPlay,
  Refresh,
  MoreFilled,
  MagicStick,
  Sort,
} from '@element-plus/icons-vue';
import type {
  EtlConnectionOption,
  EtlHistoryVersion,
  EtlNode,
  EtlResource,
  EtlRun,
  EtlWorkspaceDocument,
  EtlWorkspaceRow,
  EtlWorkspaceSync,
} from '#/api/visual/etl';
import {
  cancelEtlRun,
  copyEtlWorkspace,
  createEtlWorkspace,
  deleteEtlWorkspace,
  executeEtlWorkflow,
  getEtlWorkspace,
  getEtlRun,
  listEtlRuns,
  listEtlRunLogs,
  listEtlSources,
  listEtlWorkspaces,
  previewEtlStep,
  publishEtlWorkspace,
  restoreEtlHistory,
  saveEtlWorkspace,
  saveEtlWorkspaceOrder,
  syncEtlWorkspace,
  validateEtlWorkspace,
} from '#/api/visual/etl';
import {
  clearDatabaseMetadataCache,
  getTableColumns,
  getTables,
} from '#/api/visual/database';
import AiChatWindow from '#/views/visual/client/components/ai/AiChatWindow.vue';
import JsonEditorPanel from '#/views/visual/client/components/query/JsonEditorPanel.vue';
import WorkspaceSources from './WorkspaceSources.vue';
import TaskTabs from './TaskTabs.vue';
import KettleImportWizard from './KettleImportWizard.vue';
import WorkspaceSchedule from './WorkspaceSchedule.vue';
import WorkspaceScheduleLogs from './WorkspaceScheduleLogs.vue';
import WorkspaceNotify from './WorkspaceNotify.vue';
import EtlShareDialog from './EtlShareDialog.vue';
import EtlMergeDialog from './EtlMergeDialog.vue';
import EtlHistoryDialog from './EtlHistoryDialog.vue';
import { useUserStore } from '@vben/stores';
import { translateUiText } from '#/locales/ui-text';
import {
  buildRunAllConfirmMessage,
  formatBatchLogPrefix,
  isTerminalRunStatus,
  listEnabledBatchTasks,
  runBatchSequentially,
  summarizeBatch,
  tagBatchLogLine,
  type EtlBatchItem,
} from './etlRunBatch';
import {
  canCancelEtlRun,
  isActiveEtlRunStatus,
  nextEtlLiveDiscoverTick,
  pickActiveEtlRun,
} from './etlLiveAttach';
import { createEtlRequestGate } from './etlRequestGate';
import { createEtlPreviewSession } from './etlPreviewSession';
import { buildEtlPreviewJson } from './etlPreviewPayload';
import EtlFieldRules from './EtlFieldRules.vue';
import EtlCanvas from './EtlCanvas.vue';
import { createEtlHistory } from './etlHistory';
import { isEtlSaveShortcut, shouldHandleEtlSave } from './etlSaveShortcut';
import type { EtlHistory } from './etlHistory';
import { createEtlWorkspaceSessionCache, ETL_SESSION_HISTORY_STEPS, trimEtlSessionPreviews } from './etlWorkspaceSession';
import type { EtlCanvasViewState } from './etlWorkspaceSession';
import {
  ETL_WORKSPACE_SORT_KEY,
  ETL_WORKSPACE_SORT_OPTIONS,
  moveEtlWorkspace,
  parseEtlWorkspaceSort,
  sortEtlWorkspaces,
} from './workspaceSort';
import type { EtlWorkspaceSortMode } from './workspaceSort';
import EtlOperatorEditor from './EtlOperatorEditor.vue';
import { createFlexibleExamplePipeline, createOperatorConfig, ETL_OPERATORS, etlInputReferences, isEtlRowSource } from './etlOperators';
import { createEtlSqlDraftGuard } from './etlSqlDraftGuard';
import {
  clearEtlLocalDraft,
  etlDirtyIds,
  getEtlLocalDraft,
  refreshEtlDirtyIds,
  saveEtlLocalDraft,
} from './etlDraftCache';
import {
  preferredOpenPipelineId,
  readLastEtlWorkspace,
  rememberEtlWorkspace,
} from './etlTabState';
import {
  buildAiWorkspace,
  type EtlAiEditPreference,
  cloneDocument,
  createSqlPipeline,
  createWorkspaceDocument,
  duplicatePipeline,
  etlId,
  mergeAiPipelineEdit,
  normalizeSqlDocument,
  pipelineEditJson,
  restoreSavedPipeline,
  sameEtlValue,
  syncStepDependencies,
} from './etlModel';
import {
  mergeEtlCollaboration,
  resolveEtlConflict,
  type EtlMergeConflict,
} from './etlCollabMerge';

defineOptions({ name: 'EtlWorkspace' });

/**
 * 查询步骤的 SQL 区复用查询页编辑器。
 * 异步加载，并且模板里只在当前步骤是查询时挂载一个实例，切走即销毁。
 * 编辑器不参与执行，同步吞吐仍由后端决定。
 */
const SqlEditor = defineAsyncComponent(
  () => import('#/views/visual/client/components/query/SqlEditor.vue'),
);
const loading = ref(false),
  saving = ref(false),
  publishing = ref(false),
  running = ref(false),
  previewing = ref(false);
const sidebarOpen = ref(localStorage.getItem('lemon-etl-sidebar') !== 'closed');
const taskPosition = ref(
  ['top', 'left', 'right'].includes(localStorage.getItem('lemon-etl-tabs') || '')
    ? localStorage.getItem('lemon-etl-tabs')!
    : 'top',
);
/**
 * 侧栏停靠：右侧 / 下方 / 不显示。
 * 查询预览与写入字段映射各自独立记忆——预览常隐藏，映射基本常开，不能共用。
 */
type ResultDock = 'right' | 'bottom' | 'hidden';
type ResultDockKind = 'preview' | 'mapping';
const RESULT_DOCK_OPTIONS: { value: ResultDock; labelKey: string }[] = [
  { value: 'right', labelKey: '右侧' },
  { value: 'bottom', labelKey: '下方' },
  { value: 'hidden', labelKey: '不显示' },
];
const PREVIEW_DOCK_KEY = 'lemon-etl-result-dock';
const MAPPING_DOCK_KEY = 'lemon-etl-mapping-dock';
function parseResultDock(raw: string | null, fallback: ResultDock): ResultDock {
  if (raw === 'right' || raw === 'bottom' || raw === 'hidden') return raw;
  return fallback;
}
function loadPreviewDock(): ResultDock {
  const saved = localStorage.getItem(PREVIEW_DOCK_KEY);
  if (saved === 'right' || saved === 'bottom' || saved === 'hidden') return saved;
  // 兼容旧版「隐藏结果」开关
  if (localStorage.getItem('lemon-etl-result') === 'closed') return 'hidden';
  return 'right';
}
function loadMappingDock(): ResultDock {
  // 写入字段映射默认常开右侧；不继承预览的「隐藏」偏好
  return parseResultDock(localStorage.getItem(MAPPING_DOCK_KEY), 'right');
}
const previewDock = ref<ResultDock>(loadPreviewDock());
const mappingDock = ref<ResultDock>(loadMappingDock());
const resultDockMenuOpen = ref(false);
/** 用户布局偏好不写进可移植任务 JSON。 */
function setTaskPosition(position: string) {
  taskPosition.value = position;
  localStorage.setItem('lemon-etl-tabs', position);
}
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
  localStorage.setItem('lemon-etl-sidebar', sidebarOpen.value ? 'open' : 'closed');
}
const workspaces = ref<EtlWorkspaceRow[]>([]),
  activeWorkspace = ref<EtlWorkspaceRow>();
const doc = ref<EtlWorkspaceDocument>(createWorkspaceDocument('new', ''));
const connections = ref<EtlConnectionOption[]>([]);
const activePipelineId = ref(''),
  selectedNodeId = ref('');
/** 步骤视图：表单或画布，两者编辑同一份任务 JSON。 */
const STEPS_VIEW_KEY = 'lemon-etl-steps-view';
const canvasEditorOpen = ref(false);
const stepsView = ref<'canvas' | 'form'>(localStorage.getItem(STEPS_VIEW_KEY) === 'canvas' ? 'canvas' : 'form');
const editorMode = ref<'steps' | 'json'>('steps'),
  jsonText = ref(''),
  jsonValid = ref(true),
  saved = ref('');
const pipeline = computed(() =>
  doc.value.pipelines.find((item) => item.id === activePipelineId.value),
);
const node = computed(() =>
  pipeline.value?.nodes.find((item) => item.id === selectedNodeId.value),
);
function isWriteStep(type?: string) {
  return type === 'database.write' || type === 'database.upsert';
}
/** 当前步骤对应的侧栏类型：查询用预览偏好，写入用映射偏好 */
function currentDockKind(): ResultDockKind {
  return isWriteStep(node.value?.type) ? 'mapping' : 'preview';
}
const resultDock = computed(() =>
  currentDockKind() === 'mapping' ? mappingDock.value : previewDock.value,
);
const resultDockMenuTitle = computed(() =>
  currentDockKind() === 'mapping' ? '字段映射位置' : '结果预览位置',
);
function setResultDock(next: ResultDock) {
  if (currentDockKind() === 'mapping') {
    mappingDock.value = next;
    localStorage.setItem(MAPPING_DOCK_KEY, next);
  } else {
    previewDock.value = next;
    localStorage.setItem(PREVIEW_DOCK_KEY, next);
  }
  resultDockMenuOpen.value = false;
}
const resources = computed(() => Object.entries(doc.value.resources));
const queryColumns = ref<Record<string, string[]>>({});
/** 当前查询步骤的 SQL 编辑器，用来在光标处插入表名。 */
const sqlEditorRef = ref<{ insertText: (text: string) => void }>();
/** 当前查询步骤的编辑器页签。切换步骤时复用同一个实例并丢掉上一步的模型。 */
const sqlEditorTabId = computed(() =>
  `${activePipelineId.value}:${selectedNodeId.value}`,
);
/** 只把编辑器内容写回当前查询步骤，避免切换步骤时的迟到事件写到别的节点。 */
function onSqlEditorInput(sql: string) {
  const current = node.value;
  if (!current || current.type !== 'database.query') return;
  if (String(current.config.sql || '') === sql) return;
  current.config.sql = sql;
}
const nodeResource = computed(
  () => doc.value.resources[node.value?.resourceRef || ''],
);
const usedRefs = computed(() =>
  doc.value.pipelines.flatMap((item) =>
    item.nodes.map((step) => step.resourceRef || ''),
  ),
);
const dirty = computed(
  () => Boolean(activeWorkspace.value) && snapshot() !== saved.value,
);
/**
 * 相对上次保存到数据库的草稿，内容有变化的任务 ID。
 * 只比较任务自身；其它任务未改时不标黄。
 */
const dirtyPipelineIds = computed(() => {
  const current = currentLocalDocument();
  const savedDoc = savedWorkspaceDocument();
  if (!current?.pipelines) return [] as string[];
  const savedById = new Map(
    (savedDoc?.pipelines || []).map((item) => [item.id, JSON.stringify(item)]),
  );
  return current.pipelines
    .filter((item) => savedById.get(item.id) !== JSON.stringify(item))
    .map((item) => item.id);
});
/** 上次与服务端对齐时的 revision，本地稿过期判定用 */
const savedRevision = ref(0);
/** 当前已知的服务端 revision。保存和协同拉取用它做乐观锁；有未解决冲突时可以比祖先版本更新。 */
const knownRemoteRevision = ref(0);
const workspaceRequests = createEtlRequestGate();
const draftOperations = createEtlPreviewSession(() => JSON.stringify([workspaceRequests.stamp(), activePipelineId.value, selectedNodeId.value, doc.value, jsonText.value, editorMode.value]));
const previewRequests = createEtlPreviewSession(() => JSON.stringify([workspaceRequests.stamp(), activePipelineId.value, doc.value]));
const tableInsertRequests = createEtlSqlDraftGuard(() => JSON.stringify([workspaceRequests.stamp(), activePipelineId.value, selectedNodeId.value, node.value?.config.sql, nodeResource.value]));
/** 没有共同祖先的旧本地稿：只能整份选择，不能自动合并。 */
const draftConflict = ref<EtlWorkspaceRow>();
/** 上次与服务端对齐的文档和名称，三方合并的共同祖先。 */
const baseDocument = ref<EtlWorkspaceDocument>();
const baseMeta = ref({ name: '', description: '' });
/** 最近一次拉到的对方文档。冲突全部选择完后，用它作为新的共同祖先。 */
const latestRemoteDocument = ref<EtlWorkspaceDocument>();
const latestRemoteMeta = ref({ name: '', description: '' });
const mergeConflicts = ref<EtlMergeConflict[]>([]);
/** JSON 还没写完时不能解析本地稿，只能提示，不能用对方版本覆盖。 */
const syncBlocked = ref(false);
const shareDialog = ref<InstanceType<typeof EtlShareDialog>>();
const mergeDialog = ref<InstanceType<typeof EtlMergeDialog>>();
const syncing = ref(false);
/** 本次同步新出现的任务 ID。标签栏在渲染前收起，避免先闪一下再关掉。 */
const suppressedPipelineIds = ref<string[]>([]);
/** 后台对齐对方保存的间隔。手动同步不受这个间隔限制。 */
const COLLAB_SYNC_MS = 10 * 1000;
let collabTimer: ReturnType<typeof setTimeout> | undefined;
let collabPulling = false;
/** 自动同步进行中又点了手动同步时，当前这次结束后再拉一次。 */
let collabFollowUp = false;
/**
 * 用户明确保留本地稿后，在保存前不要用服务端文档当祖先做三方合并。
 * 否则本地没有的任务会被当成用户删除。
 */
let preferLocalUntilSave = false;
let collabAlive = true;
const isWorkspaceOwner = computed(
  () => activeWorkspace.value?.accessRole !== 'EDITOR',
);
/** 打开/切换工作区期间暂停自动落盘，避免半成品覆盖缓存 */
let cachePaused = false;
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
const previousQueries = computed(() => {
  const steps = pipeline.value?.nodes || [];
  // 展示顺序不限制 DAG 引用；排除当前节点和它的所有后继，防止交互产生循环。
  const downstream = new Set([selectedNodeId.value]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of pipeline.value?.edges || [])
      if (
        edge.enabled !== false &&
        downstream.has(edge.source) &&
        !downstream.has(edge.target)
      ) {
        downstream.add(edge.target);
        changed = true;
      }
  }
  return steps.filter(
    (item) =>
      isEtlRowSource(item.type) &&
      item.enabled !== false &&
      !downstream.has(item.id),
  );
});
const validationErrors = ref<string[]>([]),
  validationWarnings = ref<string[]>([]);
let validatedSnapshot = '';
/** 只展示与当前配置匹配的校验结果；修改后不保留旧的红黄条。 */
watch(
  () => snapshot(),
  () => {
    if (snapshot() !== validatedSnapshot) {
      validationErrors.value = [];
      validationWarnings.value = [];
    }
  },
);
/** 草稿未完成（空 SQL/目标表）不钉在页面底部，只在运行时拦截提示。 */
const DRAFT_INCOMPLETE = /尚未填写查询 SQL|尚未选择目标表/;
const stickyWarnings = computed(() =>
  validationWarnings.value.filter((item) => !DRAFT_INCOMPLETE.test(item)),
);
/** el-select 不能稳定选中空字符串，固定值用哨兵再写回 stepId=''。 */
const FIXED_PARAM_SOURCE = '__fixed__';
const VARIABLE_PARAM_SOURCE = '__variable__';
const variableName = ref(''), variableValue = ref('');
/** 工作区变量值通过 JDBC 绑定；这里新增文本值，复杂值可使用原有 JSON 编辑器。 */
function addVariable() {
  const name = variableName.value.trim();
  if (!name || Object.hasOwn(doc.value.variables, name)) { say('warning', '变量名不能为空或重复'); return; }
  doc.value.variables = { ...doc.value.variables, [name]: variableValue.value };
  variableName.value = ''; variableValue.value = '';
}
const catalog = ref<any[]>([]),
  catalogLoading = ref(false);
/** 已装入内存的表目录范围。同连接、实例、schema 切换步骤时不再读缓存或请求后台。 */
const catalogScope = ref('');
const catalogSearch = ref('');
const catalogInserting = ref('');
const filteredCatalog = computed(() => {
  const keyword = catalogSearch.value.trim().toLowerCase();
  if (!keyword) return catalog.value;
  return catalog.value.filter((table) =>
    String(table.qualifiedName || table.tableName || '')
      .toLowerCase()
      .includes(keyword),
  );
});
const previews = ref<
  Record<
    string,
    {
      columns: string[];
      rows: any[];
      rowCount: number;
      sampled: boolean;
      stale?: boolean;
      upstreamColumns?: Record<string, string[]>;
    }
  >
>({});
const previewResult = computed(() => previews.value[selectedNodeId.value]);
/** 本次预览实际跑过的上游步骤，用来说明参数不是空值，而是前面步骤查出来的。 */
const previewUpstreamLabels = computed(() => {
  const columns = previewResult.value?.upstreamColumns;
  if (!columns || !pipeline.value) return [];
  return Object.keys(columns)
    .filter((id) => id !== selectedNodeId.value)
    .map(
      (id) =>
        pipeline.value?.nodes.find((item) => item.id === id)?.name || id,
    );
});
/** 写入步骤右侧对照的是输入查询的样本，不是写入节点自己的预览。 */
const inputPreview = computed(() => {
  const id = node.value?.config?.inputStepId;
  return id ? previews.value[id] : undefined;
});
const newVisible = ref(false),
  sourcesVisible = ref(false);
const newName = ref(''),
  newDescription = ref(''),
  newResources = ref<Record<string, EtlResource>>({});
const sourceDraft = ref<Record<string, EtlResource>>({});
const createBusy = ref(false);
const runs = ref<EtlRun[]>([]),
  runsVisible = ref(false);
const selectedRun = ref<EtlRun>();
/** 运行记录抽屉：按状态筛选 + 客户端分页（后端最多返回 100 条） */
const runsStatusFilter = ref('');
const runsPage = ref(1);
const runsPageSize = 30;
const filteredRuns = computed(() => {
  const status = runsStatusFilter.value;
  if (!status) return runs.value;
  return runs.value.filter((item) => item.status === status);
});
const pagedRuns = computed(() => {
  const start = (runsPage.value - 1) * runsPageSize;
  return filteredRuns.value.slice(start, start + runsPageSize);
});
const runsStatusOptions = [
  'PENDING',
  'VALIDATING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];
watch(runsStatusFilter, () => {
  runsPage.value = 1;
});
watch(filteredRuns, (list) => {
  const maxPage = Math.max(1, Math.ceil(list.length / runsPageSize) || 1);
  if (runsPage.value > maxPage) runsPage.value = maxPage;
});
/** 当前这次单任务运行的实时日志。收起只藏内容，运行中仍继续拉取。 */
const liveRunId = ref('');
const liveRunSnapshot = ref<EtlRun>();
const userStore = useUserStore();
/** 旁观者可看日志；取消仅所有者或发起人（与后端 cancel ACL 一致） */
const canCancelLiveRun = computed(() =>
  canCancelEtlRun({
    run: liveRunSnapshot.value,
    currentUserId: userStore.userInfo?.userId,
    isWorkspaceOwner: isWorkspaceOwner.value,
  }),
);
const canCancelSelectedRun = computed(() =>
  canCancelEtlRun({
    run: selectedRun.value,
    currentUserId: userStore.userInfo?.userId,
    isWorkspaceOwner: isWorkspaceOwner.value,
  }),
);
const liveLogs = ref<any[]>([]);
const liveConsoleOpen = ref(false);
const liveLogBody = ref<HTMLElement>();
let liveLogRequest = 0;
/** 顶部「运行」全部任务批次；画布/任务头单跑时保持 false。 */
const liveBatchMode = ref(false);
const liveBatchItems = ref<EtlBatchItem[]>([]);
const liveBatchSummary = computed(() => summarizeBatch(liveBatchItems.value));
let batchCancelRequested = false;
/** 当前轮询日志所属任务，用于给日志行打任务名前缀。 */
let liveLogTagTask: { id: string; name: string } | undefined;
/** 只取消还没返回的预览。正式运行一旦提交就不能靠断开 HTTP 停掉。 */
let previewAbort: AbortController | undefined;
/** 接口按时间倒序返回，页面从旧到新往下追加，便于跟着最新一行看。 */
const liveLogLines = computed(() => [...liveLogs.value].reverse());
const runLogs = ref<any[]>([]),
  logPage = ref(1),
  logTotal = ref(0),
  logNode = ref(''),
  logsBusy = ref(false);
let logRequest = 0;
/** 日志过滤与分页独立于步骤最终状态，保留每次查询分页/写入批次事件。 */
async function refreshLogs() {
  if (!selectedRun.value || !runsVisible.value) return;
  const request = ++logRequest;
  logsBusy.value = true;
  try {
    const response: any = unbox(
      await listEtlRunLogs(
        selectedRun.value.id,
        logPage.value,
        logNode.value || undefined,
      ),
    );
    if (request !== logRequest) return;
    runLogs.value = response.records || [];
    logTotal.value = response.total || 0;
  } catch (error) {
    if (request === logRequest) say('error', errorMessage(error));
  } finally {
    if (request === logRequest) logsBusy.value = false;
  }
}
watch(
  () => selectedRun.value?.id,
  () => {
    logPage.value = 1;
    logNode.value = '';
    runLogs.value = [];
    logTotal.value = 0;
    refreshLogs();
  },
);
const runSteps = computed(() => {
  try {
    return JSON.parse(selectedRun.value?.stepsJson || '[]');
  } catch {
    return [];
  }
});
let pollTimer: ReturnType<typeof setTimeout> | undefined;
/** 页面卸载后，进行中的轮询不能再预约下一次。 */
/** 合并 onActivated 与定时器并发的 refreshRuns，避免重复 listRuns/logs。 */
let refreshRunsTail: Promise<void> | undefined;
let refreshRunsQueued = false;
let refreshRunsForceList = false;
/** 已挂活跃运行时，隔 N 次轮询才再 listRuns 发现更高优先级/定时新跑。 */
let liveDiscoverTick = 0;
let pageAlive = true;
let catalogRequest = 0;
const jsonInput = ref<HTMLInputElement>(),
  kettleInput = ref<HTMLInputElement>();
const kettleWizard = ref<InstanceType<typeof KettleImportWizard>>();
const aiWindow = ref<InstanceType<typeof AiChatWindow>>();
const aiResourceRef = ref('');
const aiSource = computed(
  () => doc.value.resources[aiResourceRef.value] || resources.value[0]?.[1],
);

/** request 兼容标准 R 响应和直接业务数据。 */
function unbox<T>(response: any): T {
  return (response?.data ?? response) as T;
}
function snapshot() {
  return JSON.stringify({
    document: editorMode.value === 'json' ? jsonText.value : doc.value,
    name: activeWorkspace.value?.workspaceName,
    description: activeWorkspace.value?.description || '',
  });
}
function syncJson() {
  if (activeWorkspace.value)
    doc.value.workspace = {
      id: String(activeWorkspace.value.id),
      name: activeWorkspace.value.workspaceName,
      description: activeWorkspace.value.description || '',
    };
  jsonText.value = JSON.stringify(doc.value, null, 2);
}
function markSaved() {
  saved.value = snapshot();
  if (activeWorkspace.value)
    savedRevision.value = Number(activeWorkspace.value.revision) || 0;
}

/** 当前编辑内容写成可恢复的 draftJson（JSON 模式优先用编辑器文本）。 */
function currentDraftJson() {
  if (editorMode.value === 'json') {
    return jsonText.value;
  }
  syncJson();
  return jsonText.value;
}

/** 把未保存修改写入 localStorage，切页/切工作区后可恢复。 */
function flushActiveDraft(): boolean {
  const row = activeWorkspace.value;
  if (!row || !dirty.value) return true;
  if (cachePaused) return false;
  const ok = saveEtlLocalDraft({
    workspaceId: String(row.id),
    baseRevision: savedRevision.value,
    baseJson: baseDocument.value ? JSON.stringify(baseDocument.value) : undefined,
    baseName: baseMeta.value.name,
    baseDescription: baseMeta.value.description,
    workspaceName: row.workspaceName || '',
    description: row.description || '',
    draftJson: currentDraftJson(),
    editorMode: editorMode.value,
    documentJson: JSON.stringify(doc.value),
    activePipelineId: activePipelineId.value,
    selectedNodeId: selectedNodeId.value,
  });
  if (!ok)
    say('warning', 
      '本地草稿缓存失败（可能超出存储上限），请保存或导出备份后再离开',
    );
  return ok;
}

function scheduleFlushDraft() {
  if (cachePaused || !activeWorkspace.value || !dirty.value) return;
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    cacheTimer = undefined;
    flushActiveDraft();
  }, 400);
}

/** 侧栏：当前编辑脏，或存在未提交的本地稿。 */
function isWorkspaceDirty(workspace: EtlWorkspaceRow) {
  const id = String(workspace.id);
  if (String(activeWorkspace.value?.id) === id && dirty.value) return true;
  return etlDirtyIds.value.has(id);
}

/** 侧栏展示名优先用本地未保存改名。 */
function workspaceDisplayName(workspace: EtlWorkspaceRow) {
  const local = getEtlLocalDraft(workspace.id);
  return local?.workspaceName || workspace.workspaceName;
}
function stepTitle(step: EtlNode) {
  return step.type === 'database.query'
    ? 'SQL 查询'
    : ['database.write', 'database.upsert'].includes(step.type)
      ? '结果写表'
      : step.type === 'transform.select'
        ? '字段选择 / 重命名'
        : ETL_OPERATORS.find((operator) => operator.type === step.type)?.label || step.type;
}
function canvasNodeTitle(step: EtlNode) {
  return step.name || translateUiText(stepTitle(step));
}
function canvasNodeSubtitle(step: EtlNode) {
  const kind = translateUiText(stepTitle(step));
  return step.resourceRef ? `${kind} · ${translateUiText(sourceLabel(step.resourceRef))}` : kind;
}
/** 切换表单 / 画布 / JSON；离开 JSON 前先校验并应用 JSON。 */
async function changeEditorView(view: 'canvas' | 'form' | 'json') {
  if (view === 'json') {
    canvasEditorOpen.value = false;
    if (editorMode.value !== 'json') await changeMode('json');
    return;
  }
  if (editorMode.value === 'json') {
    await changeMode('steps');
    if (editorMode.value === 'json') return;
  }
  stepsView.value = view;
  canvasEditorOpen.value = false;
  localStorage.setItem(STEPS_VIEW_KEY, view);
}
/** 编辑视图对整个 ETL 页面生效，切换任务不改变；表单 / 画布记在本机，JSON 随文档重新加载回到步骤视图。 */
const EDITOR_VIEW_OPTIONS = [
  { label: '表单', value: 'form' },
  { label: '画布', value: 'canvas' },
  { label: 'JSON', value: 'json' },
] as const;
const currentEditorView = computed(() => (editorMode.value === 'json' ? 'json' : stepsView.value));
const NODE_DRAWER_WIDTH_KEY = 'lemon-etl-node-drawer-width';
const NODE_DRAWER_MIN_WIDTH = 360;
const NODE_DRAWER_DEFAULT_WIDTH = 1000;
function clampNodeDrawerWidth(width: number) {
  const max = Math.max(NODE_DRAWER_MIN_WIDTH, Math.floor(window.innerWidth * 0.9));
  return Math.min(max, Math.max(NODE_DRAWER_MIN_WIDTH, Math.round(width) || NODE_DRAWER_DEFAULT_WIDTH));
}
const nodeDrawerWidth = ref(clampNodeDrawerWidth(Number(localStorage.getItem(NODE_DRAWER_WIDTH_KEY)) || NODE_DRAWER_DEFAULT_WIDTH));
const nodeDrawerStyle = computed(() => ({ '--etl-node-drawer-width': `${nodeDrawerWidth.value}px` }));
/** 拖动抽屉左边缘调整宽度，松开后记住。 */
function startNodeDrawerResize(event: PointerEvent) {
  event.preventDefault();
  const move = (next: PointerEvent) => {
    nodeDrawerWidth.value = clampNodeDrawerWidth(window.innerWidth - next.clientX);
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem(NODE_DRAWER_WIDTH_KEY, String(nodeDrawerWidth.value));
  };
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}
function resetNodeDrawerWidth() {
  nodeDrawerWidth.value = clampNodeDrawerWidth(NODE_DRAWER_DEFAULT_WIDTH);
  localStorage.setItem(NODE_DRAWER_WIDTH_KEY, String(nodeDrawerWidth.value));
}
const RUN_CONSOLE_HEIGHT_KEY = 'lemon-etl-run-console-height';
const RUN_CONSOLE_MIN_HEIGHT = 80;
const RUN_CONSOLE_DEFAULT_HEIGHT = 180;
function clampRunConsoleHeight(height: number) {
  const max = Math.max(
    RUN_CONSOLE_MIN_HEIGHT,
    Math.floor(window.innerHeight * 0.6),
  );
  return Math.min(
    max,
    Math.max(
      RUN_CONSOLE_MIN_HEIGHT,
      Math.round(height) || RUN_CONSOLE_DEFAULT_HEIGHT,
    ),
  );
}
const runConsoleBodyHeight = ref(
  clampRunConsoleHeight(
    Number(localStorage.getItem(RUN_CONSOLE_HEIGHT_KEY)) ||
      RUN_CONSOLE_DEFAULT_HEIGHT,
  ),
);
/** Drag the top edge of the bottom execution log to resize height. */
function startRunConsoleResize(event: PointerEvent) {
  event.preventDefault();
  liveConsoleOpen.value = true;
  const startY = event.clientY;
  const startH = runConsoleBodyHeight.value;
  const move = (next: PointerEvent) => {
    runConsoleBodyHeight.value = clampRunConsoleHeight(
      startH + (startY - next.clientY),
    );
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    localStorage.setItem(
      RUN_CONSOLE_HEIGHT_KEY,
      String(runConsoleBodyHeight.value),
    );
  };
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'row-resize';
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}
function resetRunConsoleHeight() {
  runConsoleBodyHeight.value = clampRunConsoleHeight(
    RUN_CONSOLE_DEFAULT_HEIGHT,
  );
  localStorage.setItem(
    RUN_CONSOLE_HEIGHT_KEY,
    String(runConsoleBodyHeight.value),
  );
}
/** 画布显示全部任务：点到哪个任务的节点，就把它设为当前任务，表单 / JSON / 运行都作用在它上面。 */
function selectCanvasCell(pipelineId: string, nodeId?: string) {
  const changed = activePipelineId.value !== pipelineId;
  activePipelineId.value = pipelineId;
  if (nodeId) selectedNodeId.value = nodeId;
  else if (changed) selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
}
/**
 * 撤销 / 重做：记在整份工作区文档上，表单、画布、JSON 改动都能撤销，三个视图保持一致。
 * 文档变化后停顿 400ms 记一步（拖动结束、一次连线、一次改名各一步）；节点抽屉打开期间的修改合并成一步。
 * 打开 / 重新加载工作区时清空；保存不清空，撤销后草稿会重新变成未保存。运行任务不改文档，不进历史。
 */
let docHistory: EtlHistory = createEtlHistory();
const historyState = ref({ canRedo: false, canUndo: false });
let historyTimer: ReturnType<typeof setTimeout> | undefined;
let drawerSession = 0;
/** 当前合并会话；节点抽屉打开期间为 drawer-N。 */
let historyKey = '';
function refreshHistoryState() {
  historyState.value = { canRedo: docHistory.canRedo(), canUndo: docHistory.canUndo() };
}
function commitDocHistory() {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = undefined;
  if (!activeWorkspace.value) return;
  docHistory.commit(doc.value, historyKey);
  refreshHistoryState();
}
function resetDocHistory() {
  const history = docHistory;
  const reset = () => {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = undefined;
    if (history !== docHistory) return;
    history.reset(doc.value);
    refreshHistoryState();
  };
  reset();
  // 加载时随后的规整会再触发一次文档监听，等它排队后再以最终内容为起点。
  void nextTick(reset);
}
watch(
  doc,
  () => {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(commitDocHistory, 400);
  },
  { deep: true },
);
watch(canvasEditorOpen, (open) => {
  // 打开抽屉前的修改先单独记一步；关闭时把剩下的修改并进这次编辑，再结束会话。
  commitDocHistory();
  historyKey = open ? `drawer-${++drawerSession}` : '';
});
function applyDocHistory(next: EtlWorkspaceDocument | null) {
  if (!next) return;
  canvasEditorOpen.value = false;
  doc.value = next;
  if (!doc.value.pipelines.some((item) => item.id === activePipelineId.value))
    activePipelineId.value = doc.value.pipelines[0]?.id || '';
  if (!pipeline.value?.nodes.some((item) => item.id === selectedNodeId.value))
    selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
  refreshHistoryState();
}
function undoDoc() {
  if (editorMode.value === 'json') return;
  commitDocHistory();
  applyDocHistory(docHistory.undo());
}
function redoDoc() {
  if (editorMode.value === 'json') return;
  commitDocHistory();
  applyDocHistory(docHistory.redo());
}
/** 画布任务菜单 / 工具栏运行：先切到该任务，再走原有的运行流程（含保存和校验）。 */
async function runCanvasTask(pipelineId: string) {
  selectCanvasCell(pipelineId);
  await nextTick();
  await runPipeline();
}
async function renameCanvasTask(pipelineId: string) {
  const task = doc.value.pipelines.find((item) => item.id === pipelineId);
  if (!task) return;
  try {
    const { value } = await ElMessageBox.prompt(translateUiText('任务名称'), translateUiText('改名'), {
      inputValue: task.name,
      inputPattern: /\S+/,
      inputErrorMessage: translateUiText('名称不能为空'),
      confirmButtonText: translateUiText('确定'),
      cancelButtonText: translateUiText('取消'),
    });
    // 等待期间任务可能已被删除或文档被替换。
    const current = doc.value.pipelines.find((item) => item.id === pipelineId);
    if (current) current.name = value.trim().slice(0, 100);
  } catch {
    /* 取消保留原名。 */
  }
}
function editCanvasNode(pipelineId: string, nodeId: string) {
  selectCanvasCell(pipelineId, nodeId);
  canvasEditorOpen.value = true;
}
async function removeCanvasNode(pipelineId: string, nodeId: string) {
  selectCanvasCell(pipelineId, nodeId);
  await nextTick();
  await removeStep();
}
async function renameCanvasNode(pipelineId: string, nodeId: string) {
  const task = doc.value.pipelines.find((item) => item.id === pipelineId);
  const step = task?.nodes.find((item) => item.id === nodeId);
  if (!step) return;
  selectCanvasCell(pipelineId, nodeId);
  try {
    const { value } = await ElMessageBox.prompt(translateUiText('输入名称'), translateUiText('改名'), {
      inputValue: step.name || '',
      inputPattern: /\S+/,
      inputErrorMessage: translateUiText('名称不能为空'),
      confirmButtonText: translateUiText('确认'),
      cancelButtonText: translateUiText('取消'),
    });
    const current = doc.value.pipelines
      .find((item) => item.id === pipelineId)
      ?.nodes.find((item) => item.id === nodeId);
    if (current) current.name = value.trim().slice(0, 100);
  } catch {
    /* 取消则保留原名 */
  }
}

/** 表单流水线节点右键菜单：改名 / 删除 */
const formStepMenu = ref<{ nodeId: string; x: number; y: number }>();
const formStepMenuTitle = computed(() => {
  const id = formStepMenu.value?.nodeId;
  const step = id ? pipeline.value?.nodes.find((item) => item.id === id) : undefined;
  return step ? (step.name || stepTitle(step) || step.id) : '';
});
function closeFormStepMenu() {
  formStepMenu.value = undefined;
}
function openFormStepMenu(event: MouseEvent, nodeId: string) {
  selectedNodeId.value = nodeId;
  formStepMenu.value = { nodeId, x: event.clientX, y: event.clientY };
  const close = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.('.etl-step-context-menu')) return;
    closeFormStepMenu();
    window.removeEventListener('pointerdown', close, true);
  };
  window.setTimeout(() => window.addEventListener('pointerdown', close, true), 0);
}
async function formStepMenuAction(action: 'rename' | 'delete') {
  const menu = formStepMenu.value;
  closeFormStepMenu();
  if (!menu || !pipeline.value) return;
  if (action === 'rename') await renameCanvasNode(pipeline.value.id, menu.nodeId);
  else {
    selectedNodeId.value = menu.nodeId;
    await nextTick();
    await removeStep();
  }
}
function onCanvasDrawerKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && canvasEditorOpen.value) canvasEditorOpen.value = false;
}
function sourceLabel(ref?: string) {
  return doc.value.resources[ref || '']?.displayName || '请选择数据源';
}
function errorMessage(error: any) {
  return error?.msg || error?.message || '操作失败';
}
/** 历史中文提示走界面文案表，英文界面不再弹出中文。 */
function say(
  type: 'success' | 'warning' | 'info' | 'error',
  message: unknown,
) {
  ElMessage[type](translateUiText(message));
}
/** 雪花 ID 可能是 number 或 string，不能用 !== 比较。 */
function sameWorkspace(
  left?: string | number | null,
  right?: string | number | null,
) {
  return left != null && right != null && String(left) === String(right);
}
function resetLiveConsole() {
  liveLogRequest += 1;
  liveRunId.value = '';
  liveRunSnapshot.value = undefined;
  liveLogs.value = [];
  liveConsoleOpen.value = false;
  liveBatchMode.value = false;
  liveBatchItems.value = [];
  batchCancelRequested = false;
  liveLogTagTask = undefined;
  liveDiscoverTick = 0;
}
function abortPreviewRequest() {
  previewAbort?.abort();
  previewAbort = undefined;
}
function isAbortError(error: any) {
  return (
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError' ||
    error?.code === 'ERR_CANCELED'
  );
}
/**
 * 切换工作区 / 离开页面前：把未保存修改落到本地，不再弹「放弃」以免丢稿。
 * 返回 true 表示可以继续切换。
 */
async function discard(): Promise<boolean> {
  return flushActiveDraft();
}

/** 创建前先完成数据源选择；直接提交完整文档，不产生配置为空的半成品。 */
async function createWorkspace() {
  if (!newName.value.trim()) {
    say('warning', '请填写工作区名称');
    return;
  }
  if (!Object.keys(newResources.value).length) {
    say('warning', '请至少加入一个具体数据源');
    return;
  }
  const names = Object.values(newResources.value).map((item) =>
    item.displayName?.trim(),
  );
  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    say('warning', '请设置不同且非空的数据源别名');
    return;
  }
  if (!(await discard())) return;
  createBusy.value = true;
  try {
    const document = createWorkspaceDocument('new', newName.value.trim());
    document.resources = cloneDocument({
      ...document,
      resources: newResources.value,
    }).resources;
    document.pipelines.push(createSqlPipeline(Object.keys(document.resources)));
    const row = unbox<EtlWorkspaceRow>(
      await createEtlWorkspace({
        workspaceName: newName.value.trim(),
        description: newDescription.value,
        draftJson: JSON.stringify(document),
      }),
    );
    newVisible.value = false;
    newName.value = '';
    newDescription.value = '';
    newResources.value = {};
    await refreshWorkspaces();
    await openWorkspace(row);
  } catch (error) {
    say('error', errorMessage(error));
  } finally {
    createBusy.value = false;
  }
}

async function refreshWorkspaces() {
  workspaces.value = unbox<EtlWorkspaceRow[]>(await listEtlWorkspaces()) || [];
}
/** 左侧工作区排序方式记在本机；自定义顺序存在后端，换设备也一样。 */
const workspaceSort = ref(parseEtlWorkspaceSort(localStorage.getItem(ETL_WORKSPACE_SORT_KEY)));
const sortedWorkspaces = computed(() => sortEtlWorkspaces(workspaces.value, workspaceSort.value, workspaceDisplayName));
const workspaceDrag = ref<{ after: boolean; overId: string; sourceId: string }>();
let workspaceOrderRequest = 0;
function setWorkspaceSort(command: string) {
  const next = { ...workspaceSort.value };
  if (command === 'asc' || command === 'desc') next.desc = command === 'desc';
  else {
    next.mode = command as EtlWorkspaceSortMode;
    // 时间默认最新在前，其余默认正序。
    next.desc = command === 'updated' || command === 'created';
  }
  workspaceSort.value = next;
  localStorage.setItem(ETL_WORKSPACE_SORT_KEY, JSON.stringify(next));
}
function onWorkspaceDragStart(event: DragEvent, workspace: EtlWorkspaceRow) {
  workspaceDrag.value = { sourceId: String(workspace.id), overId: '', after: false };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(workspace.id));
  }
}
function onWorkspaceDragOver(event: DragEvent, workspace: EtlWorkspaceRow) {
  if (!workspaceDrag.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  workspaceDrag.value = { ...workspaceDrag.value, overId: String(workspace.id), after: event.clientY > box.top + box.height / 2 };
}
/** 松开后立即按新顺序显示，再整体保存；失败时恢复为后端的顺序。 */
async function onWorkspaceDrop(event: DragEvent) {
  const drag = workspaceDrag.value;
  workspaceDrag.value = undefined;
  if (!drag?.overId) return;
  event.preventDefault();
  const shown = sortedWorkspaces.value.map((item) => String(item.id));
  let next = moveEtlWorkspace(shown, drag.sourceId, drag.overId, drag.after);
  if (!next) return;
  // 倒序显示时，保存的仍是正序。
  if (workspaceSort.value.desc) next = [...next].reverse();
  const byId = new Map(workspaces.value.map((item) => [String(item.id), item]));
  workspaces.value = next.map((id) => byId.get(id)!).filter(Boolean);
  const request = ++workspaceOrderRequest;
  try {
    const saved = unbox<EtlWorkspaceRow[]>(await saveEtlWorkspaceOrder(next));
    if (request === workspaceOrderRequest && Array.isArray(saved)) workspaces.value = saved;
  } catch (error) {
    say('error', errorMessage(error));
    if (request === workspaceOrderRequest) await refreshWorkspaces();
  }
}
function onWorkspaceDragEnd() {
  workspaceDrag.value = undefined;
}
/** 切换工作区时保留的页面状态（仅本次页面会话，内存中）。 */
interface EtlWorkspaceSession {
  activePipelineId: string;
  baseDocument?: EtlWorkspaceDocument;
  baseMeta: { description: string; name: string };
  canvasEditorOpen: boolean;
  canvasView?: EtlCanvasViewState;
  description: string;
  doc: EtlWorkspaceDocument;
  editorMode: 'json' | 'steps';
  history: EtlHistory;
  jsonText: string;
  jsonValid: boolean;
  knownRemoteRevision: number;
  latestRemoteDocument?: EtlWorkspaceDocument;
  latestRemoteMeta: { description: string; name: string };
  preferLocalUntilSave: boolean;
  previews: typeof previews.value;
  remoteRevision: number;
  saved: string;
  savedRevision: number;
  scrollTop: number;
  selectedNodeId: string;
  validationErrors: string[];
  validationWarnings: string[];
  workspaceName: string;
}
const workspaceSessions = createEtlWorkspaceSessionCache<EtlWorkspaceSession>();
const etlCanvasRef = ref<{ captureView: () => EtlCanvasViewState | undefined; restoreView: (view?: EtlCanvasViewState) => Promise<void> }>();
function taskScrollElement() {
  return document.querySelector<HTMLElement>('.workspace-main .task-scroll');
}
function captureWorkspaceSession() {
  const row = activeWorkspace.value;
  if (!row) return;
  commitDocHistory();
  docHistory.trim(ETL_SESSION_HISTORY_STEPS);
  // 存原始对象（去掉 Vue 代理），并 markRaw，避免缓存对象被深度响应式追踪。
  workspaceSessions.set(row.id, markRaw({
    activePipelineId: activePipelineId.value,
    baseDocument: rawOf(baseDocument.value),
    baseMeta: { ...baseMeta.value },
    canvasEditorOpen: canvasEditorOpen.value,
    canvasView: etlCanvasRef.value?.captureView(),
    description: row.description || '',
    doc: toRaw(doc.value),
    editorMode: editorMode.value,
    history: docHistory,
    jsonText: jsonText.value,
    jsonValid: jsonValid.value,
    knownRemoteRevision: knownRemoteRevision.value,
    latestRemoteDocument: rawOf(latestRemoteDocument.value),
    latestRemoteMeta: { ...latestRemoteMeta.value },
    preferLocalUntilSave,
    previews: trimEtlSessionPreviews(toRaw(previews.value)),
    remoteRevision: Number(row.revision) || 0,
    saved: saved.value,
    savedRevision: savedRevision.value,
    scrollTop: taskScrollElement()?.scrollTop || 0,
    selectedNodeId: selectedNodeId.value,
    validationErrors: [...validationErrors.value],
    validationWarnings: [...validationWarnings.value],
    workspaceName: row.workspaceName || '',
  }));
}
function rawOf<T>(value: T | undefined) {
  return value === undefined ? undefined : (toRaw(value) as T);
}
/**
 * 切回工作区：服务端 revision 未变时完整恢复（未保存修改、撤销历史、视图）；
 * 变了则保留刚加载 / 合并好的文档，只恢复任务、节点和画布位置等界面状态。
 */
function restoreWorkspaceSession(detail: EtlWorkspaceRow) {
  const cached = workspaceSessions.take(detail.id, Number(detail.revision) || 0);
  if (!cached) return;
  const state = cached.state;
  if (cached.full) {
    if (activeWorkspace.value) {
      activeWorkspace.value.workspaceName = state.workspaceName;
      activeWorkspace.value.description = state.description;
    }
    doc.value = state.doc;
    docHistory = state.history;
    refreshHistoryState();
    editorMode.value = state.editorMode;
    jsonText.value = state.jsonText;
    jsonValid.value = state.jsonValid;
    saved.value = state.saved;
    savedRevision.value = state.savedRevision;
    knownRemoteRevision.value = state.knownRemoteRevision;
    baseDocument.value = state.baseDocument;
    baseMeta.value = state.baseMeta;
    latestRemoteDocument.value = state.latestRemoteDocument;
    latestRemoteMeta.value = state.latestRemoteMeta;
    preferLocalUntilSave = state.preferLocalUntilSave;
    previews.value = state.previews;
    validationErrors.value = state.validationErrors;
    validationWarnings.value = state.validationWarnings;
  }
  if (doc.value.pipelines.some((item) => item.id === state.activePipelineId)) {
    activePipelineId.value = state.activePipelineId;
    if (pipeline.value?.nodes.some((item) => item.id === state.selectedNodeId)) selectedNodeId.value = state.selectedNodeId;
  }
  void nextTick(async () => {
    if (String(activeWorkspace.value?.id) !== String(detail.id)) return;
    await etlCanvasRef.value?.restoreView(state.canvasView);
    const scroller = taskScrollElement();
    if (scroller) scroller.scrollTop = state.scrollTop;
    if (cached.full && state.canvasEditorOpen && stepsView.value === 'canvas' && node.value) canvasEditorOpen.value = true;
  });
}
/** 每次打开意图都有独立代次，陈旧响应及其 finally 不允许覆盖新的工作区。 */
async function openWorkspace(
  row: EtlWorkspaceRow,
  _protect = false,
  force = false,
) {
  const request = workspaceRequests.begin();
  // 已经停在这个工作区时不要整页重开。否则会落到下拉第一项，并清掉正在看的运行日志。
  if (!force && String(activeWorkspace.value?.id) === String(row.id)) {
    cachePaused = false;
    loading.value = false;
    if (dirty.value) flushActiveDraft();
    rememberEtlWorkspace(row.id);
    // 已在本工作区时也拉一次运行，挂接他人/定时正在跑的实时日志
    void refreshRuns();
    return true;
  }
  // 在暂停缓存前同步落盘，不能依赖尚未触发的 400ms debounce。
  cachePaused = false;
  if (
    !force &&
    activeWorkspace.value &&
    String(activeWorkspace.value.id) !== String(row.id) &&
    !flushActiveDraft()
  ) {
    loading.value = false;
    return false;
  }
  if (activeWorkspace.value && String(activeWorkspace.value.id) !== String(row.id)) captureWorkspaceSession();
  if (force) workspaceSessions.delete(row.id);
  cachePaused = true;
  if (cacheTimer) {
    clearTimeout(cacheTimer);
    cacheTimer = undefined;
  }
  loading.value = true;
  try {
    const detail = unbox<EtlWorkspaceRow>(await getEtlWorkspace(row.id));
    if (!workspaceRequests.current(request)) return false;
    const document = normalizeSqlDocument(parseEtlJson(detail.draftJson || '{}'));
    suppressedPipelineIds.value = [];
    activeWorkspace.value = detail;
    doc.value = document;
    docHistory = createEtlHistory();
    resetDocHistory();
    canvasEditorOpen.value = false;
    draftConflict.value = undefined;
    editorMode.value = 'steps';
    activePipelineId.value = doc.value.pipelines[0]?.id || '';
    selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
    previews.value = {};
    runs.value = [];
    selectedRun.value = undefined;
    runLogs.value = [];
    logRequest++;
    resetLiveConsole();
    preferLocalUntilSave = false;
    validationErrors.value = [];
    validationWarnings.value = [];
    syncJson();
    markSaved();
    const serverDoc = cloneDocument(doc.value);
    rememberServerBase(serverDoc, detail);
    mergeConflicts.value = [];
    syncBlocked.value = false;
    // 本地稿永不因 revision 前进自动删除；能对齐祖先时先合并，对不齐才整份保留。
    if (force) clearEtlLocalDraft(detail.id);
    else restoreLocalDraft(detail, serverDoc);
    // 本地稿可能记下了上次任务；若该标签已关闭，则改用仍开着的第一个，而不是下拉第一项。
    activePipelineId.value = preferredOpenPipelineId(
      doc.value.pipelines,
      detail.id,
      activePipelineId.value,
    );
    if (!pipeline.value?.nodes.some((item) => item.id === selectedNodeId.value)) {
      selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
    }
    restoreWorkspaceSession(detail);
    rememberEtlWorkspace(detail.id);
    scheduleCollabPull();
    await refreshRuns();
    if (!workspaceRequests.current(request)) return false;
    return true;
  } catch (error) {
    if (workspaceRequests.current(request))
      say('error', errorMessage(error));
    return false;
  } finally {
    if (workspaceRequests.current(request)) {
      loading.value = false;
      cachePaused = false;
    }
  }
}

/** 记下当前服务端文档，作为之后三方合并的共同祖先。 */
function rememberServerBase(document: EtlWorkspaceDocument, detail: EtlWorkspaceRow) {
  baseDocument.value = cloneDocument(document);
  baseMeta.value = {
    name: detail.workspaceName || '',
    description: detail.description || '',
  };
  knownRemoteRevision.value = Number(detail.revision) || 0;
  latestRemoteDocument.value = cloneDocument(document);
  latestRemoteMeta.value = { ...baseMeta.value };
}

/** 与 snapshot 使用同一种包装，用来判断合并后是否还和某个版本不同。 */
function snapshotOf(
  document: EtlWorkspaceDocument,
  name: string,
  description: string,
  mode: 'steps' | 'json',
) {
  return JSON.stringify({
    document: mode === 'json' ? JSON.stringify(document, null, 2) : document,
    name,
    description: description || '',
  });
}

/** 从上次保存的快照里取出任务区文档，供单个任务判断是否已落库。 */
function savedWorkspaceDocument(): EtlWorkspaceDocument | undefined {
  if (!saved.value) return undefined;
  try {
    const wrapped = JSON.parse(saved.value) as {
      document?: EtlWorkspaceDocument | string;
    };
    const document = wrapped?.document;
    if (!document) return undefined;
    if (typeof document === 'string') {
      return normalizeSqlDocument(parseEtlJson(document));
    }
    return document;
  } catch {
    return undefined;
  }
}

function currentLocalDocument(): EtlWorkspaceDocument | undefined {
  if (editorMode.value !== 'json') return doc.value;
  try {
    return normalizeSqlDocument(parseEtlJson(jsonText.value));
  } catch {
    return undefined;
  }
}

/** 恢复本地稿。有共同祖先且服务端已前进时，先把对方的修改并进来。 */
function restoreLocalDraft(detail: EtlWorkspaceRow, serverDoc: EtlWorkspaceDocument) {
  const local = getEtlLocalDraft(detail.id);
  if (!local) return;
  try {
    const rawMode = local.editorMode === 'json' ? 'json' : 'steps';
    let localDoc: EtlWorkspaceDocument | undefined;
    let invalidJson = false;
    try {
      localDoc = normalizeSqlDocument(parseEtlJson(local.draftJson || '{}'));
    } catch {
      if (rawMode !== 'json') throw new Error('本地草稿格式无效');
      invalidJson = true;
      if (local.documentJson) {
        localDoc = normalizeSqlDocument(parseEtlJson(local.documentJson));
      }
    }
    const serverRevision = Number(detail.revision) || 0;
    const ancestorRevision = Number(local.baseRevision) || 0;
    if (localDoc && local.baseJson && ancestorRevision !== serverRevision && !invalidJson) {
      const ancestor = normalizeSqlDocument(parseEtlJson(local.baseJson));
      const merged = mergeEtlCollaboration({
        base: ancestor,
        local: localDoc,
        remote: serverDoc,
        baseName: local.baseName ?? local.workspaceName,
        localName: local.workspaceName || detail.workspaceName,
        remoteName: detail.workspaceName,
        baseDescription: local.baseDescription ?? local.description ?? '',
        localDescription: local.description ?? '',
        remoteDescription: detail.description || '',
      });
      applyCollaborationMerge(
        detail,
        serverDoc,
        merged,
        rawMode,
        {
          pipelineId: local.activePipelineId,
          nodeId: local.selectedNodeId,
          ancestor,
          ancestorRevision,
          ancestorName: local.baseName ?? local.workspaceName,
          ancestorDescription: local.baseDescription ?? local.description ?? '',
          // 重新打开时编辑器里暂存的是服务端稿，要以本地稿里的任务为准，只收起对方新增的任务。
          keepVisiblePipelineIds: localDoc.pipelines.map((item) => item.id),
        },
        true,
      );
      return;
    }
    if (localDoc) {
      doc.value = localDoc;
      resetDocHistory();
    }
    activeWorkspace.value = {
      ...detail,
      workspaceName: local.workspaceName || detail.workspaceName,
      description: local.description ?? detail.description,
    };
    editorMode.value = rawMode;
    activePipelineId.value = local.activePipelineId || doc.value.pipelines[0]?.id || '';
    selectedNodeId.value = local.selectedNodeId || pipeline.value?.nodes[0]?.id || '';
    if (rawMode === 'json') {
      jsonText.value = invalidJson ? local.draftJson : JSON.stringify(doc.value, null, 2);
      jsonValid.value = !invalidJson;
      syncBlocked.value = invalidJson;
    } else syncJson();
    savedRevision.value = ancestorRevision;
    if (local.baseJson && !invalidJson) {
      try {
        // 保留本地后祖先是本地稿。重新打开时不能再退回服务端文档，否则缺失节点会被当成删除。
        baseDocument.value = normalizeSqlDocument(parseEtlJson(local.baseJson));
        baseMeta.value = {
          name: local.baseName ?? local.workspaceName ?? '',
          description: local.baseDescription ?? local.description ?? '',
        };
      } catch {
        /* 祖先损坏时继续用刚打开的服务端文档。 */
      }
    }
    if (ancestorRevision !== serverRevision) draftConflict.value = detail;
    if (!dirty.value) clearEtlLocalDraft(detail.id);
  } catch {
    say('warning', '本地草稿恢复失败，缓存已保留，请导出备份后处理');
  }
}

/** 把合并结果放进编辑器。没有冲突时祖先推进到对方版本，有冲突时祖先停在原处。 */
function applyCollaborationMerge(
  detail: Pick<EtlWorkspaceRow, 'id' | 'revision' | 'workspaceName' | 'description' | 'accessRole'>,
  remoteDoc: EtlWorkspaceDocument,
  merged: ReturnType<typeof mergeEtlCollaboration>,
  mode: 'steps' | 'json',
  origin?: {
    pipelineId?: string;
    nodeId?: string;
    ancestor: EtlWorkspaceDocument;
    ancestorRevision: number;
    ancestorName: string;
    ancestorDescription: string;
    /** 这些任务保持原标签状态；没传时按替换前编辑器里的任务计算。 */
    keepVisiblePipelineIds?: string[];
  },
  hideIncoming = false,
) {
  const pipelineId = origin?.pipelineId || activePipelineId.value;
  const nodeId = origin?.nodeId || selectedNodeId.value;
  const previousPipelineIds =
    origin?.keepVisiblePipelineIds ?? doc.value.pipelines.map((item) => item.id);
  doc.value = merged.document;
  if (activeWorkspace.value) {
    activeWorkspace.value = {
      ...activeWorkspace.value,
      workspaceName: merged.name,
      description: merged.description,
      revision: detail.revision,
      accessRole: detail.accessRole || activeWorkspace.value.accessRole,
    };
  }
  editorMode.value = mode;
  activePipelineId.value = doc.value.pipelines.some((item) => item.id === pipelineId)
    ? pipelineId
    : preferredOpenPipelineId(doc.value.pipelines, detail.id);
  selectedNodeId.value = pipeline.value?.nodes.some((item) => item.id === nodeId)
    ? nodeId
    : pipeline.value?.nodes[0]?.id || '';
  if (hideIncoming) hideIncomingPipelines(previousPipelineIds);
  syncJson();
  if (mode === 'json') jsonValid.value = true;
  mergeConflicts.value = merged.conflicts;
  syncBlocked.value = false;
  draftConflict.value = undefined;
  knownRemoteRevision.value = Number(detail.revision) || 0;
  const serverName = detail.workspaceName || '';
  const serverDescription = detail.description || '';
  latestRemoteDocument.value = cloneDocument(remoteDoc);
  latestRemoteMeta.value = { name: serverName, description: serverDescription };
  if (merged.conflicts.length && origin) {
    baseDocument.value = cloneDocument(origin.ancestor);
    baseMeta.value = {
      name: origin.ancestorName,
      description: origin.ancestorDescription,
    };
    savedRevision.value = origin.ancestorRevision;
  } else {
    baseDocument.value = cloneDocument(remoteDoc);
    baseMeta.value = { name: serverName, description: serverDescription };
    savedRevision.value = knownRemoteRevision.value;
  }
  saved.value = snapshotOf(remoteDoc, serverName, serverDescription, mode);
  if (!dirty.value) clearEtlLocalDraft(detail.id);
  const listed = workspaces.value.find((item) => String(item.id) === String(detail.id));
  if (listed) listed.revision = detail.revision;
}

/** 对方新同步来的任务不占用标签栏，仍可从任务下拉打开。返回收起的数量。 */
function hideIncomingPipelines(previousIds: string[]) {
  const known = new Set(previousIds);
  const incoming = doc.value.pipelines
    .map((item) => item.id)
    .filter((id) => id && !known.has(id));
  if (!incoming.length) return 0;
  suppressedPipelineIds.value = incoming;
  return incoming.length;
}

function scheduleCollabPull() {
  if (!collabAlive) return;
  if (collabTimer) clearTimeout(collabTimer);
  collabTimer = setTimeout(() => {
    void pullRemoteWorkspace(false);
  }, COLLAB_SYNC_MS);
}

/** 立即向服务端要一次对方的保存，并按共同祖先并入本地。 */
async function syncNow() {
  if (!activeWorkspace.value || syncing.value) return;
  if (collabPulling) {
    collabFollowUp = true;
    say('info', '正在同步，请稍候');
    return;
  }
  syncing.value = true;
  try {
    await pullRemoteWorkspace(true);
  } finally {
    syncing.value = false;
  }
}

/** 对方保存后拉回新版本，和本地未保存修改按节点合并。 */
async function pullRemoteWorkspace(manual: boolean) {
  const row = activeWorkspace.value;
  if (!row) return;
  if (draftConflict.value) {
    if (manual) say('warning', '请先选择保留本地或使用服务端版本，也可导出本地备份');
    else scheduleCollabPull();
    return;
  }
  if (!manual && preferLocalUntilSave) {
    scheduleCollabPull();
    return;
  }
  if (!manual && (saving.value || loading.value || cachePaused || document.hidden)) {
    scheduleCollabPull();
    return;
  }
  if (manual && (saving.value || loading.value || cachePaused)) {
    say(
      'info',
      saving.value ? '正在保存，请稍后再同步' : '正在打开工作区，请稍后再同步',
    );
    return;
  }
  if (collabPulling) {
    if (manual) collabFollowUp = true;
    return;
  }
  if (manual) preferLocalUntilSave = false;
  collabPulling = true;
  const request = workspaceRequests.stamp();
  try {
    const sync = unbox<EtlWorkspaceSync>(
      await syncEtlWorkspace(row.id, knownRemoteRevision.value),
    );
    if (
      !workspaceRequests.current(request) ||
      String(activeWorkspace.value?.id) !== String(row.id)
    ) {
      return;
    }
    if (saving.value || loading.value || cachePaused) {
      if (manual) {
        say('info', 
          saving.value ? '正在保存，请稍后再同步' : '正在打开工作区，请稍后再同步',
        );
      }
      return;
    }
    if (!sync.changed) {
      if (sync.accessRole && activeWorkspace.value) {
        activeWorkspace.value.accessRole = sync.accessRole;
      }
      if (manual) say('success', '已是最新版本');
      return;
    }
    // 保存已经推进到更新的版本时，丢掉这次更早的响应，避免把旧稿并回来。
    if ((Number(sync.revision) || 0) < knownRemoteRevision.value) return;
    if (editorMode.value === 'json' && !jsonValid.value) {
      syncBlocked.value = true;
      if (manual) {
        say('warning', 
          'JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。',
        );
      }
      return;
    }
    const remoteDoc = normalizeSqlDocument(parseEtlJson(sync.draftJson || '{}'));
    remoteDoc.workspace = {
      id: String(row.id),
      name: sync.workspaceName || remoteDoc.workspace?.name || '',
      description: sync.description || '',
    };
    const localDoc = currentLocalDocument();
    if (!localDoc || !baseDocument.value) {
      syncBlocked.value = !localDoc;
      return;
    }
    const merged = mergeEtlCollaboration({
      base: baseDocument.value,
      local: localDoc,
      remote: remoteDoc,
      baseName: baseMeta.value.name,
      localName: activeWorkspace.value?.workspaceName || '',
      remoteName: sync.workspaceName || '',
      baseDescription: baseMeta.value.description,
      localDescription: activeWorkspace.value?.description || '',
      remoteDescription: sync.description || '',
    });
    const before = snapshot();
    const previousConflicts = mergeConflicts.value.map((item) => item.path).join('|');
    const previousPipelineIds = doc.value.pipelines.map((item) => item.id);
    applyCollaborationMerge(
      {
        id: row.id,
        revision: sync.revision,
        workspaceName: sync.workspaceName || '',
        description: sync.description || '',
        accessRole: sync.accessRole,
      },
      remoteDoc,
      merged,
      editorMode.value,
      merged.conflicts.length
        ? {
            ancestor: baseDocument.value,
            ancestorRevision: savedRevision.value,
            ancestorName: baseMeta.value.name,
            ancestorDescription: baseMeta.value.description,
          }
        : undefined,
      true,
    );
    const hiddenCount = merged.document.pipelines.filter(
      (item) => !previousPipelineIds.includes(item.id),
    ).length;
    if (snapshot() !== before) {
      say('success', 
        hiddenCount
          ? '对方的更新已并入本地，新任务在任务列表里，标签栏默认不打开'
          : '对方的更新已并入本地',
      );
    }
    else if (
      merged.conflicts.length &&
      merged.conflicts.map((item) => item.path).join('|') !== previousConflicts
    ) {
      say('warning', '对方也改了相同内容，请选择保留哪一份');
    }
  } catch (error) {
    if (manual) say('error', errorMessage(error));
  } finally {
    collabPulling = false;
    if (collabFollowUp && collabAlive && sameWorkspace(activeWorkspace.value?.id, row?.id)) {
      collabFollowUp = false;
      void pullRemoteWorkspace(true);
    } else if (collabAlive && sameWorkspace(activeWorkspace.value?.id, row?.id)) {
      scheduleCollabPull();
    }
  }
}

function conflictTitle(conflict: EtlMergeConflict) {
  const label = {
    resource: '数据源',
    variable: '变量',
    pipeline: '任务',
    'pipeline-meta': '任务属性',
    node: '节点',
    edge: '连线',
    name: '工作区名称',
    description: '工作区说明',
  }[conflict.kind];
  return `${translateUiText(label)} ${conflict.title}`.trim();
}

/** 逐项选择后祖先推进到对方版本，保存时不会把没选过的冲突直接盖掉。 */
function chooseConflict(conflict: EtlMergeConflict, choice: 'local' | 'remote') {
  if (!baseDocument.value || !activeWorkspace.value) return;
  const next = resolveEtlConflict(doc.value, baseDocument.value, conflict, choice);
  doc.value = next.document;
  baseDocument.value = next.base;
  if (conflict.kind === 'name') {
    const remoteName = String(conflict.remoteValue ?? '');
    baseMeta.value = { ...baseMeta.value, name: remoteName };
    if (choice === 'remote') activeWorkspace.value.workspaceName = remoteName;
  } else if (conflict.kind === 'description') {
    const remoteDescription = String(conflict.remoteValue ?? '');
    baseMeta.value = { ...baseMeta.value, description: remoteDescription };
    if (choice === 'remote') activeWorkspace.value.description = remoteDescription;
  } else if (choice === 'remote') {
    baseMeta.value = { ...baseMeta.value };
  }
  mergeConflicts.value = mergeConflicts.value.filter((item) => item.path !== conflict.path);
  if (!mergeConflicts.value.length && latestRemoteDocument.value) {
    baseDocument.value = cloneDocument(latestRemoteDocument.value);
    baseMeta.value = { ...latestRemoteMeta.value };
    savedRevision.value = knownRemoteRevision.value;
  }
  syncJson();
  flushActiveDraft();
}

function chooseAllConflicts(choice: 'local' | 'remote') {
  for (const conflict of [...mergeConflicts.value]) chooseConflict(conflict, choice);
}

function openShare() {
  if (!activeWorkspace.value) return;
  shareDialog.value?.open(activeWorkspace.value.id, isWorkspaceOwner.value);
}

function openShareFromMenu() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target) return;
  shareDialog.value?.open(target.id, target.accessRole !== 'EDITOR');
}

function openMergeWorkspaces() {
  if (!activeWorkspace.value) return;
  if (mergeConflicts.value.length || draftConflict.value) {
    say('warning', '请先处理协同冲突后再保存');
    return;
  }
  if (editorMode.value === 'json' && !jsonValid.value) {
    say('warning', 'JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。');
    return;
  }
  mergeDialog.value?.open();
}

function applyImportedNodes(document: EtlWorkspaceDocument, summary: string) {
  const pipelineId = document.pipelines.at(-1)?.id || activePipelineId.value;
  doc.value = normalizeSqlDocument(document);
  activePipelineId.value = doc.value.pipelines.some((item) => item.id === pipelineId)
    ? pipelineId
    : doc.value.pipelines[0]?.id || '';
  selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
  editorMode.value = 'steps';
  syncJson();
  say('success', summary || '节点已合并到当前工作区，确认后请保存');
}

/** 明确保留本地配置后才变更基准 revision；后续仍需点击保存且受服务端乐观锁保护。 */
async function keepConflictDraft() {
  const latest = draftConflict.value;
  if (!latest || !activeWorkspace.value) return;
  try {
    await ElMessageBox.confirm(
      '保留本地配置并基于服务端新版本继续编辑？下一次保存将用本地配置替换该版本。',
      '保留本地草稿',
      { type: 'warning' },
    );
    if (
      draftConflict.value !== latest ||
      String(activeWorkspace.value.id) !== String(latest.id)
    )
      return;
    activeWorkspace.value.revision = latest.revision;
    savedRevision.value = Number(latest.revision);
    knownRemoteRevision.value = Number(latest.revision) || 0;
    const localDoc = currentLocalDocument();
    if (localDoc) {
      // 祖先改成当前本地稿。之后的合并不再把“本地没有、服务端有”当成用户删除。
      baseDocument.value = cloneDocument(localDoc);
      latestRemoteDocument.value = cloneDocument(localDoc);
    }
    baseMeta.value = {
      name: activeWorkspace.value.workspaceName || '',
      description: activeWorkspace.value.description || '',
    };
    latestRemoteMeta.value = { ...baseMeta.value };
    preferLocalUntilSave = true;
    draftConflict.value = undefined;
    flushActiveDraft();
  } catch {
    /* 取消时不改变基准或本地内容。 */
  }
}

/** 保存 JSON 时统一服务端校验，步骤和手工 JSON 保持同一协议。 */
async function prepare(): Promise<boolean> {
  const request = workspaceRequests.stamp(),
    base = snapshot();
  let candidate = doc.value;
  if (editorMode.value === 'json') {
    if (!jsonValid.value) {
      say('error', 'JSON 格式错误');
      return false;
    }
    try {
      candidate = parseEtlJson(jsonText.value);
    } catch {
      say('error', 'JSON 格式错误');
      return false;
    }
  }
  const result = unbox<any>(
    await validateEtlWorkspace(JSON.stringify(candidate)),
  );
  if (!workspaceRequests.current(request) || snapshot() !== base) {
    say('info', '配置或工作区已变化，请重新操作');
    return false;
  }
  validationErrors.value = result.errors || [];
  validationWarnings.value = result.warnings || [];
  if (!result.valid) {
    say('error', result.errors[0] || '配置无效');
    return false;
  }
  doc.value = candidate;
  syncJson();
  validatedSnapshot = snapshot();
  return true;
}

/** 运行前再次读取未完成项（含被面板隐藏的草稿提示）。 */
function incompleteDraftWarnings() {
  return validationWarnings.value.filter((item) => DRAFT_INCOMPLETE.test(item));
}
async function saveDraft(asVersion = false, versionRemark = ''): Promise<boolean> {
  if (!activeWorkspace.value || saving.value) return false;
  if (mergeConflicts.value.length) {
    say('warning', '请先处理协同冲突后再保存');
    return false;
  }
  if (draftConflict.value) {
    say('warning', '请先选择保留本地或使用服务端版本，也可导出本地备份');
    return false;
  }
  if (syncBlocked.value) {
    say('warning', 'JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。');
    return false;
  }
  saving.value = true;
  const request = workspaceRequests.stamp();
  try {
    return await commitDraft(request, false, asVersion, versionRemark);
  } finally {
    saving.value = false;
  }
}

/** 保存成功后的提示。留下历史快照时带上版本号。 */
function savedMessage(retried: boolean, versionNo?: number) {
  if (versionNo) return '已保存为版本' + ' ' + versionNo;
  return retried ? '已按最新版本合并并保存' : '已保存';
}

/** 按当前已知的服务端版本保存。版本被别人推进时先合并，合并不了就停，不覆盖。 */
async function commitDraft(
  request: number,
  retried: boolean,
  asVersion = false,
  versionRemark = '',
): Promise<boolean> {
  if (!(await prepare())) return false;
  const row = activeWorkspace.value;
  if (!row) return false;
  const base = snapshot();
  const payload = jsonText.value;
  const revision = knownRemoteRevision.value || row.revision;
  try {
    const committed = unbox<EtlWorkspaceRow>(
      await saveEtlWorkspace({
        id: row.id,
        revision,
        workspaceName: row.workspaceName,
        description: row.description,
        draftJson: payload,
        saveAsVersion: asVersion || undefined,
        versionRemark: asVersion ? versionRemark : undefined,
      }),
    );
    const current = activeWorkspace.value;
    if (
      !workspaceRequests.current(request) ||
      !current ||
      !sameWorkspace(current.id, row.id)
    ) {
      // 服务端已经保存成功。切走后仍要清掉这份本地稿，并回写列表版本。
      clearEtlLocalDraft(row.id);
      preferLocalUntilSave = false;
      try {
        await refreshWorkspaces();
      } catch {
        /* 列表刷新失败不影响已经提交的版本。 */
      }
      const listed = workspaces.value.find((item) => sameWorkspace(item.id, row.id));
      if (listed) listed.revision = committed.revision;
      say('success', savedMessage(retried, committed.historyVersion));
      return true;
    }
    activeWorkspace.value = {
      ...current,
      revision: committed.revision,
    };
    savedRevision.value = Number(committed.revision);
    knownRemoteRevision.value = savedRevision.value;
    saved.value = base;
    try {
      const savedDoc = normalizeSqlDocument(parseEtlJson(payload));
      baseDocument.value = cloneDocument(savedDoc);
      latestRemoteDocument.value = cloneDocument(savedDoc);
    } catch {
      /* 刚保存的 JSON 无法回读时，下一轮同步会重新对齐祖先。 */
    }
    baseMeta.value = {
      name: activeWorkspace.value.workspaceName || '',
      description: activeWorkspace.value.description || '',
    };
    latestRemoteMeta.value = { ...baseMeta.value };
    preferLocalUntilSave = false;
    if (!dirty.value) clearEtlLocalDraft(row.id);
    else flushActiveDraft();
    await refreshWorkspaces();
    say('success', savedMessage(retried, committed.historyVersion));
    return true;
  } catch (error) {
    if (
      !retried &&
      workspaceRequests.current(request) &&
      /其他人|其他页面|revision|版本冲突|已变化|合并/.test(errorMessage(error)) &&
      activeWorkspace.value
    ) {
      const incorporated = await incorporateLatest(activeWorkspace.value.id, request);
      if (incorporated === 'clean') return commitDraft(request, true, asVersion, versionRemark);
      if (incorporated === 'conflict') {
        say('warning', '保存时遇到新版本，无冲突的修改已并入');
        return false;
      }
    }
    say('error', errorMessage(error));
    return false;
  }
}

/** 保存撞上新版本时，用共同祖先把对方的修改并进当前草稿。 */
async function incorporateLatest(
  id: string | number,
  request: number,
): Promise<'clean' | 'conflict' | 'failed'> {
  const latest = unbox<EtlWorkspaceRow>(await getEtlWorkspace(id));
  if (
    !workspaceRequests.current(request) ||
    String(activeWorkspace.value?.id) !== String(id)
  )
    return 'failed';
  const remoteDoc = normalizeSqlDocument(parseEtlJson(latest.draftJson || '{}'));
  remoteDoc.workspace = {
    id: String(id),
    name: latest.workspaceName || '',
    description: latest.description || '',
  };
  const localDoc = currentLocalDocument();
  if (!localDoc || !baseDocument.value) {
    draftConflict.value = latest;
    knownRemoteRevision.value = Number(latest.revision) || knownRemoteRevision.value;
    return 'conflict';
  }
  const merged = mergeEtlCollaboration({
    base: baseDocument.value,
    local: localDoc,
    remote: remoteDoc,
    baseName: baseMeta.value.name,
    localName: activeWorkspace.value?.workspaceName || '',
    remoteName: latest.workspaceName || '',
    baseDescription: baseMeta.value.description,
    localDescription: activeWorkspace.value?.description || '',
    remoteDescription: latest.description || '',
  });
  const ancestor = cloneDocument(baseDocument.value);
  applyCollaborationMerge(
    latest,
    remoteDoc,
    merged,
    editorMode.value,
    merged.conflicts.length
      ? {
          ancestor,
          ancestorRevision: savedRevision.value,
          ancestorName: baseMeta.value.name,
          ancestorDescription: baseMeta.value.description,
        }
      : undefined,
    true,
  );
  return merged.conflicts.length ? 'conflict' : 'clean';
}
async function changeMode(mode: 'steps' | 'json') {
  if (mode === editorMode.value) return;
  const wasDirty = dirty.value;
  if (editorMode.value === 'json' && !(await prepare())) return;
  syncJson();
  editorMode.value = mode;
  if (!wasDirty) markSaved();
  if (!pipeline.value)
    activePipelineId.value = preferredOpenPipelineId(
      doc.value.pipelines,
      activeWorkspace.value?.id || '',
    );
  if (!node.value) selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
}
async function publish() {
  if (publishing.value || running.value) return;
  if (
    liveRunId.value &&
    isActiveEtlRunStatus(String(liveRunSnapshot.value?.status || ''))
  ) {
    say(
      'warning',
      liveRunSnapshot.value?.pipelineId === '__publish__'
        ? '当前有发布预检进行中，请结束后再发布'
        : '当前有任务正在运行，请结束后再发布',
    );
    return;
  }
  const request = workspaceRequests.stamp();
  const id = activeWorkspace.value?.id;
  publishing.value = true;
  liveBatchMode.value = false;
  try {
    if (dirty.value && !(await saveDraft())) return;
    if (
      !activeWorkspace.value ||
      !workspaceRequests.current(request) ||
      !sameWorkspace(activeWorkspace.value.id, id) ||
      dirty.value
    )
      return;
    const started = unbox<EtlRun>(await publishEtlWorkspace(id!));
    if (!workspaceRequests.current(request) || !sameWorkspace(activeWorkspace.value?.id, id)) return;
    attachLiveRun(
      started,
      { id: '__publish__', name: '发布预检' },
      true,
    );
    say('info', '发布预检已开始，详情见底部日志');
    while (true) {
      if (!workspaceRequests.current(request) || !sameWorkspace(activeWorkspace.value?.id, id)) return;
      await refreshLiveLogs();
      const snap =
        liveRunSnapshot.value?.id === started.id
          ? liveRunSnapshot.value
          : unbox<EtlRun>(await getEtlRun(started.id, true));
      if (snap) {
        liveRunSnapshot.value = snap;
        if (isTerminalRunStatus(snap.status)) {
          if (snap.status === 'SUCCESS') {
            const match = String(snap.message || '').match(/版本\s*(\d+)/);
            const versionNo = match
              ? Number(match[1])
              : Number(activeWorkspace.value?.publishedVersion || 0) + 1;
            if (activeWorkspace.value && sameWorkspace(activeWorkspace.value.id, id)) {
              activeWorkspace.value = {
                ...activeWorkspace.value,
                publishedVersion: versionNo,
                status: 'PUBLISHED',
              };
            }
            say('success', snap.message || '发布成功');
            try {
              await refreshWorkspaces();
              const listed = workspaces.value.find((item) => sameWorkspace(item.id, id));
              if (listed && activeWorkspace.value && sameWorkspace(activeWorkspace.value.id, id)) {
                activeWorkspace.value = {
                  ...activeWorkspace.value,
                  revision: listed.revision ?? activeWorkspace.value.revision,
                  publishedVersion: listed.publishedVersion,
                  status: listed.status,
                };
              }
            } catch {
              /* list refresh failure must not hide a successful publish */
            }
          } else if (snap.status === 'CANCELLED') {
            say('warning', snap.message || '发布已取消');
          } else {
            say('error', snap.message || '发布预检失败');
          }
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') say('error', errorMessage(error));
  } finally {
    publishing.value = false;
  }
}

async function deleteWorkspace() {
  if (!activeWorkspace.value) return;
  try {
    await ElMessageBox.confirm('删除当前工作区？', '删除工作区', {
      type: 'warning',
    });
    const id = activeWorkspace.value.id;
    await deleteEtlWorkspace(id);
    workspaceSessions.delete(id);
    clearEtlLocalDraft(id);
    activeWorkspace.value = undefined;
    await refreshWorkspaces();
    if (workspaces.value[0]) await openWorkspace(workspaces.value[0]);
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  }
}

/** 右键或「更多」选定的工作区；更多菜单先把目标设成当前工作区。 */
const workspaceMenu = ref<{ id: string | number; x: number; y: number }>();
function openWorkspaceMenu(event: MouseEvent, workspace: EtlWorkspaceRow) {
  workspaceMenu.value = {
    id: workspace.id,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 160)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)),
  };
}
function dismissWorkspaceMenu() {
  workspaceMenu.value = undefined;
}
function menuWorkspace() {
  return workspaces.value.find(
    (item) => String(item.id) === String(workspaceMenu.value?.id),
  );
}
const menuTargetIsOwner = computed(() => menuWorkspace()?.accessRole !== 'EDITOR');
/** 丢掉目标工作区的本地未保存稿，重新加载服务端版本。 */
async function abandonLocalDraft() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target || !isWorkspaceDirty(target)) return;
  try {
    await ElMessageBox.confirm(
      '放弃本地未保存修改，恢复为服务端已保存版本？',
      '放弃本地草稿',
      { type: 'warning', confirmButtonText: '放弃', cancelButtonText: '取消' },
    );
    if (String(activeWorkspace.value?.id) === String(target.id)) {
      await openWorkspace(target, false, true);
    } else clearEtlLocalDraft(target.id);
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  }
}
/** 定时和通知按右键选中的工作区打开，不因此切换当前草稿。 */
const scheduleDialog = ref<InstanceType<typeof WorkspaceSchedule>>();
const scheduleLogsDialog = ref<InstanceType<typeof WorkspaceScheduleLogs>>();
const notifyDialog = ref<InstanceType<typeof WorkspaceNotify>>();
function configureSchedule() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (target) void scheduleDialog.value?.open(target);
}
function configureNotify() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (target) void notifyDialog.value?.open(target);
}
/** 「更多」→定时任务日志：打开本工作区触发历史抽屉。 */
function openScheduleLogsMenu() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target) return;
  void scheduleLogsDialog.value?.open(target);
}

/** 从定时触发历史打开原任务运行日志，切换工作区仍遵守未保存草稿保护。 */
async function openScheduleLogs(workspaceId: string | number, runId: string) {
  const target = workspaces.value.find(
    (item) => String(item.id) === String(workspaceId),
  );
  if (!target) {
    say('warning', '运行所属工作区不在当前列表（可能已删除），无法打开日志');
    return;
  }
  if (
    String(activeWorkspace.value?.id) !== String(workspaceId) &&
    !(await openWorkspace(target, true))
  )
    return;
  await refreshRuns();
  try {
    selectedRun.value = unbox<EtlRun>(await getEtlRun(runId));
    runsPage.value = 1;
    runsVisible.value = true;
    await refreshLogs();
  } catch (error) {
    say('error', errorMessage(error));
  }
}
async function renameWorkspace() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target) return;
  try {
    if (
      String(target.id) !== String(activeWorkspace.value?.id) &&
      !(await openWorkspace(target, true))
    )
      return;
    const { value } = await ElMessageBox.prompt('工作区名称', '改名', {
      inputValue: activeWorkspace.value?.workspaceName || target.workspaceName,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    });
    if (!activeWorkspace.value) return;
    activeWorkspace.value.workspaceName = value.trim().slice(0, 100);
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  }
}
async function deleteWorkspaceFromMenu() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target) return;
  if (String(target.id) !== String(activeWorkspace.value?.id)) {
    if (!(await openWorkspace(target, true))) return;
  }
  await deleteWorkspace();
}

/** 复制后的默认名称。后缀写进工作区名字，不随界面语言改变。 */
function suggestedCopyName(name?: string) {
  const base = (name || '').trim() || '工作区';
  const combined = `${base} 副本`;
  return combined.length <= 100 ? combined : combined.slice(0, 100);
}

/**
 * 右键或「更多」复制工作区。
 * 当前工作区有未保存修改时，可以选择把这些修改一起复制走。
 */
async function copyWorkspaceFromMenu() {
  const target = menuWorkspace() || activeWorkspace.value;
  dismissWorkspaceMenu();
  if (!target) return;
  let draftJson: string | undefined;
  const copyingActive = sameWorkspace(target.id, activeWorkspace.value?.id);
  if (copyingActive && dirty.value) {
    try {
      await ElMessageBox.confirm(
        translateUiText('当前有未保存修改。复制时要包含这些修改吗？'),
        translateUiText('复制工作区'),
        {
          type: 'warning',
          confirmButtonText: translateUiText('包含未保存修改'),
          cancelButtonText: translateUiText('只复制已保存内容'),
          distinguishCancelAndClose: true,
        },
      );
      if (editorMode.value === 'json' && !jsonValid.value) {
        say('error', 'JSON 格式错误');
        return;
      }
      draftJson = currentDraftJson();
    } catch (error: any) {
      if (error === 'cancel') draftJson = undefined;
      else return;
    }
  }
  try {
    const { value } = await ElMessageBox.prompt(
      translateUiText('新工作区名称'),
      translateUiText('复制工作区'),
      {
        inputValue: suggestedCopyName(target.workspaceName),
        inputPattern: /\S+/,
        inputErrorMessage: translateUiText('名称不能为空'),
        confirmButtonText: translateUiText('确定'),
        cancelButtonText: translateUiText('取消'),
      },
    );
    const row = unbox<EtlWorkspaceRow>(
      await copyEtlWorkspace(target.id, {
        workspaceName: value.trim().slice(0, 100),
        draftJson,
      }),
    );
    await refreshWorkspaces();
    await openWorkspace(row);
    say('success', '已复制工作区');
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') say('error', errorMessage(error));
  }
}

const historyDialog = ref<InstanceType<typeof EtlHistoryDialog>>();
const historyBusy = ref(false);

/** 「更多」里的历史版本。有未解决的协同冲突时先处理，避免切走后对不上。 */
function openHistory() {
  dismissWorkspaceMenu();
  if (!activeWorkspace.value) return;
  if (mergeConflicts.value.length || draftConflict.value) {
    say('warning', '请先处理协同冲突后再保存');
    return;
  }
  void historyDialog.value?.open(activeWorkspace.value.id);
}

/** 保存旁的下拉：先问一句说明，再按新版本保存。取消则什么都不写。 */
async function onSaveCommand(command: string) {
  if (command !== 'version' || !activeWorkspace.value || saving.value) return;
  if (mergeConflicts.value.length) {
    say('warning', '请先处理协同冲突后再保存');
    return;
  }
  if (draftConflict.value) {
    say('warning', '请先选择保留本地或使用服务端版本，也可导出本地备份');
    return;
  }
  if (syncBlocked.value) {
    say('warning', 'JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。');
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(
      translateUiText('可为这个版本写一句说明，也可以留空。'),
      translateUiText('保存为新版本'),
      {
        inputValue: '',
        confirmButtonText: translateUiText('保存'),
        cancelButtonText: translateUiText('取消'),
        inputPlaceholder: translateUiText('版本说明（可选）'),
        inputValidator: (input: string) =>
          (input || '').trim().length <= 200 ||
          translateUiText('版本说明不能超过 200 个字'),
      },
    );
    await saveDraft(true, (value || '').trim().slice(0, 200));
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') say('error', errorMessage(error));
  }
}

/** 用选中的历史快照替换当前草稿。本地未保存内容需要先确认丢掉。 */
async function restoreHistory(item: EtlHistoryVersion) {
  if (historyBusy.value || !activeWorkspace.value) return;
  try {
    await ElMessageBox.confirm(
      translateUiText('切换后当前草稿会变成这个版本。未保存的修改会丢掉，已发布的定时版本不会变。继续？'),
      translateUiText('历史版本'),
      {
        type: 'warning',
        confirmButtonText: translateUiText('切换'),
        cancelButtonText: translateUiText('取消'),
      },
    );
  } catch {
    return;
  }
  const id = activeWorkspace.value.id;
  const revision = knownRemoteRevision.value || activeWorkspace.value.revision;
  historyBusy.value = true;
  try {
    const row = unbox<EtlWorkspaceRow>(await restoreEtlHistory(id, item.id, revision));
    if (!sameWorkspace(activeWorkspace.value?.id, id)) return;
    const opened = await openWorkspace(row, false, true);
    if (!opened) return;
    historyDialog.value?.close();
    say('success', '已切换到版本' + ' ' + item.versionNo);
  } catch (error) {
    say('error', errorMessage(error));
  } finally {
    historyBusy.value = false;
  }
}

/** 「更多」作用在当前工作区，先记下目标再走和右键相同的入口。 */
function onMore(command: string) {
  if (activeWorkspace.value)
    workspaceMenu.value = { id: activeWorkspace.value.id, x: 0, y: 0 };
  if (command === 'sources') openSources();
  else if (command === 'mode')
    void changeMode(editorMode.value === 'json' ? 'steps' : 'json');
  else if (command === 'import-json') jsonInput.value?.click();
  else if (command === 'import-kettle') kettleInput.value?.click();
  else if (command === 'export') void exportJson();
  else if (command === 'runs') {
    runsPage.value = 1;
    runsStatusFilter.value = '';
    runsVisible.value = true;
    void refreshRuns();
  } else if (command === 'schedule') configureSchedule();
  else if (command === 'schedule-logs') openScheduleLogsMenu();
  else if (command === 'notify') configureNotify();
  else if (command === 'share') openShare();
  else if (command === 'merge') openMergeWorkspaces();
  else if (command === 'rename') void renameWorkspace();
  else if (command === 'copy') void copyWorkspaceFromMenu();
  else if (command === 'history') openHistory();
  else if (command === 'abandon') void abandonLocalDraft();
  else if (command === 'delete') void deleteWorkspaceFromMenu();
}

async function addPipeline(conditional = false) {
  if (editorMode.value === 'json') {
    await changeMode('steps');
    if (editorMode.value === 'json') return;
  }
  if (!resources.value.length) {
    openSources();
    return;
  }
  const item = createSqlPipeline(Object.keys(doc.value.resources), conditional);
  doc.value.pipelines.push(item);
  activePipelineId.value = item.id;
  selectedNodeId.value = item.nodes[0]!.id;
  if (conditional) say('info', '模板中的表名和字段需要改为你的实际数据结构');
}
function selectPipeline(id: string) {
  activePipelineId.value = id;
  selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
}
/**
 * 在原任务后面插入一份副本并打开它。
 * JSON 模式先回到步骤视图，避免编辑器里的文本和步骤草稿各改各的。
 */
async function copyPipeline(id: string) {
  const workspace = activeWorkspace.value?.id;
  if (editorMode.value === 'json') {
    await changeMode('steps');
    if (
      editorMode.value === 'json' ||
      !sameWorkspace(activeWorkspace.value?.id, workspace)
    )
      return;
  }
  const index = doc.value.pipelines.findIndex((item) => item.id === id);
  const source = doc.value.pipelines[index];
  if (!source) return;
  const item = duplicatePipeline(
    source,
    doc.value.pipelines.map((task) => task.name),
  );
  doc.value.pipelines.splice(index + 1, 0, item);
  activePipelineId.value = item.id;
  selectedNodeId.value = item.nodes[0]?.id || '';
  say('success', '已复制任务');
}
/** 示例只追加一个独立任务；JSON 草稿先应用，异步切换期间不得写到另一个工作区。 */
async function addExamplePipeline() {
  const workspace = activeWorkspace.value?.id;
    if (editorMode.value === 'json') { await changeMode('steps'); if (editorMode.value === 'json' || !sameWorkspace(activeWorkspace.value?.id, workspace)) return; }
  const item = createFlexibleExamplePipeline(etlId('example'));
  item.name = translateUiText(item.name); item.nodes.forEach((step) => { step.name = translateUiText(step.name || step.id); });
  doc.value.pipelines.push(item); activePipelineId.value = item.id; selectedNodeId.value = item.nodes.at(-1)?.id || '';
}
async function removePipeline(id = activePipelineId.value) {
  if (!doc.value.pipelines.some((item) => item.id === id)) return;
  const request = draftOperations.begin();
  try {
    await ElMessageBox.confirm('删除当前同步任务？', '删除任务');
    if (!draftOperations.current(request)) {
      say('info', '配置已变化，请重新删除');
      return;
    }
    doc.value.pipelines = doc.value.pipelines.filter((item) => item.id !== id);
    if (id === activePipelineId.value)
      selectPipeline(doc.value.pipelines[0]?.id || '');
  } catch {
    /* 取消保留任务。 */
  }
}
function addStep(type: 'database.query' | 'database.write' | 'transform.select') {
  if (!pipeline.value) return;
  const item: EtlNode = {
    id: etlId(type === 'database.query' ? 'query' : 'write'),
    name: translateUiText(
      type === 'database.query' ? '查询步骤' : type === 'transform.select' ? '字段处理步骤' : '写入步骤',
    ),
    type,
    typeVersion: 1,
    resourceRef: resources.value[0]?.[0],
    config:
      type === 'database.query'
        ? { sql: '', parameters: [], pageSize: 50000 }
        : {
            inputStepId:
              pipeline.value.nodes
                .filter((step) => isEtlRowSource(step.type))
                .at(-1)?.id || '',
            table: '',
            mode: 'append',
            batchSize: 2000,
            mappings: [],
            keyColumns: [],
          },
  };
  if (type === 'transform.select') {
    item.resourceRef = undefined;
    item.config = { inputStepId: item.config.inputStepId || pipeline.value.nodes.filter((step) => isEtlRowSource(step.type)).at(-1)?.id || '', fields: [], keepUnspecified: true, removeFields: [] };
  }
  pipeline.value.nodes.push(item);
  selectedNodeId.value = item.id;
  syncStepDependencies(pipeline.value, item);
}
/** 下拉只接受已经支持的查询、字段处理和写入节点。 */
function addStepCommand(type: string) {
  if (type === 'database.query' || type === 'database.write' || type === 'transform.select') { addStep(type); return; }
  const operator = ETL_OPERATORS.find((item) => item.type === type);
  if (!operator || !pipeline.value) return;
  const input = pipeline.value.nodes.filter((item) => isEtlRowSource(item.type) && item.enabled !== false).at(-1)?.id || '';
  const item: EtlNode = { id: etlId('transform'), name: translateUiText(operator.label), type, typeVersion: 1, config: createOperatorConfig(type, input) };
  // 新建断言使用当前语言的默认提示；用户后续编辑的业务提示保持原文。
  if (type === 'transform.assert') item.config.message = translateUiText(item.config.message);
  pipeline.value.nodes.push(item); selectedNodeId.value = item.id; syncStepDependencies(pipeline.value, item);
}
async function removeStep() {
  if (!pipeline.value || !node.value) return;
  const id = node.value.id;
  const request = draftOperations.begin();
  const referenced = pipeline.value.nodes.some(
    (item) =>
      etlInputReferences(item.config).includes(id),
  );
  if (referenced) {
    say('warning', '后续步骤还在引用它，请先修改参数来源或写入输入');
    return;
  }
  try {
    await ElMessageBox.confirm('删除当前步骤？', '删除步骤');
    if (!draftOperations.current(request) || !pipeline.value?.nodes.some((item) => item.id === id)) {
      say('info', '配置已变化，请重新删除');
      return;
    }
    pipeline.value.nodes = pipeline.value.nodes.filter(
      (item) => item.id !== id,
    );
    pipeline.value.edges = pipeline.value.edges.filter(
      (item) => item.source !== id && item.target !== id,
    );
    selectedNodeId.value = pipeline.value.nodes[0]?.id || '';
  } catch {
    /* 取消保留。 */
  }
}
function dependencyChanged() {
  if (pipeline.value && node.value)
    syncStepDependencies(pipeline.value, node.value);
}
function addParameter() {
  if (!node.value) return;
  node.value.config.parameters ||= [];
  node.value.config.parameters.push({
    name: '',
    stepId: '',
    column: '',
    mode: 'first',
    value: '',
  });
}
/** 参数来源：固定值 ↔ 上游步骤；切换后重建依赖边。 */
function onParamSource(param: Record<string, any>, value: string) {
  if (value === FIXED_PARAM_SOURCE) {
    delete param.variable; param.stepId = ''; param.column = ''; param.value ??= '';
  } else if (value === VARIABLE_PARAM_SOURCE) {
    param.variable = Object.keys(doc.value.variables)[0] || ''; delete param.value; param.stepId = ''; param.column = '';
  } else {
    delete param.variable; delete param.value; param.stepId = value; param.mode = param.mode || 'first';
  }
  dependencyChanged();
}
/** 删除参数时也删除其自动依赖，保留其他参数和手工连线。 */
function removeParameter(index: number) {
  if (!node.value) return;
  node.value.config.parameters.splice(index, 1);
  dependencyChanged();
}
function addMapping() {
  if (!node.value) return;
  node.value.config.mappings ||= [];
  node.value.config.mappings.push({ source: '', target: '' });
}

/** 预览前按参数和输入引用补齐依赖，避免只拿当前 SQL、漏掉前面的水位查询。 */
function syncPipelineDependencies() {
  if (!pipeline.value) return;
  for (const step of pipeline.value.nodes) syncStepDependencies(pipeline.value, step);
}

/** 查询预览会先执行参数所依赖的上游查询，再把结果传入当前 SQL。 */
async function preview() {
  if (node.value) await previewQuery(node.value.id);
}
/** 写入配置可直接预览输入并加载字段，不需要来回切换查询/写入步骤。 */
async function previewInput() {
  const id = node.value?.config.inputStepId;
  if (!id) {
    say('warning', '先选择输入查询步骤');
    return;
  }
  await previewQuery(id);
}
/** 固定配置快照，拒绝把旧请求的结果展示在修改后的 SQL 上。 */
async function previewQuery(id: string) {
  if (!pipeline.value) return;
  const request = workspaceRequests.stamp();
  const previewRequest = previewRequests.begin();
  const pipelineId = pipeline.value.id;
  abortPreviewRequest();
  const controller = new AbortController();
  previewAbort = controller;
  previewing.value = true;
  syncPipelineDependencies();
  syncJson();
  const base = JSON.stringify(doc.value);
  const current = () => previewRequests.current(previewRequest) && workspaceRequests.current(request) && pipeline.value?.id === pipelineId && !controller.signal.aborted;
  try {
    // 单任务预览只上传当前任务及其上游步骤/资源/变量，不传整个工作区其它任务
    const previewJson = buildEtlPreviewJson(doc.value, pipelineId, id);
    const result = unbox<any>(await previewEtlStep(previewJson, pipelineId, id, controller.signal));
    if (!current()) return;
    if (base !== JSON.stringify(doc.value)) { say('info', '配置已修改，请重新预览'); return; }
    previews.value[id] = result;
    queryColumns.value = { ...queryColumns.value, ...(result.upstreamColumns || {}), [id]: result.columns };
    say('success', '步骤预览成功');
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) return;
    if (current()) say('error', errorMessage(error));
  } finally {
    // 旧请求结束不能解除新请求的 loading，也不能把另一任务的同名步骤结果写入当前任务。
    if (previewRequests.latest(previewRequest)) previewing.value = false;
  }
}

/** 换到另一个工作区后不再跟踪上一个工作区的实时日志。首次进入不清理。 */
watch(
  () => activeWorkspace.value?.id,
  (id, previous) => {
    if (previous == null || String(previous) === String(id ?? '')) return;
    resetLiveConsole();
  },
);

/** 任务内步骤 ID 可重复于另一任务，切换任务必须清理预览和字段目录并废弃在途请求。 */
watch(activePipelineId, () => {
  abortPreviewRequest();
  previewRequests.invalidate(); previewing.value = false;
  previews.value = {}; queryColumns.value = {};
}, { flush: 'sync' });

function inputColumns() {
  return queryColumns.value[node.value?.config.inputStepId || ''] || [];
}
/** 来源字段选项只建一份。每个映射行再挂一份 el-option 时，字段数会变成平方级节点。 */
const sourceColumnOptions = computed(() =>
  inputColumns().map((column) => ({ value: column, label: column })),
);
const mappingTargetOptions = computed(() => {
  const mappings = node.value?.config?.mappings;
  if (!Array.isArray(mappings)) return [];
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const mapping of mappings) {
    const target = String(mapping?.target || '').trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    options.push({ value: target, label: target });
  }
  return options;
});
const catalogTableOptions = computed(() =>
  catalog.value
    .map((table) => String(table.qualifiedName || table.tableName || ''))
    .filter(Boolean)
    .map((name) => ({ value: name, label: name })),
);
/**
 * 字段映射行高。一次只挂载视口内的行，避免几百个下拉框同时创建。
 */
const MAPPING_ROW_HEIGHT = 42;
const MAPPING_VIEWPORT_FALLBACK = 420;
const mappingScrollTop = ref(0);
const mappingViewport = ref<HTMLElement>();
const mappingViewportPx = ref(0);
let mappingResizeObserver: ResizeObserver | null = null;
const mappingCount = computed(() =>
  Array.isArray(node.value?.config?.mappings)
    ? node.value.config.mappings.length
    : 0,
);
function disconnectMappingResizeObserver() {
  mappingResizeObserver?.disconnect();
  mappingResizeObserver = null;
}
function bindMappingResizeObserver(el: HTMLElement | null | undefined) {
  disconnectMappingResizeObserver();
  if (!el) {
    mappingViewportPx.value = 0;
    return;
  }
  mappingResizeObserver = new ResizeObserver((entries) => {
    const height = entries[0]?.contentRect?.height ?? el.clientHeight;
    mappingViewportPx.value = Math.max(0, Math.round(height));
  });
  mappingResizeObserver.observe(el);
  mappingViewportPx.value = el.clientHeight;
}
watch(mappingViewport, (el) => {
  bindMappingResizeObserver(el);
});
const visibleMappingRows = computed(() => {
  const mappings = node.value?.config?.mappings;
  if (!Array.isArray(mappings) || !mappings.length) return [];
  const viewportH =
    mappingViewportPx.value > 0
      ? mappingViewportPx.value
      : MAPPING_VIEWPORT_FALLBACK;
  const start = Math.max(
    0,
    Math.floor(mappingScrollTop.value / MAPPING_ROW_HEIGHT) - 4,
  );
  const end = Math.min(
    mappings.length,
    start + Math.ceil(viewportH / MAPPING_ROW_HEIGHT) + 8,
  );
  const rows: { index: number; offset: number; mapping: any }[] = [];
  for (let index = start; index < end; index++) {
    rows.push({
      index,
      offset: index * MAPPING_ROW_HEIGHT,
      mapping: mappings[index],
    });
  }
  return rows;
});
function onMappingScroll(event: Event) {
  mappingScrollTop.value = (event.target as HTMLElement).scrollTop;
}
/** 输入样本列太多时先显示一部分，避免切步骤时把整张宽表画出来。 */
const SAMPLE_COLUMN_LIMIT = 24;
const showWideSample = ref(false);
const sampleColumns = computed(() => {
  const columns = inputPreview.value?.columns || [];
  if (showWideSample.value || columns.length <= SAMPLE_COLUMN_LIMIT) {
    return columns;
  }
  return columns.slice(0, SAMPLE_COLUMN_LIMIT);
});
watch(
  () => node.value?.id,
  () => {
    mappingScrollTop.value = 0;
    showWideSample.value = false;
    if (mappingViewport.value) mappingViewport.value.scrollTop = 0;
  },
);
function autoMapping() {
  if (!node.value) return;
  const columns = inputColumns();
  if (!columns.length) {
    say('info', '先预览输入查询，或保持映射为空使用结果同名字段');
    return;
  }
  node.value.config.mappings = columns.map((column) => ({
    source: column,
    target: column,
  }));
}

/** 修改查询后保留结果供对照但标为过期；自动映射不能使用旧字段目录。 */
watch(
  () =>
    JSON.stringify({
      resources: doc.value.resources,
      variables: doc.value.variables,
      pipelines: doc.value.pipelines.map((item) => ({
        id: item.id,
        edges: item.edges,
        queries: item.nodes.filter((step) => isEtlRowSource(step.type)),
      })),
    }),
  () => {
    previews.value = Object.fromEntries(
      Object.entries(previews.value).map(([id, result]) => [
        id,
        { ...result, stale: true },
      ]),
    );
    queryColumns.value = {};
    previewRequests.invalidate(); previewing.value = false;
  },
);

/** 停用任务后端会直接拒绝，运行前提示，避免先保存再失败。 */
function ensurePipelineRunnable() {
  if (pipeline.value?.enabled === false) {
    say('warning', '当前任务已停用，请先启用后再运行');
    return false;
  }
  return true;
}

/**
 * 右键把一个任务退回上次保存的内容。
 * 只替换该任务，其它任务和未保存的 JSON 草稿保持不变。
 */
async function restorePipeline(id: string) {
  const workspace = activeWorkspace.value?.id;
  const source = editorMode.value === 'json' ? readEditorDocument() : doc.value;
  if (!source || !savedWorkspaceDocument()?.pipelines.some((item) => item.id === id)) {
    if (source) say('warning', '这个任务还没有保存过的版本，请用删除任务放弃它');
    return;
  }
  const name = source.pipelines.find((item) => item.id === id)?.name || id;
  const request = draftOperations.begin();
  try {
    await ElMessageBox.confirm(
      `还原将放弃任务「${name}」上未保存的修改，其他任务保持不变。`,
      '还原任务',
      { type: 'warning', confirmButtonText: '还原', cancelButtonText: '取消' },
    );
    if (
      !draftOperations.current(request) ||
      !sameWorkspace(activeWorkspace.value?.id, workspace)
    ) {
      say('info', '配置已变化，请重新还原');
      return;
    }
    const latest = editorMode.value === 'json' ? readEditorDocument() : doc.value;
    if (!latest) return;
    doc.value = restoreSavedPipeline(latest, savedWorkspaceDocument(), id);
    if (activePipelineId.value === id) {
      selectedNodeId.value =
        doc.value.pipelines.find((item) => item.id === id)?.nodes[0]?.id || '';
      previews.value = {};
      queryColumns.value = {};
    }
    syncJson();
    say('success', '已还原当前任务');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') say('error', errorMessage(error));
  }
}

/** 右键菜单启用/停用任务，只改当前草稿。 */
function setPipelineEnabled(id: string, enabled: boolean) {
  const task = doc.value.pipelines.find((item) => item.id === id);
  if (!task || (task.enabled !== false) === enabled) return;
  task.enabled = enabled;
}

function formatLogTime(value?: number) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString();
}

/** 实时日志里的步骤名来自本次运行快照，不用当前草稿名称顶替历史。 */
function liveNodeName(nodeId?: string) {
  if (!nodeId) return '';
  try {
    const steps = JSON.parse(liveRunSnapshot.value?.stepsJson || '[]');
    return (
      steps.find((step: { nodeId?: string; nodeName?: string }) => step.nodeId === nodeId)
        ?.nodeName || nodeId
    );
  } catch {
    return nodeId;
  }
}

/**
 * 按页把新日志并进已显示的记录。接口每页 50 条且新的在前。
 * 若这一轮新增超过一页，继续往前翻，直到和已有记录接上，避免实时区只剩最新 50 条。
 */
async function loadNewLiveLogs(id: string, request: number) {
  const known = new Set(
    liveLogs.value.map((item) => item.batchKey || `${item.runId || id}:${item.id}`),
  );
  const incoming: any[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (incoming.length < total && page <= 20) {
    const response: any = unbox(await listEtlRunLogs(id, page));
    if (request !== liveLogRequest || id !== liveRunId.value) return;
    const records = response?.records || [];
    total = Number(response?.total ?? records.length);
    if (!records.length) break;
    let overlapped = false;
    for (const record of records) {
      const tagged = liveLogTagTask
        ? tagBatchLogLine(record, liveLogTagTask, id)
        : { ...record, runId: id, batchKey: `${id}:${record.id}` };
      const key = tagged.batchKey;
      if (known.has(key)) {
        overlapped = true;
        continue;
      }
      if (!incoming.some((item) => item.batchKey === key)) incoming.push(tagged);
    }
    if (overlapped && known.size) break;
    if (records.length < 50) break;
    page += 1;
  }
  if (!incoming.length) return false;
  const incomingKeys = new Set(incoming.map((item) => item.batchKey));
  liveLogs.value = [
    ...incoming,
    ...liveLogs.value.filter(
      (item) => !incomingKeys.has(item.batchKey || `${item.runId || id}:${item.id}`),
    ),
  ].slice(0, 2000);
  return true;
}

/**
 * 拉取当前运行状态，并把新日志接到已有记录后面。
 * 用户停在底部时才自动滚到最新一行，往上翻阅时不打断。
 */
async function refreshLiveLogs() {
  if (!liveRunId.value) return;
  const id = liveRunId.value;
  const request = ++liveLogRequest;
  const body = liveLogBody.value;
  const followTail =
    !body || body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  try {
    const run = unbox<EtlRun>(await getEtlRun(id, true));
    if (request !== liveLogRequest || id !== liveRunId.value) return;
    liveRunSnapshot.value = run;
    if (selectedRun.value?.id === id) selectedRun.value = run;
    const changed = await loadNewLiveLogs(id, request);
    if (changed && followTail && liveConsoleOpen.value) {
      await nextTick();
      if (liveLogBody.value) liveLogBody.value.scrollTop = liveLogBody.value.scrollHeight;
    }
  } catch {
    /* 某一轮日志拉取失败不打断编辑，下一轮再取。 */
  }
}

function openLiveHistory() {
  if (liveRunSnapshot.value) selectedRun.value = liveRunSnapshot.value;
  runsPage.value = 1;
  runsVisible.value = true;
  void refreshRuns(true);
}

async function cancelLiveRun() {
  if (liveBatchMode.value) {
    if (!canCancelLiveRun.value && !running.value) {
      say('warning', '只有工作区所有者或任务发起人可以取消');
      return;
    }
    batchCancelRequested = true;
  }
  if (!liveRunSnapshot.value) return;
  if (!canCancelLiveRun.value) {
    say('warning', '只有工作区所有者或任务发起人可以取消');
    return;
  }
  selectedRun.value = liveRunSnapshot.value;
  await cancelRun();
}

/** 运行只提交保存后的工作区与任务 ID，完整预检在后端完成。只执行当前任务。 */
async function runPipeline() {
  if (!pipeline.value || !activeWorkspace.value || running.value || publishing.value) {
    if (publishing.value) say('warning', '发布预检进行中，请稍后再运行');
    return;
  }
  if (!ensurePipelineRunnable()) return;
  const request = workspaceRequests.stamp();
  const workspaceId = activeWorkspace.value.id;
  const pipelineId = pipeline.value.id;
  running.value = true;
  try {
    if (dirty.value && !(await saveDraft())) return;
    if (
      !workspaceRequests.current(request) ||
      !sameWorkspace(activeWorkspace.value.id, workspaceId) ||
      pipeline.value?.id !== pipelineId ||
      dirty.value
    )
      return;
    const base = snapshot();
    const revision = activeWorkspace.value.revision;
    // 校验和写入确认期间切换工作区/任务或继续修改时，不得将授权套用到另一份配置。
    const stillCurrent = () =>
      workspaceRequests.current(request) &&
      snapshot() === base &&
      sameWorkspace(activeWorkspace.value?.id, workspaceId) &&
      pipeline.value?.id === pipelineId &&
      activeWorkspace.value?.revision === revision;
    // 空 SQL/目标表仅警告不阻断保存。运行前只拦当前任务，其它草稿不参与。
    const result = unbox<any>(
      await validateEtlWorkspace(JSON.stringify(doc.value), pipelineId),
    );
    if (!stillCurrent()) {
      say('info', '配置或工作区已变化，请重新运行');
      return;
    }
    validationErrors.value = result.errors || [];
    validationWarnings.value = result.warnings || [];
    validatedSnapshot = snapshot();
    if (!result.valid) {
      say('error', result.errors?.[0] || '配置无效');
      return;
    }
    const incomplete = incompleteDraftWarnings();
    if (incomplete.length) {
      say('warning', incomplete[0]);
      return;
    }
    await ElMessageBox.confirm(
      '运行当前任务？写入步骤将修改目标表数据。每个写入步骤单独提交事务。',
      '运行同步任务',
      { type: 'warning', confirmButtonText: '运行' },
    );
    if (!stillCurrent()) {
      say('info', '配置或工作区已变化，请重新确认运行');
      return;
    }
    const started = unbox<EtlRun>(
      await executeEtlWorkflow(workspaceId, pipelineId, revision),
    );
    if (!workspaceRequests.current(request)) return;
    // 退出「全部任务」批次态，避免标题仍显示上一轮全部运行摘要
    liveBatchMode.value = false;
    liveBatchItems.value = [];
    batchCancelRequested = false;
    attachLiveRun(
      started,
      { id: pipelineId, name: pipeline.value?.name || pipelineId },
      true,
    );
    // attachLiveRun already set current task tag; do not clear
    await refreshRuns();
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  } finally {
    running.value = false;
  }
}

/** 把已提交的运行挂到实时日志区；全部运行时不清空已有任务日志。 */
function attachLiveRun(started: EtlRun, task: { id: string; name: string }, clearLogs: boolean) {
  selectedRun.value = started;
  liveRunSnapshot.value = started;
  liveRunId.value = started.id;
  liveLogTagTask = task;
  if (clearLogs) liveLogs.value = [];
  liveConsoleOpen.value = true;
}

/**
 * 进入工作区 / 轮询时：若本地不是发起方（未 running/publishing），
 * 自动挂接本区进行中的运行（含定时触发、发布预检、全部运行当前步）。
 * 旁观者只跟日志，不置 running/publishing，不挡发起方操作。
 */
function maybeAttachActiveLiveRun(items: EtlRun[]) {
  if (running.value || publishing.value) return;
  const currentId = liveRunId.value;
  if (currentId) {
    const current =
      items.find((item) => item.id === currentId) || liveRunSnapshot.value;
    if (current && isActiveEtlRunStatus(current.status)) {
      if (current.id === currentId && liveRunSnapshot.value?.id === currentId) {
        liveRunSnapshot.value = {
          ...liveRunSnapshot.value,
          ...current,
        };
      }
      return;
    }
  }
  const picked = pickActiveEtlRun(items);
  if (!picked) return;
  if (currentId === picked.id) return;
  attachLiveRun(
    picked,
    {
      id: picked.pipelineId || picked.id,
      name:
        picked.pipelineName ||
        (picked.pipelineId === '__publish__'
          ? '发布预检'
          : picked.pipelineId || picked.id),
    },
    true,
  );
}

function patchBatchItem(
  pipelineId: string,
  patch: Partial<EtlBatchItem>,
) {
  liveBatchItems.value = liveBatchItems.value.map((item) =>
    item.pipelineId === pipelineId ? { ...item, ...patch } : item,
  );
}

/**
 * 提交单个任务后轮询到终态。失败/取消抛错，供全部运行编排跳过后续。
 */
async function executeAndWaitPipeline(
  workspaceId: string | number,
  pipelineId: string,
  revision: number,
  task: { id: string; name: string },
  stillCurrent: () => boolean,
  clearLogs: boolean,
): Promise<EtlRun> {
  const started = unbox<EtlRun>(
    await executeEtlWorkflow(workspaceId, pipelineId, revision),
  );
  if (!stillCurrent()) throw new Error('配置或工作区已变化');
  attachLiveRun(started, task, clearLogs);
  patchBatchItem(pipelineId, {
    runId: started.id,
    status: 'RUNNING',
    message: started.message,
  });
  while (true) {
    if (!stillCurrent()) throw new Error('配置或工作区已变化');
    if (batchCancelRequested) {
      try {
        await cancelEtlRun(started.id);
      } catch {
        /* ignore cancel transport errors */
      }
    }
    await refreshLiveLogs();
    const snap =
      liveRunSnapshot.value?.id === started.id
        ? liveRunSnapshot.value
        : unbox<EtlRun>(await getEtlRun(started.id, true));
    if (snap) {
      liveRunSnapshot.value = snap;
      patchBatchItem(pipelineId, {
        status: (isTerminalRunStatus(snap.status)
          ? snap.status
          : 'RUNNING') as EtlBatchItem['status'],
        message: snap.message,
      });
      if (isTerminalRunStatus(snap.status)) {
        if (snap.status === 'SUCCESS') return snap;
        const err: any = new Error(snap.message || snap.status || '任务未成功');
        err.runStatus = snap.status;
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** 顶部工具栏：按工作区任务定义顺序，逐个运行全部启用任务。 */
async function runAllPipelines() {
  if (!activeWorkspace.value || running.value || publishing.value) {
    if (publishing.value) say('warning', '发布预检进行中，请稍后再运行');
    return;
  }
  if (editorMode.value === 'json') {
    say('warning', '请先回到步骤视图再运行');
    return;
  }
  const enabled = listEnabledBatchTasks(doc.value.pipelines);
  if (!enabled.length) {
    say('warning', '没有可运行的启用任务');
    return;
  }
  const disabledCount = doc.value.pipelines.length - enabled.length;
  const request = workspaceRequests.stamp();
  const workspaceId = activeWorkspace.value.id;
  running.value = true;
  batchCancelRequested = false;
  try {
    if (dirty.value && !(await saveDraft())) return;
    if (
      !workspaceRequests.current(request) ||
      !sameWorkspace(activeWorkspace.value.id, workspaceId) ||
      dirty.value
    )
      return;
    const base = snapshot();
    const revision = activeWorkspace.value.revision;
    const stillCurrent = () =>
      workspaceRequests.current(request) &&
      snapshot() === base &&
      sameWorkspace(activeWorkspace.value?.id, workspaceId) &&
      activeWorkspace.value?.revision === revision;
    const result = unbox<any>(await validateEtlWorkspace(JSON.stringify(doc.value)));
    if (!stillCurrent()) {
      say('info', '配置或工作区已变化，请重新运行');
      return;
    }
    validationErrors.value = result.errors || [];
    validationWarnings.value = result.warnings || [];
    validatedSnapshot = snapshot();
    if (!result.valid) {
      say('error', result.errors?.[0] || '配置无效');
      return;
    }
    const incomplete = incompleteDraftWarnings();
    if (incomplete.length) {
      say('warning', incomplete[0]);
      return;
    }
    await ElMessageBox.confirm(
      buildRunAllConfirmMessage(enabled.length, disabledCount),
      '运行全部启用任务',
      { type: 'warning', confirmButtonText: '运行全部' },
    );
    if (!stillCurrent()) {
      say('info', '配置或工作区已变化，请重新确认运行');
      return;
    }
    liveBatchMode.value = true;
    liveBatchItems.value = enabled.map((task) => ({
      pipelineId: task.id,
      pipelineName: task.name || task.id,
      status: 'PENDING' as const,
    }));
    liveLogs.value = [];
    liveConsoleOpen.value = true;
    liveRunId.value = '';
    liveRunSnapshot.value = undefined;
    liveLogTagTask = undefined;

    const batch = await runBatchSequentially({
      tasks: enabled.map((task) => ({
        id: task.id,
        name: task.name || task.id,
      })),
      isCancelRequested: () => batchCancelRequested,
      shouldContinue: stillCurrent,
      onItemStart: (task) => {
        patchBatchItem(task.id, { status: 'RUNNING', message: '提交中' });
      },
      onSkipRemaining: (task, _index, reason) => {
        patchBatchItem(task.id, {
          status: reason === 'cancel' ? 'CANCELLED' : 'SKIPPED',
          message: reason === 'cancel' ? '已取消，未启动' : '前置任务失败，已跳过',
        });
      },
      runOne: async (task) => {
        if (!stillCurrent()) throw new Error('配置或工作区已变化');
        return await executeAndWaitPipeline(
          workspaceId,
          task.id,
          revision,
          task,
          stillCurrent,
          false,
        );
      },
      onItemDone: (task, _index, outcome) => {
        if (outcome.ok) {
          patchBatchItem(task.id, {
            status: 'SUCCESS',
            message: outcome.value.message,
            runId: outcome.value.id,
          });
          return;
        }
        const status =
          (outcome.error as any)?.runStatus === 'CANCELLED' || batchCancelRequested
            ? 'CANCELLED'
            : 'FAILED';
        patchBatchItem(task.id, {
          status,
          message:
            status === 'CANCELLED'
              ? '已取消'
              : String((outcome.error as any)?.message || 'FAILED'),
        });
      },
    });

    if (!workspaceRequests.current(request)) return;
    await refreshRuns();
    const summary = summarizeBatch(liveBatchItems.value);
    if (batch.cancelled || batchCancelRequested) {
      say(
        'warning',
        `全部运行已取消：成功 ${summary.success} · 跳过 ${summary.skipped + summary.cancelled}`,
      );
    } else if (batch.failed || summary.failed) {
      say(
        'error',
        `全部运行中断：成功 ${summary.success} · 失败 ${summary.failed} · 跳过 ${summary.skipped}`,
      );
    } else {
      say('success', `全部启用任务已完成：${summary.success}/${summary.total}`);
    }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  } finally {
    running.value = false;
  }
}


/** 进行中的实时日志要继续轮询；离开页面或已经换了工作区则停止。 */
/** 进行中的实时日志要轮询；离开页面或已经换了工作区则停止。 */
function scheduleLivePoll(workspaceId?: string | number) {
  if (!pageAlive || pollTimer) return;
  const sameWs =
    workspaceId == null ||
    String(workspaceId) === String(activeWorkspace.value?.id ?? '');
  // 不再把空 status 当成“继续轮询”，避免 getEtlRun 失败时死循环打 listRuns。
  if (
    sameWs &&
    liveRunId.value &&
    isActiveEtlRunStatus(liveRunSnapshot.value?.status)
  ) {
    pollTimer = setTimeout(() => void refreshRuns(), 1500);
  }
}

/**
 * 工作区运行列表 + 旁观者挂载 + 实时日志。
 * 性能：已挂活跃运行时多数轮询只拉 getEtlRun/logs；隔几轮再 listRuns 发现定时/更高优先级。
 * 发起方 publishing/running 的 while 循环已在拉日志，这里跳过 refreshLiveLogs 避免双倍请求。
 */
async function refreshRuns(forceList = false) {
  if (forceList) refreshRunsForceList = true;
  if (refreshRunsTail) {
    refreshRunsQueued = true;
    return refreshRunsTail;
  }
  refreshRunsTail = (async () => {
    try {
      do {
        refreshRunsQueued = false;
        const force = refreshRunsForceList;
        refreshRunsForceList = false;
        await refreshRunsOnce(force);
      } while (refreshRunsQueued && pageAlive);
    } finally {
      // 漏掉 finally 窗口里新排队的一次可接受：下一轮 1.5s 轮询会补上，避免与并发调用双开。
      refreshRunsTail = undefined;
    }
  })();
  return refreshRunsTail;
}

async function refreshRunsOnce(forceList = false) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  if (!pageAlive || !activeWorkspace.value) return;
  const request = workspaceRequests.stamp();
  const workspaceId = activeWorkspace.value.id;
  const stillCurrent = () =>
    pageAlive &&
    workspaceRequests.current(request) &&
    sameWorkspace(workspaceId, activeWorkspace.value?.id);

  try {
    // 仅发布 / 全部运行的 wait-loop 自己拉日志；单任务运行仍靠 refreshRuns 轮询。
    const ownerWaitLoop = publishing.value || (running.value && liveBatchMode.value);
    let liveActive =
      !!liveRunId.value &&
      isActiveEtlRunStatus(liveRunSnapshot.value?.status);
    const discovery = nextEtlLiveDiscoverTick({
      forceList,
      liveActive,
      discoverTick: liveDiscoverTick,
    });
    liveDiscoverTick = discovery.nextTick;

    let items = runs.value;
    if (discovery.discover) {
      items = unbox<EtlRun[]>(await listEtlRuns(workspaceId)) || [];
      if (!stillCurrent()) {
        scheduleLivePoll(workspaceId);
        return;
      }
      runs.value = items;
      if (selectedRun.value)
        selectedRun.value =
          items.find((item) => item.id === selectedRun.value?.id) ||
          selectedRun.value;
      if (liveRunId.value) {
        const matched = items.find((item) => item.id === liveRunId.value);
        if (matched) liveRunSnapshot.value = matched;
      }
      maybeAttachActiveLiveRun(items);
      liveActive =
        !!liveRunId.value &&
        isActiveEtlRunStatus(liveRunSnapshot.value?.status);
    }

    if (runsVisible.value && selectedRun.value) await refreshLogs();

    // 发起方 wait-loop 已在 refreshLiveLogs；旁观者/单任务轮询才在这里拉。
    // 仅活跃运行拉日志，结束后不再每 1.5s 重拉终态日志。
    if (liveRunId.value && !ownerWaitLoop && liveActive) {
      await refreshLiveLogs();
      if (!stillCurrent()) {
        scheduleLivePoll(workspaceId);
        return;
      }
      liveActive =
        !!liveRunId.value &&
        isActiveEtlRunStatus(liveRunSnapshot.value?.status);
    }

    if (!stillCurrent()) {
      scheduleLivePoll(workspaceId);
      return;
    }
    const anyActive =
      liveActive ||
      items.some((item) => isActiveEtlRunStatus(item.status));
    if (anyActive) pollTimer = setTimeout(() => void refreshRuns(), 1500);
  } catch {
    scheduleLivePoll(workspaceId);
  }
}

async function cancelRun() {
  if (!selectedRun.value) return;
  if (
    !canCancelEtlRun({
      run: selectedRun.value,
      currentUserId: userStore.userInfo?.userId,
      isWorkspaceOwner: isWorkspaceOwner.value,
    })
  ) {
    say('warning', '只有工作区所有者或任务发起人可以取消');
    return;
  }
  try {
    await cancelEtlRun(selectedRun.value.id);
    await refreshRuns();
  } catch (error) {
    say('error', errorMessage(error));
  }
}
function statusLabel(status: string) {
  const label =
    (
      {
        PENDING: '等待',
        VALIDATING: '预检中',
        SKIPPED: '已跳过',
        DISABLED: '已停用',
        RUNNING: '运行中',
        SUCCESS: '成功',
        FAILED: '失败',
        CANCELLED: '已取消',
        INTERRUPTED: '中断 · 待核对',
      } as Record<string, string>
    )[status] || status;
  return translateUiText(label);
}
async function openSources() {
  if (editorMode.value === 'json') {
    await changeMode('steps');
    if (editorMode.value === 'json') return;
  }
  sourceDraft.value = JSON.parse(JSON.stringify(doc.value.resources));
  sourcesVisible.value = true;
}
function applySources() {
  const labels = Object.values(sourceDraft.value).map((item) =>
    item.displayName?.trim(),
  );
  if (
    labels.some((label) => !label) ||
    new Set(labels).size !== labels.length
  ) {
    say('warning', '数据源别名必须非空且不重复');
    return;
  }
  doc.value.resources = sourceDraft.value;
  sourcesVisible.value = false;
}

/** 表目录键：连接、实例、schema。与数据库客户端的 IndexedDB 缓存按同一地址共用。 */
function catalogScopeKey(source?: {
  dbConfigId?: number | string;
  instance?: string;
  schema?: string;
}) {
  if (!source?.dbConfigId || !source.instance) return '';
  return JSON.stringify([
    String(source.dbConfigId),
    source.instance,
    source.schema || '',
  ]);
}

/**
 * 加载当前步骤可用表。
 * 默认走 getTables 的 IndexedDB 缓存；同范围切换步骤直接复用内存。
 * refresh 先清掉该实例（或 schema）的共享缓存，再向数据库重新拉取。
 */
async function loadCatalog(refresh = false) {
  const request = ++catalogRequest;
  const source = nodeResource.value;
  const key = catalogScopeKey(source);
  if (!key || !source?.dbConfigId || !source.instance) {
    catalog.value = [];
    catalogScope.value = '';
    catalogSearch.value = '';
    catalogLoading.value = false;
    return;
  }
  if (!refresh && catalogScope.value === key) return;
  if (catalogScope.value !== key) {
    catalog.value = [];
    catalogSearch.value = '';
    catalogScope.value = '';
  }
  catalogLoading.value = true;
  try {
    if (refresh) {
      await clearDatabaseMetadataCache(
        source.dbConfigId,
        source.instance,
        source.schema || undefined,
      );
    }
    if (request !== catalogRequest) return;
    const tables =
      unbox<any[]>(await getTables(source.dbConfigId, source.instance)) || [];
    if (request !== catalogRequest) return;
    catalog.value = source.schema
      ? tables.filter((item) => item.schemaName === source.schema)
      : tables;
    catalogScope.value = key;
  } catch (error) {
    if (request === catalogRequest) say('error', errorMessage(error));
  } finally {
    if (request === catalogRequest) catalogLoading.value = false;
  }
}

/** 切换步骤只在数据源变化时重新取表，避免每次都打全库表目录。 */
watch(
  () => [
    node.value?.id,
    nodeResource.value?.dbConfigId,
    nodeResource.value?.instance,
    nodeResource.value?.schema,
  ],
  () => {
    tableInsertRequests.invalidate();
    catalogInserting.value = '';
    void loadCatalog(false);
  },
);
/** 按数据库族给标识符加引号，避免保留字与大小写问题。 */
function quoteIdent(part: string) {
  const family = nodeResource.value?.family;
  if (family === 'MYSQL_LIKE') return `\`${part.replaceAll('`', '``')}\``;
  if (family === 'SQLSERVER_LIKE') return `[${part.replaceAll(']', ']]')}]`;
  return `"${part.replaceAll('"', '""')}"`;
}

/** 目录表名：优先 schema + 原始表名，再回退限定名。 */
function catalogTableRef(item: any) {
  const parts = item.rawTableName
    ? [item.schemaName, item.rawTableName].filter(Boolean)
    : String(item.qualifiedName || item.tableName || '')
        .split('.')
        .filter(Boolean);
  return parts.map(quoteIdent).join('.');
}

/**
 * 拉字段清单的表名，对齐 dataBaseOperate/getTableColumns 约定：
 * - MySQL/SQLite：路径里的 instanceName 已是库名，tableName 只能是裸表名
 * - PG/Oracle/SQL Server：可带 schema.table，供后端解析真实 schema
 */
function catalogMetaTableName(item: any) {
  const family = nodeResource.value?.family;
  const bare = (value: string) => {
    const parts = value.split('.').filter(Boolean);
    return parts[parts.length - 1] || value;
  };
  const raw = String(item.rawTableName || item.tableName || '').trim();
  if (family === 'MYSQL_LIKE' || family === 'SQLITE_LIKE') {
    if (raw) return bare(raw);
    return bare(String(item.qualifiedName || '').trim());
  }
  if (item.schemaName && raw && !raw.includes('.')) {
    return `${item.schemaName}.${raw}`;
  }
  return raw || String(item.qualifiedName || '');
}

/** 空 SQL 生成带全部字段的 SELECT；已有 SQL 时在光标处插入表名。 */
async function insertTable(item: any) {
  const target = node.value;
  if (!target || target.type !== 'database.query') return;
  const name = catalogTableRef(item);
  if (!name) return;
  const sql = String(target.config.sql || '');
  if (sql.trim()) {
    // 编辑器已就绪时插在光标或选区；还在加载时退回追加到末尾。
    if (sqlEditorRef.value?.insertText) sqlEditorRef.value.insertText(name);
    else target.config.sql = `${sql}${name}`;
    return;
  }
  const request = tableInsertRequests.capture(target);
  const current = () => request.current() && node.value === target;
  const source = nodeResource.value;
  const metaKey = catalogMetaTableName(item);
  const insertKey = String(item.qualifiedName || item.tableName || metaKey);
  catalogInserting.value = insertKey;
  try {
    let columns: string[] = [];
    if (source?.dbConfigId && source.instance && metaKey) {
      const response: any = await getTableColumns(
        source.dbConfigId,
        source.instance,
        metaKey,
      );
      const list = unbox<any[]>(response) || response?.data || response || [];
      columns = (Array.isArray(list) ? list : [])
        .map((column: any) =>
          String(
            column?.fieldName || column?.columnName || column?.name || '',
          ).trim(),
        )
        .filter(Boolean);
    }
    if (!current()) return;
    if (columns.length) {
      const selectList = columns
        .map((column) => quoteIdent(column))
        .join(',\n  ');
      request.apply(`SELECT\n  ${selectList}\nFROM ${name}`);
    } else {
      request.apply(`SELECT * FROM ${name}`);
      say('warning', '未能读取字段列表，已插入 SELECT *，请手工补全列');
    }
  } catch (error) {
    if (!current()) return;
    request.apply(`SELECT * FROM ${name}`);
    say('warning', `读取字段失败，已插入 SELECT *：${errorMessage(error)}`);
  } finally {
    if (request.latest()) catalogInserting.value = '';
  }
}

/** 使用运行快照中的步骤名称；旧历史缺名称时展示稳定 ID，不套用当前草稿。 */
function runNodeName(nodeId?: string) {
  if (!nodeId) return '';
  return (
    runSteps.value.find((step: any) => step.nodeId === nodeId)?.nodeName ||
    nodeId
  );
}

async function exportJson() {
  if (!(await prepare())) return;
  const url = URL.createObjectURL(
    new Blob([jsonText.value], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activeWorkspace.value?.workspaceName || 'etl'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
/** 无效 JSON 和冲突草稿都可原样导出备份，不经过校验或标准化。 */
function exportLocalDraft() {
  const url = URL.createObjectURL(
    new Blob([currentDraftJson()], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activeWorkspace.value?.workspaceName || 'etl'}-local-draft.json`;
  link.click();
  URL.revokeObjectURL(url);
}
/** 用户确认放弃后读取服务端版本，只有加载成功才删除本地缓存。 */
async function reloadConflictDraft() {
  const row = activeWorkspace.value;
  if (!row) return;
  try {
    await ElMessageBox.confirm(
      '使用服务端版本将放弃当前本地修改，建议先导出备份。继续？',
      '刷新工作区',
      { type: 'warning' },
    );
    if (String(activeWorkspace.value?.id) === String(row.id))
      await openWorkspace(row, false, true);
  } catch {
    /* 取消时完整保留本地编辑。 */
  }
}
async function importFile(event: Event, kettle = false) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  const selectedFiles = Array.from(input.files || []);
  input.value = '';
  if (!file) return;
  const request = draftOperations.begin();
  try {
    if (kettle) {
      if (!(await prepare())) return;
      kettleWizard.value?.open(selectedFiles);
      return;
    }
    if (file.size > 2 * 1024 * 1024) throw new Error('JSON 文件不能超过 2MB');
    const text = await file.text(),
      result = unbox<any>(await validateEtlWorkspace(text));
    if (!draftOperations.current(request)) return;
    if (!result.valid) throw new Error(result.errors[0]);
    await ElMessageBox.confirm(
      '导入整个 JSON 将替换当前工作区的任务和数据源配置；原保存版本在保存前不会改变。确认替换？',
      '导入完整工作区',
      { type: 'warning' },
    );
    if (!draftOperations.current(request)) return;
    applyDocument(parseEtlJson(text));
  } catch (error) {
    if (draftOperations.current(request) && error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  }
}
function applyDocument(document: EtlWorkspaceDocument) {
  doc.value = normalizeSqlDocument(document);
  selectPipeline(doc.value.pipelines[0]?.id || '');
  editorMode.value = 'steps';
  previews.value = {};
  syncJson();
}
/** 向导最终确认后只追加到草稿；基准冲突时保留向导，绝不覆盖用户的新修改。 */
async function applyKettleDocument(
  document: EtlWorkspaceDocument,
  baseJson: string,
) {
  if (!(await prepare())) return;
  if (JSON.stringify(doc.value) !== baseJson) {
    say('warning', '工作区草稿已变化，请重新开始导入，避免覆盖修改');
    return;
  }
  applyDocument(document);
  selectPipeline(document.pipelines.at(-1)?.id || '');
  kettleWizard.value?.complete();
  say('success', '已追加到草稿，请预检后保存并运行');
  try {
    connections.value = unbox<EtlConnectionOption[]>(await listEtlSources());
  } catch {
    /* 已应用草稿不因目录刷新失败丢失。 */
  }
}

/** 已经提示过的单任务编辑范围，避免同一次配置里每个问题都弹一次。 */
let announcedAiScope = '';
/** 上一轮真正发给 AI 的范围。换任务或改成整份工作区时清空对话，避免串任务。 */
let aiSessionKey = '';
/** 工具栏选择的范围。主按钮默认只改当前任务，下拉可以改整份工作区。 */
const aiEditPreference = ref<EtlAiEditPreference>('pipeline');
async function openAi(preference: EtlAiEditPreference = aiEditPreference.value) {
  if (preference === 'workspace' || preference === 'pipeline' || preference === 'auto') {
    aiEditPreference.value = preference;
  }
  if (!aiResourceRef.value)
    aiResourceRef.value =
      node.value?.resourceRef || resources.value[0]?.[0] || '';
  if (!(await prepareAi())) return;
  aiWindow.value?.open({ scene: 'etl' });
}
/** 读取 JSON 编辑器中的草稿，不写回文档。校验失败时保留原来的步骤草稿。 */
function readEditorDocument(): EtlWorkspaceDocument | null {
  if (editorMode.value !== 'json') return doc.value;
  if (!jsonValid.value) {
    say('error', 'JSON 格式错误');
    return null;
  }
  try {
    return parseEtlJson(jsonText.value);
  } catch {
    say('error', 'JSON 格式错误');
    return null;
  }
}
/** 把 JSON 编辑器里尚未写回的草稿读出来。步骤模式直接使用当前文档。 */
function adoptEditorDocument(): boolean {
  if (editorMode.value !== 'json') return true;
  if (!jsonValid.value) {
    say('error', 'JSON 格式错误');
    return false;
  }
  try {
    doc.value = parseEtlJson(jsonText.value);
  } catch {
    say('error', 'JSON 格式错误');
    return false;
  }
  syncJson();
  return true;
}
/** 其他任务只提供名称和步骤名，方便参照，但不把它们的配置塞进提示词。 */
function otherTaskCatalog(currentId?: string) {
  return doc.value.pipelines
    .filter((item) => item.id !== currentId)
    .slice(0, 40)
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      steps: item.nodes
        .map((node) => node.name || node.type)
        .filter(Boolean)
        .slice(0, 8),
    }));
}
/**
 * 每次提问都读取最新草稿。只改当前任务时不因其他任务的结构错误而拦住；
 * 整份工作区仍校验全部任务。换任务后清空上一轮对话。
 */
async function prepareAi(): Promise<boolean> {
  const preview = readEditorDocument();
  if (!preview) return false;
  const edit = buildAiWorkspace(
    preview,
    activePipelineId.value,
    aiEditPreference.value,
  );
  if ('error' in edit) {
    say('warning', edit.error);
    return false;
  }
  // 只改当前任务时，其他任务的结构错误不能挡住这次配置。整份编辑仍校验全部任务。
  if (edit.scope.mode === 'pipeline') {
    if (!adoptEditorDocument()) return false;
    const request = workspaceRequests.stamp();
    const base = snapshot();
    const result = unbox<any>(
      await validateEtlWorkspace(JSON.stringify(doc.value), edit.scope.pipelineId),
    );
    if (!workspaceRequests.current(request) || snapshot() !== base) {
      say('info', '配置或工作区已变化，请重新操作');
      return false;
    }
    if (!result.valid) {
      say('error', result.errors?.[0] || '当前任务配置无效');
      return false;
    }
  } else if (!(await prepare())) {
    return false;
  }
  const workspaceId = String(activeWorkspace.value?.id ?? '');
  const nextSession = `${workspaceId}:${
    edit.scope.mode === 'pipeline'
      ? `pipeline:${edit.scope.pipelineId}`
      : 'workspace'
  }`;
  // 换工作区会换一个新的 AI 窗口，不能把上一个工作区的会话切换当成当前任务切换。
  const switched = Boolean(
    aiSessionKey.startsWith(`${workspaceId}:`) && aiSessionKey !== nextSession,
  );
  if (switched) {
    aiWindow.value?.resetConversation();
    say(
      'info',
      edit.scope.mode === 'pipeline'
        ? `已换成任务「${edit.scope.pipelineName}」，开始新的对话。其他任务保持不变。`
        : '已改为配置整个工作区，开始新的对话。',
    );
  }
  aiSessionKey = nextSession;
  const scopeKey =
    edit.scope.mode === 'pipeline'
      ? `${activeWorkspace.value?.id}:${edit.scope.pipelineId}:${edit.reason}`
      : '';
  if (scopeKey && scopeKey !== announcedAiScope && !switched) {
    say(
      'info',
      edit.reason === 'chosen'
        ? `本次只配置当前任务「${edit.scope.pipelineName}」，其他任务保持不变。`
        : `工作区超过 AI 一次编辑上限，本次只配置当前任务「${edit.scope.pipelineName}」。完成后可切换任务继续。`,
    );
  }
  announcedAiScope = scopeKey;
  const source = aiSource.value;
  if (!source?.dbConfigId || !source.instance) {
    say('warning', '请先配置工作区数据源');
    return false;
  }
  return true;
}
function aiContext() {
  const edit = buildAiWorkspace(
    doc.value,
    activePipelineId.value,
    aiEditPreference.value,
  );
  if ('error' in edit) return { workMode: 'etl' };
  return {
    etlWorkspace: edit.json,
    etlEditScope: edit.scope,
    etlTaskCatalog:
      edit.scope.mode === 'pipeline'
        ? otherTaskCatalog(edit.scope.pipelineId)
        : undefined,
    workMode: 'etl',
  };
}
/** 候选只应用到草稿，需明确确认；历史候选或已变化的草稿不会被静默覆盖。 */
async function applyAi(candidate: {
  workspace: EtlWorkspaceDocument;
  baseJson?: string;
  editScope?: { mode?: string; pipelineId?: string; pipelineName?: string };
}) {
  if (!candidate?.workspace) return;
  const pipelineId =
    candidate.editScope?.mode === 'pipeline'
      ? candidate.editScope.pipelineId
      : '';
  // 单任务候选只要求这个任务有效，其他未完成任务不阻止合并。
  if (pipelineId) {
    if (!adoptEditorDocument()) return;
  } else if (!(await prepare())) {
    return;
  }
  const request = draftOperations.begin();
  try {
    const merged = pipelineId
      ? mergeAiPipelineEdit(doc.value, candidate.workspace, pipelineId)
      : candidate.workspace;
    const result: any = unbox(
      await validateEtlWorkspace(
        JSON.stringify(merged),
        pipelineId || undefined,
      ),
    );
    if (!draftOperations.current(request)) return;
    if (!result.valid) throw new Error((result.errors || []).join('；'));
    if (!sameEtlValue(candidate.workspace.resources, doc.value.resources))
      throw new Error('数据源绑定已经变化，请重新生成候选');
    const sameBase = pipelineId
      ? candidate.baseJson === pipelineEditJson(doc.value, pipelineId)
      : candidate.baseJson === JSON.stringify(doc.value);
    await ElMessageBox.confirm(
      pipelineId
        ? sameBase
          ? '只把 AI 对当前任务的修改写入草稿，其他任务保持不变。不会自动保存或执行。'
          : '当前任务在生成候选后已变化。应用将只替换该任务，其他任务保持不变。确认替换？'
        : sameBase
          ? '应用 AI 候选到当前草稿？不会自动保存或执行。'
          : '草稿已变化或此候选来自历史会话。应用将替换当前任务配置，请先查看候选 JSON。确认替换？',
      '应用候选配置',
      { type: 'warning', modalClass: 'ai-mask-confirm-overlay' },
    );
    if (!draftOperations.current(request)) return;
    if (pipelineId) {
      doc.value = merged;
      selectPipeline(pipelineId);
      editorMode.value = 'steps';
      previews.value = {};
      syncJson();
    } else {
      applyDocument(candidate.workspace);
    }
  } catch (error) {
    if (draftOperations.current(request) && error !== 'cancel' && error !== 'close')
      say('error', errorMessage(error));
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  // 打开详情前已经落盘。加载期间 dirty 仍为 true，再拦截会让刷新误报未保存。
  if (cachePaused) return;
  // 只有成功落盘才允许无提示关闭；存储超限/禁用时仍保护尚未备份的编辑。
  if (!flushActiveDraft()) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function onDocumentVisible() {
  if (document.visibilityState === 'visible') void pullRemoteWorkspace(false);
}
onBeforeRouteLeave(() => flushActiveDraft());
watch(
  [
    dirty,
    doc,
    jsonText,
    editorMode,
    () => activeWorkspace.value?.workspaceName,
    () => activeWorkspace.value?.description,
  ],
  () => scheduleFlushDraft(),
  { deep: true },
);
/**
 * 页面任意位置 Ctrl+S / Cmd+S 保存（画布、表单、输入框、左侧列表、抽屉都可以）。
 * 冒泡阶段监听：SQL 编辑器自己处理 Ctrl+S 时会 preventDefault，这里就跳过，避免保存两次。
 * 只在 ETL 页面激活时挂监听，keep-alive 切到别的页面后移除。
 */
function onSaveShortcut(event: KeyboardEvent) {
  if (!isEtlSaveShortcut(event)) return;
  const handle = shouldHandleEtlSave(event);
  // 无论是否保存都拦住浏览器的“另存网页”。
  event.preventDefault();
  if (!handle || !activeWorkspace.value || saving.value || loading.value) return;
  void saveDraft();
}
let saveShortcutBound = false;
function bindSaveShortcut() {
  if (saveShortcutBound) return;
  saveShortcutBound = true;
  window.addEventListener('keydown', onSaveShortcut);
}
function unbindSaveShortcut() {
  saveShortcutBound = false;
  window.removeEventListener('keydown', onSaveShortcut);
}
onActivated(() => {
  bindSaveShortcut();
  // keep-alive 回到本页时挂接本区进行中的运行（含定时）
  if (activeWorkspace.value) void refreshRuns();
});
onDeactivated(unbindSaveShortcut);
onMounted(async () => {
  bindSaveShortcut();
  refreshEtlDirtyIds();
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('visibilitychange', onDocumentVisible);
  document.addEventListener('click', dismissWorkspaceMenu);
  loading.value = true;
  try {
    const [sourceResponse] = await Promise.all([
      listEtlSources(),
      refreshWorkspaces(),
    ]);
    connections.value = unbox<EtlConnectionOption[]>(sourceResponse) || [];
    const lastId = readLastEtlWorkspace();
    const target =
      workspaces.value.find((item) => String(item.id) === lastId) ||
      workspaces.value[0];
    if (target) await openWorkspace(target);
  } catch (error) {
    say('error', errorMessage(error));
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  disconnectMappingResizeObserver();
  unbindSaveShortcut();
  pageAlive = false;
  abortPreviewRequest();
  flushActiveDraft();
  workspaceRequests.invalidate();
  previewRequests.invalidate();
  tableInsertRequests.invalidate(); draftOperations.invalidate(); catalogRequest++;
  if (cacheTimer) clearTimeout(cacheTimer);
  collabAlive = false;
  if (collabTimer) clearTimeout(collabTimer);
  window.removeEventListener('beforeunload', beforeUnload);
  document.removeEventListener('visibilitychange', onDocumentVisible);
  document.removeEventListener('click', dismissWorkspaceMenu);
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<template>
  <Page
    auto-content-height
    content-class="flex min-h-0 flex-col"
    class="etl-page"
  >
    <div v-loading="loading" class="etl-shell">
      <header class="toolbar">
        <div class="toolbar-nav">
          <el-button
            :icon="sidebarOpen ? Fold : Expand"
            :title="sidebarOpen ? $tr('隐藏工作区') : $tr('展开工作区')"
            @click="toggleSidebar"
          />
          <strong>{{ $tr('数据同步') }}</strong>
          <div v-if="activeWorkspace" class="source-chips">
            <button
              v-for="[key, source] in resources"
              :key="key"
              type="button"
              class="source-chip"
              :title="`${source.displayName} · ${source.instance || $tr('待绑定')}`"
              @click="openSources"
            >
              {{ source.displayName }}
            </button>
            <el-button v-if="!resources.length" link @click="openSources"
              >{{ $tr('添加数据源') }}</el-button
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <el-tag v-if="dirty" type="warning">{{ $tr('未保存') }}</el-tag>
          <!-- 编辑视图对整个工作区生效：表单、画布（全部任务）、JSON。 -->
          <el-radio-group
            class="editor-view-switch"
            size="small"
            :model-value="currentEditorView"
            :disabled="!activeWorkspace"
            :aria-label="$tr('编辑视图')"
            @change="(value: boolean | number | string | undefined) => changeEditorView(value as 'canvas' | 'form' | 'json')"
          >
            <el-radio-button v-for="option in EDITOR_VIEW_OPTIONS" :key="option.value" :value="option.value">
              {{ $tr(option.label) }}
            </el-radio-button>
          </el-radio-group>
          <el-button-group class="save-split">
            <el-button
              :disabled="!activeWorkspace"
              :loading="saving"
              @click="saveDraft()"
              >{{ $tr('保存') }}</el-button
            >
            <el-dropdown
              trigger="click"
              :disabled="!activeWorkspace || saving"
              @command="onSaveCommand"
            >
              <el-button
                :disabled="!activeWorkspace || saving"
                :icon="ArrowDown"
                :title="$tr('保存为新版本')"
              />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="version">{{
                    $tr('保存为新版本')
                  }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-button-group>
          <el-button
            :disabled="!activeWorkspace"
            :loading="syncing"
            :title="$tr('拉取对方已保存的更新')"
            @click="syncNow"
            >{{ $tr('同步') }}</el-button
          >
          <el-button
            :disabled="!activeWorkspace || !isWorkspaceOwner"
            :loading="publishing"
            @click="publish"
            >{{ $tr('发布') }}</el-button
          >
          <el-button
            type="primary"
            :disabled="!activeWorkspace || editorMode === 'json'"
            :loading="running"
            :title="$tr('按顺序运行全部启用任务')"
            @click="runAllPipelines"
            >{{ $tr('运行') }}</el-button
          >
          <el-button-group class="save-split etl-ai-split">
            <el-button
              class="etl-ai-btn"
              type="primary"
              plain
              :icon="MagicStick"
              :disabled="!activeWorkspace"
              :title="$tr('打开 AI 助手窗口')"
              @click="openAi('pipeline')"
              >{{ $tr('AI助手') }}</el-button
            >
            <el-dropdown
              trigger="click"
              :disabled="!activeWorkspace"
              @command="openAi"
            >
              <el-button
                class="etl-ai-btn"
                type="primary"
                plain
                :icon="ArrowDown"
                :disabled="!activeWorkspace"
                :title="$tr('选择 AI 编辑范围')"
              />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="pipeline" :disabled="!pipeline">{{
                    $tr('只改当前任务')
                  }}</el-dropdown-item>
                  <el-dropdown-item command="workspace">{{
                    $tr('配置整个工作区')
                  }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-button-group>
          <el-dropdown
            trigger="click"
            :disabled="!activeWorkspace"
            @command="onMore"
          >
            <el-button :disabled="!activeWorkspace">{{ $tr('更多') }}</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="sources">{{ $tr('数据源') }}</el-dropdown-item>
                <el-dropdown-item command="mode">{{
                  editorMode === 'json' ? $tr('返回步骤配置') : 'JSON'
                }}</el-dropdown-item>
                <el-dropdown-item command="import-json"
                  >{{ $tr('导入 Lemon JSON') }}</el-dropdown-item
                >
                <el-dropdown-item command="import-kettle"
                  >{{ $tr('导入 Kettle') }}</el-dropdown-item
                >
                <el-dropdown-item command="export">{{ $tr('导出 JSON') }}</el-dropdown-item>
                <el-dropdown-item command="history">{{ $tr('历史版本') }}</el-dropdown-item>
                <el-dropdown-item command="runs">{{ $tr('运行记录') }}</el-dropdown-item>
                <el-dropdown-item command="share">{{ $tr('协同成员') }}</el-dropdown-item>
                <el-dropdown-item command="merge">{{ $tr('合并其他工作区') }}</el-dropdown-item>
                <el-dropdown-item command="schedule">{{ $tr('定时执行') }}</el-dropdown-item>
                <el-dropdown-item command="schedule-logs">{{ $tr('定时任务日志') }}</el-dropdown-item>
                <el-dropdown-item v-if="isWorkspaceOwner" command="notify">{{ $tr('消息通知') }}</el-dropdown-item>
                <el-dropdown-item command="rename">{{ $tr('改名') }}</el-dropdown-item>
                <el-dropdown-item command="copy">{{ $tr('复制工作区') }}</el-dropdown-item>
                <el-dropdown-item v-if="dirty" command="abandon"
                  >{{ $tr('放弃本地未保存修改') }}</el-dropdown-item
                >
                <el-dropdown-item v-if="isWorkspaceOwner" command="delete" divided
                  >{{ $tr('删除工作区') }}</el-dropdown-item
                >
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <input
          ref="jsonInput"
          type="file"
          accept=".json"
          hidden
          @change="importFile($event)"
        /><input
          ref="kettleInput"
          multiple
          type="file"
          accept=".ktr,.kjb"
          hidden
          @change="importFile($event, true)"
        />
      </header>
      <el-alert
        v-if="syncBlocked"
        type="warning"
        :closable="false"
        :title="$tr('JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。')"
      >
        <el-button @click="exportLocalDraft">{{ $tr('导出本地备份') }}</el-button>
      </el-alert>
      <el-alert
        v-else-if="mergeConflicts.length"
        type="warning"
        :closable="false"
        :title="$tr('同一处被双方改过，保存前请选择保留哪一份，不会直接覆盖。')"
      >
        <div v-for="conflict in mergeConflicts" :key="conflict.path" class="conflict-row">
          <span>{{ conflictTitle(conflict) }}</span>
          <el-button size="small" @click="chooseConflict(conflict, 'remote')">{{ $tr('采用对方') }}</el-button>
          <el-button size="small" @click="chooseConflict(conflict, 'local')">{{ $tr('保留我的') }}</el-button>
        </div>
        <div class="conflict-actions">
          <el-button size="small" @click="chooseAllConflicts('remote')">{{ $tr('全部采用对方') }}</el-button>
          <el-button size="small" @click="chooseAllConflicts('local')">{{ $tr('全部保留我的') }}</el-button>
          <el-button size="small" @click="exportLocalDraft">{{ $tr('导出本地备份') }}</el-button>
        </div>
      </el-alert>
      <el-alert
        v-else-if="draftConflict"
        type="warning"
        :closable="false"
        :title="$tr('服务端版本已变化，本地草稿已保留，尚未覆盖服务端。')"
      >
        <el-button @click="reloadConflictDraft">{{ $tr('使用服务端版本') }}</el-button>
        <el-button @click="keepConflictDraft">{{ $tr('保留本地继续编辑') }}</el-button>
        <el-button @click="exportLocalDraft">{{ $tr('导出本地备份') }}</el-button>
      </el-alert>
      <el-button
        v-else-if="editorMode === 'json' && !jsonValid"
        @click="exportLocalDraft"
        >{{ $tr('导出未完成 JSON 备份') }}</el-button
      >
      <div class="etl-body">
        <aside v-if="sidebarOpen" class="workspace-sidebar">
          <div class="sidebar-title">
            <span>{{ $tr('工作区') }}</span>
            <el-dropdown trigger="click" @command="setWorkspaceSort">
              <el-button :icon="Sort" circle link :title="$tr('排序')" :aria-label="$tr('排序')" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="option in ETL_WORKSPACE_SORT_OPTIONS"
                    :key="option.value"
                    :command="option.value"
                  >
                    {{ workspaceSort.mode === option.value ? '✓ ' : '' }}{{ $tr(option.label) }}
                  </el-dropdown-item>
                  <el-dropdown-item divided command="asc">{{ !workspaceSort.desc ? '✓ ' : '' }}{{ $tr(workspaceSort.mode === 'name' ? 'A → Z' : workspaceSort.mode === 'custom' ? '正序' : '最早在前') }}</el-dropdown-item>
                  <el-dropdown-item command="desc">{{ workspaceSort.desc ? '✓ ' : '' }}{{ $tr(workspaceSort.mode === 'name' ? 'Z → A' : workspaceSort.mode === 'custom' ? '倒序' : '最新在前') }}</el-dropdown-item>
                  <el-dropdown-item v-if="workspaceSort.mode !== 'custom'" disabled divided>{{ $tr('切换到“自定义顺序”后可拖动排序') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              :icon="Plus"
              circle
              link
              :title="$tr('新建工作区')"
              @click="newVisible = true"
            />
          </div>
          <div
            v-for="workspace in sortedWorkspaces"
            :key="String(workspace.id)"
            class="workspace-item"
            :class="{
              active: String(workspace.id) === String(activeWorkspace?.id),
              dirty: isWorkspaceDirty(workspace),
              dragging: workspaceDrag?.sourceId === String(workspace.id),
              'drop-before': workspaceDrag?.overId === String(workspace.id) && !workspaceDrag.after && workspaceDrag.sourceId !== String(workspace.id),
              'drop-after': workspaceDrag?.overId === String(workspace.id) && workspaceDrag.after && workspaceDrag.sourceId !== String(workspace.id),
            }"
            :draggable="workspaceSort.mode === 'custom'"
            :title="workspaceSort.mode === 'custom' ? $tr('拖动可调整顺序') : undefined"
            @dragstart="onWorkspaceDragStart($event, workspace)"
            @dragover="onWorkspaceDragOver($event, workspace)"
            @drop="onWorkspaceDrop($event)"
            @dragend="onWorkspaceDragEnd"
            role="button"
            tabindex="0"
            @click="openWorkspace(workspace, true)"
            @keydown.enter="openWorkspace(workspace, true)"
            @contextmenu.prevent="openWorkspaceMenu($event, workspace)"
          >
            <strong class="workspace-item__title"
              >{{ workspaceDisplayName(workspace)
              }}<span v-if="isWorkspaceDirty(workspace)" class="workspace-item__dirty"> *</span></strong
            >
            <small
              >{{ workspace.accessRole === 'EDITOR' ? $tr('共享') + ' · ' : '' }}{{ $tr('版本') }}
              {{ workspace.publishedVersion || 0 }}</small
            >
            <el-button
              v-if="String(workspace.id) === String(activeWorkspace?.id)"
              size="small"
              class="workspace-source-btn"
              @click.stop="openSources"
              >{{ $tr('数据源') }} ({{ resources.length }})</el-button
            >
          </div>
          <el-empty
            v-if="!workspaces.length"
            :image-size="60"
            :description="$tr('还没有工作区')"
          />
          <Teleport to="body">
            <div
              v-if="workspaceMenu && workspaceMenu.x"
              class="workspace-context-menu"
              :style="{
                left: `${workspaceMenu.x}px`,
                top: `${workspaceMenu.y}px`,
              }"
              @click.stop
            >
              <button @click="configureSchedule">{{ $tr('定时执行配置') }}</button>
              <button v-if="menuTargetIsOwner" @click="configureNotify">{{ $tr('消息通知配置') }}</button>
              <button @click="openShareFromMenu">{{ $tr('协同成员') }}</button>
              <button @click="renameWorkspace">{{ $tr('改名') }}</button>
              <button @click="copyWorkspaceFromMenu">{{ $tr('复制') }}</button>
              <button
                v-if="
                  workspaces.some(
                    (item) =>
                      String(item.id) === String(workspaceMenu?.id) &&
                      isWorkspaceDirty(item),
                  )
                "
                @click="abandonLocalDraft"
              >
                {{ $tr('放弃本地未保存修改') }}
              </button>
              <button v-if="menuTargetIsOwner" class="danger" @click="deleteWorkspaceFromMenu">
                {{ $tr('删除工作区') }}
              </button>
            </div>
          </Teleport>
        </aside>
        <main
          v-if="activeWorkspace"
          class="workspace-main"
          :class="[`tasks-${taskPosition}`, { 'tabs-hidden': currentEditorView !== 'form' }]"
        >
          <!-- 画布和 JSON 视图已包含全部任务，不再显示任务标签栏；表单视图照旧。 -->
          <TaskTabs
            v-show="currentEditorView === 'form'"
            :key="String(activeWorkspace.id)"
            class="workspace-tabs"
            :workspace-id="activeWorkspace.id"
            :tasks="doc.pipelines"
            :dirty-ids="dirtyPipelineIds"
            :auto-hide-ids="suppressedPipelineIds"
            :active="activePipelineId"
            :position="taskPosition"
            @select="selectPipeline"
            @add="addPipeline"
            @add-example="addExamplePipeline"
            @copy="copyPipeline"
            @restore="restorePipeline"
            @delete="removePipeline"
            @enabled="setPipelineEnabled"
            @position="setTaskPosition"
          />
          <section class="task-content">
            <div class="task-scroll">
            <div v-if="editorMode === 'json'" class="json-panel">
              <JsonEditorPanel
                v-model="jsonText"
                v-model:valid="jsonValid"
                mode="text"
                height="100%"
              />
            </div>
            <template v-else-if="pipeline">
              <div v-show="stepsView !== 'canvas'" class="pipeline-header">
                <el-input
                  v-model="pipeline.name"
                  :placeholder="$tr('同步任务名称')"
                /><el-switch
                  v-model="pipeline.enabled"
                  inline-prompt
                  :active-text="$tr('启用')"
                  :inactive-text="$tr('停用')"
                /><el-button link type="danger" @click="removePipeline()"
                  >{{ $tr('删除任务') }}</el-button
                ><el-button
                  link
                  type="primary"
                  :icon="VideoPlay"
                  :loading="running"
                  :disabled="editorMode === 'json'"
                  @click="runPipeline"
                  >{{ $tr('运行') }}</el-button
                >
              </div>
              <EtlCanvas
                v-if="stepsView === 'canvas'"
                ref="etlCanvasRef"
                :pipelines="doc.pipelines"
                :active-pipeline-id="activePipelineId"
                :running="running"
                :can-undo="historyState.canUndo"
                :can-redo="historyState.canRedo"
                @undo="undoDoc"
                @redo="redoDoc"
                @add-task="addPipeline()"
                @run="runCanvasTask"
                @rename-task="renameCanvasTask"
                @enable-task="setPipelineEnabled"
                @delete-task="removePipeline"
                :selected-id="selectedNodeId"
                :title-of="canvasNodeTitle"
                :subtitle-of="canvasNodeSubtitle"
                @add="addStepCommand"
                @edit="editCanvasNode"
                @remove="removeCanvasNode"
                @rename="renameCanvasNode"
                @select="selectCanvasCell"
              />
              <div v-else class="flow-strip" :aria-label="$tr('步骤流水线')">
                <div
                  v-for="(step, index) in pipeline.nodes"
                  :key="step.id"
                  class="flow-node"
                >
                  <span v-if="index > 0" class="flow-arrow" aria-hidden="true"
                    >→</span
                  >
                  <button
                    type="button"
                    class="step-item flow-step"
                    :class="{
                      active: selectedNodeId === step.id,
                      disabled: step.enabled === false,
                    }"
                    :aria-current="selectedNodeId === step.id ? 'step' : undefined"
                    @click="selectedNodeId = step.id"
                    @contextmenu.prevent="openFormStepMenu($event, step.id)"
                  >
                    <span class="step-number">{{ index + 1 }}</span>
                    <span class="flow-step-text">
                      <strong>{{
                        $tr(step.name || stepTitle(step))
                      }}</strong>
                      <small
                        >{{ $tr(stepTitle(step)) }}<template v-if="step.type.startsWith('database.')">
                          · {{ $tr(sourceLabel(step.resourceRef)) }}</template
                        ></small
                      >
                    </span>
                    <em v-if="selectedNodeId === step.id" class="step-current"
                      >{{ $tr('当前') }}</em
                    >
                  </button>
                </div>
                <el-dropdown trigger="click" @command="addStepCommand">
                  <el-button class="add-step-inline" :icon="Plus"
                    >{{ $tr('步骤') }}</el-button
                  >
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="database.query"
                        >{{ $tr('查询步骤') }}</el-dropdown-item
                      >
                      <el-dropdown-item command="transform.select">{{ $tr('字段处理步骤') }}</el-dropdown-item>
                      <el-dropdown-item v-for="operator in ETL_OPERATORS" :key="operator.type" :command="operator.type">{{ $tr(operator.label) }}</el-dropdown-item>
                      <el-dropdown-item command="database.write"
                        >{{ $tr('写入步骤') }}</el-dropdown-item
                      >
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-popover
                  v-model:visible="resultDockMenuOpen"
                  trigger="click"
                  :width="168"
                  placement="bottom-end"
                  popper-class="etl-result-dock-popper"
                >
                  <template #reference>
                    <el-button
                      :icon="MoreFilled"
                      class="result-dock-trigger"
                      :title="$tr(resultDockMenuTitle)"
                      :aria-label="$tr(resultDockMenuTitle)"
                    />
                  </template>
                  <div
                    class="dock-menu"
                    role="menu"
                    :aria-label="`${$tr('选择')}${resultDockMenuTitle}`"
                  >
                    <div class="dock-menu__title">{{ $tr(resultDockMenuTitle) }}</div>
                    <div class="dock-icons" role="group">
                      <button
                        v-for="opt in RESULT_DOCK_OPTIONS"
                        :key="opt.value"
                        type="button"
                        class="dock-icon"
                        :class="{ active: resultDock === opt.value }"
                        :title="$tr(opt.labelKey)"
                        :aria-label="$tr(opt.labelKey)"
                        :aria-pressed="resultDock === opt.value"
                        role="menuitemradio"
                        @click="setResultDock(opt.value)"
                      >
                        <span
                          class="dock-preview"
                          :data-side="opt.value"
                          aria-hidden="true"
                        >
                          <span class="dock-preview__chrome" />
                          <span class="dock-preview__panel" />
                        </span>
                      </button>
                    </div>
                  </div>
                </el-popover>
              </div>
              <Teleport to="body">
                <div
                  v-if="formStepMenu"
                  class="etl-step-context-menu"
                  role="menu"
                  :style="{ left: `${formStepMenu.x}px`, top: `${formStepMenu.y}px` }"
                  @keydown.esc="closeFormStepMenu"
                >
                  <div class="etl-step-context-menu__title">{{ formStepMenuTitle }}</div>
                  <button type="button" role="menuitem" @click="formStepMenuAction('rename')">{{ $tr('改名') }}</button>
                  <button type="button" role="menuitem" class="danger" @click="formStepMenuAction('delete')">{{ $tr('删除') }}</button>
                </div>
              </Teleport>
              <template v-if="node && stepsView === 'canvas' && canvasEditorOpen">
                <div class="canvas-drawer-mask" @click="canvasEditorOpen = false"></div>
                <div
                  class="canvas-drawer-resizer"
                  :style="nodeDrawerStyle"
                  role="separator"
                  aria-orientation="vertical"
                  :title="$tr('拖动调整宽度，双击恢复默认')"
                  @pointerdown="startNodeDrawerResize"
                  @dblclick="resetNodeDrawerWidth"
                ></div>
                <div class="canvas-drawer-header" :style="nodeDrawerStyle">
                  <strong>{{ $tr('编辑节点') }}：{{ canvasNodeTitle(node) }}</strong>
                  <span>{{ $tr('修改会立即写入 JSON') }}</span>
                  <el-button type="primary" size="small" @click="canvasEditorOpen = false">{{ $tr('完成') }}</el-button>
                </div>
              </template>
              <div
                v-if="node"
                v-show="stepsView !== 'canvas' || canvasEditorOpen"
                class="step-split"
                :class="[`result-${resultDock}`, { 'canvas-node-drawer': stepsView === 'canvas' }]"
                :style="stepsView === 'canvas' ? nodeDrawerStyle : undefined"
                @keydown="onCanvasDrawerKey"
              >
                <section class="step-editor">
                  <div class="step-header">
                    <el-input
                      v-model="node.name"
                      :placeholder="$tr('步骤名称')"
                    /><el-tag>{{ $tr(stepTitle(node)) }}</el-tag
                    ><el-button link type="danger" @click="removeStep"
                      >{{ $tr('删除') }}</el-button
                    >
                  </div>
                  <el-form label-position="top">
                    <el-form-item
                      v-if="node.type.startsWith('database.') && node.type !== 'database.query'"
                      :label="$tr('数据源')"
                      class="form-row-inline source-row"
                      ><div class="inline-control">
                        <el-select
                          v-model="node.resourceRef"
                          filterable
                          :placeholder="$tr('选择工作区数据源别名')"
                          ><el-option
                            v-for="[key, source] in resources"
                            :key="key"
                            :label="`${source.displayName} · ${source.instance || $tr('待绑定')}`"
                            :value="key" /></el-select
                        >
                      </div></el-form-item
                    >
                    <el-alert
                      v-if="
                        nodeResource?.family === 'SQLSERVER_LIKE' &&
                        nodeResource.schema
                      "
                      :title="$tr('SQL Server 查询请使用 schema.table 限定表名；写入会按所选 Schema 自动限定目标表。')"
                      type="info"
                      :closable="false"
                    />
                    <div v-if="node.config.migrationWarnings?.length">
                      <el-alert
                        v-for="warning in node.config.migrationWarnings"
                        :key="warning"
                        :title="warning"
                        type="warning"
                        :closable="false"
                      /><el-button
                        type="warning"
                        plain
                        @click="node.config.migrationWarnings = []"
                        >{{ $tr('我已核对差异，按当前配置执行') }}</el-button
                      >
                    </div>
                    <template v-if="node.type === 'database.query'">
                      <div class="sql-label">
                        <span>{{ $tr('查询 SQL · 可 JOIN 多张表') }}</span>
                        <div class="sql-label-actions">
                          <el-button
                            link
                            type="primary"
                            :icon="VideoPlay"
                            :loading="previewing"
                            @click="preview"
                            >{{ $tr('预览') }}</el-button
                          >
                          <el-popover
                            placement="bottom"
                            :width="360"
                            trigger="click"
                            ><template #reference
                              ><el-button link :loading="catalogLoading"
                                >{{ $tr('可用表目录') }}</el-button
                              ></template
                            >
                          <div class="table-catalog">
                            <div class="catalog-search">
                              <el-input
                                v-model="catalogSearch"
                                clearable
                                size="small"
                                :placeholder="$tr('筛选表名')"
                              />
                              <el-button
                                :icon="Refresh"
                                circle
                                size="small"
                                :loading="catalogLoading"
                                :title="$tr('刷新表目录')"
                                :aria-label="$tr('刷新表目录')"
                                @click="loadCatalog(true)"
                              />
                            </div>
                            <p class="help catalog-hint">
                              {{ $tr('点击表名：空编辑器生成含全部字段的 SELECT；已有 SQL 则在光标处插入表名') }}
                            </p>
                            <el-button
                              v-for="table in filteredCatalog"
                              :key="table.qualifiedName || table.tableName"
                              link
                              class="catalog-item"
                              :loading="
                                catalogInserting ===
                                (table.qualifiedName || table.tableName)
                              "
                              @click="insertTable(table)"
                              >{{
                                table.qualifiedName || table.tableName
                              }}</el-button
                            ><span v-if="!filteredCatalog.length">{{
                              catalogLoading
                                ? $tr('加载中…')
                                : catalogSearch.trim()
                                  ? $tr('无匹配表')
                                  : $tr('暂无可读表')
                            }}</span>
                          </div></el-popover
                          >
                        </div>
                      </div>
                      <!-- 高度为原 9 行文本框的两倍；只替换显示区，参数和预览仍在编辑器外面 -->
                      <div class="etl-sql-editor">
                        <SqlEditor
                          ref="sqlEditorRef"
                          embedded
                          :model-value="String(node.config.sql || '')"
                          :tab-id="sqlEditorTabId"
                          :alive-tab-ids="[sqlEditorTabId]"
                          :db-config-id="nodeResource?.dbConfigId"
                          :db-type="nodeResource?.dbType || nodeResource?.databaseTypeHint"
                          :instance-name="nodeResource?.instance"
                          :schema-name="nodeResource?.schema"
                          @update:model-value="onSqlEditorInput"
                          @save="saveDraft"
                          @execute="preview"
                        />
                      </div>
                      <el-form-item
                        :label="$tr('数据源')"
                        class="form-row-inline source-row sql-meta-row"
                        ><div class="inline-control">
                        <el-select
                          v-model="node.resourceRef"
                          filterable
                          :placeholder="$tr('选择工作区数据源别名')"
                          ><el-option
                            v-for="[key, source] in resources"
                            :key="key"
                            :label="`${source.displayName} · ${source.instance || $tr('待绑定')}`"
                            :value="key" /></el-select
                        >
                      </div></el-form-item
                      >
                      <div class="section-title">
                        <strong>{{ $tr('查询参数') }}</strong
                        ><el-button link :icon="Plus" @click="addParameter"
                          >{{ $tr('添加参数') }}</el-button
                        >
                      </div>
                      <p class="help">
                        {{ $tr('SQL 使用 :参数名；可取上游第一行字段，或整列用于 IN (:参数名)。不需要手写引号。') }}
                      </p>
                      <div
                        v-for="(param, index) in node.config.parameters || []"
                        :key="index"
                        class="parameter-row"
                      >
                        <el-input v-model="param.name" :placeholder="$tr('参数名')" />
                        <el-select
                          :model-value="param.stepId || (param.variable !== undefined ? VARIABLE_PARAM_SOURCE : FIXED_PARAM_SOURCE)"
                          :placeholder="$tr('参数来源')"
                          @update:model-value="onParamSource(param, $event)"
                          ><el-option
                            :label="$tr('固定值')"
                            :value="FIXED_PARAM_SOURCE" /><el-option :label="$tr('工作区变量')" :value="VARIABLE_PARAM_SOURCE" /><el-option
                            v-for="upstream in previousQueries"
                            :key="upstream.id"
                            :value="upstream.id"
                            :label="upstream.name || upstream.id"
                        /></el-select>
                        <el-select
                          v-if="param.stepId"
                          v-model="param.column"
                          filterable
                          allow-create
                          default-first-option
                          :placeholder="$tr('上游字段')"
                          ><el-option
                            v-for="column in queryColumns[param.stepId] || []"
                            :key="column"
                            :label="column"
                            :value="column" /></el-select
                        ><el-select v-else-if="param.variable !== undefined" v-model="param.variable" :placeholder="$tr('选择工作区变量')"><el-option v-for="name in Object.keys(doc.variables)" :key="name" :value="name" :label="name" /></el-select><el-input
                          v-else
                          v-model="param.value"
                          :placeholder="$tr('固定参数值')"
                        />
                        <el-select v-if="param.stepId" v-model="param.mode"
                          ><el-option :label="$tr('第一行')" value="first" /><el-option
                            :label="$tr('整列列表')"
                            value="list"
                        /></el-select>
                        <el-button
                          link
                          type="danger"
                          @click="removeParameter(Number(index))"
                          >{{ $tr('删除') }}</el-button
                        >
                      </div>
                      <el-collapse><el-collapse-item :title="$tr('工作区变量（多个步骤共享）')" name="variables"><div v-for="(value,name) in doc.variables" :key="name" class="mapping-row"><el-tag>{{ name }}</el-tag><el-input :model-value="typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')" :aria-label="String(name)" @update:model-value="doc.variables = { ...doc.variables, [name]: $event }" /><el-button link type="danger" @click="delete doc.variables[name]">{{ $tr('删除') }}</el-button></div><div class="mapping-row"><el-input v-model="variableName" :placeholder="$tr('变量名')" /><el-input v-model="variableValue" :placeholder="$tr('文本值')" /><el-button @click="addVariable">{{ $tr('添加变量') }}</el-button></div><small>{{ $tr('表单编辑后保存文本值；数字、数组或布尔变量可在 JSON 编辑器中配置。') }}</small></el-collapse-item></el-collapse>
                      <div class="preview-actions">
                        <el-input-number
                          v-model="node.config.pageSize"
                          :min="1"
                          :max="50000"
                          :step="1000"
                        /><span class="help"
                          >{{ $tr('每页读取行数；总量不截断，右侧预览最多 100 行') }}</span
                        >
                      </div>
                    </template>
                    <template v-else-if="ETL_OPERATORS.some((operator) => operator.type === node?.type)">
                      <EtlOperatorEditor :key="`${activePipelineId}:${node.id}`" :node="node" :upstream="previousQueries" :columns="queryColumns" @dependency-change="dependencyChanged" />
                      <el-button :loading="previewing" @click="preview">{{ $tr('预览步骤结果') }}</el-button>
                    </template>
                    <template v-else-if="node.type === 'transform.select'">
                      <el-form-item :label="$tr('输入步骤')"
                        ><el-select
                          v-model="node.config.inputStepId"
                          @change="dependencyChanged"
                          ><el-option
                            v-for="upstream in previousQueries"
                            :key="upstream.id"
                            :value="upstream.id"
                            :label="upstream.name || upstream.id" /></el-select
                      ></el-form-item>
                      <el-switch
                        v-model="node.config.keepUnspecified"
                        :active-text="$tr('保留未选择字段')"
                      />
                      <div
                        v-for="(field, index) in node.config.fields || []"
                        :key="index"
                        class="mapping-row field-processing-row"
                      >
                        <el-input
                          v-model="field.source"
                          :placeholder="$tr('原字段')"
                        /><span>→</span
                        ><el-input
                          v-model="field.target"
                          :placeholder="$tr('输出字段')"
                        /><el-button
                          link
                          type="danger"
                          @click="node.config.fields.splice(index, 1)"
                          >{{ $tr('删除') }}</el-button
                        >
                        <EtlFieldRules :field="field" />
                      </div>
                      <el-button
                        @click="
                          (node.config.fields ||= []).push({ source: '', target: '', type: 'keep', trim: false, emptyToNull: false })
                        "
                        >{{ $tr('添加字段') }}</el-button
                      >
                      <el-form-item :label="$tr('移除字段')"
                        ><el-select
                          v-model="node.config.removeFields"
                          multiple
                          filterable
                          allow-create
                          default-first-option
                      /></el-form-item>
                    </template>
                    <template
                      v-else-if="
                        ['database.write', 'database.upsert'].includes(
                          node.type,
                        )
                      "
                    >
                      <div class="write-grid">
                        <el-form-item
                          :label="$tr('输入查询结果')"
                          class="form-row-inline"
                          ><el-select
                            v-model="node.config.inputStepId"
                            :placeholder="$tr('选择上游查询步骤')"
                            @change="dependencyChanged"
                            ><el-option
                              v-for="upstream in previousQueries"
                              :key="upstream.id"
                              :value="upstream.id"
                              :label="
                                upstream.name || upstream.id
                              " /></el-select
                        ></el-form-item>
                        <el-form-item
                          :label="$tr('目标表（已有表）')"
                          class="form-row-inline"
                          ><div class="inline-control">
                            <el-select-v2
                              v-model="node.config.table"
                              filterable
                              allow-create
                              default-first-option
                              :loading="catalogLoading"
                              :options="catalogTableOptions"
                              :placeholder="$tr('选择或输入目标表')"
                            /><el-button
                              :icon="Refresh"
                              link
                              :loading="catalogLoading"
                              :title="$tr('刷新表目录')"
                              :aria-label="$tr('刷新表目录')"
                              @click="loadCatalog(true)"
                            />
                          </div></el-form-item>
                      </div>
                      <el-form-item :label="$tr('写入方式')" class="form-row-inline"
                        ><el-radio-group v-model="node.config.mode"
                          ><el-radio-button value="append"
                            >{{ $tr('追加数据') }}</el-radio-button
                          ><el-radio-button value="upsert"
                            >{{ $tr('按键更新 / 插入') }}</el-radio-button
                          ></el-radio-group
                        ></el-form-item
                      >
                      <el-form-item
                        v-if="
                          node.config.mode === 'upsert' ||
                          node.type === 'database.upsert'
                        "
                        :label="$tr('目标键字段（应有唯一约束）')"
                        class="form-row-inline"
                        ><el-select-v2
                          v-model="node.config.keyColumns"
                          multiple
                          filterable
                          allow-create
                          collapse-tags
                          collapse-tags-tooltip
                          default-first-option
                          :options="mappingTargetOptions"
                          :placeholder="$tr('例如：order_id')"
                        /></el-form-item>
                      <el-form-item
                        v-if="
                          node.config.mode === 'upsert' ||
                          node.type === 'database.upsert'
                        "
                        :label="$tr('允许更新的字段')"
                        class="form-row-inline"
                        :title="$tr('未设置时更新全部非键字段')"
                      >
                        <div class="inline-control">
                          <el-select-v2
                            v-model="node.config.updateColumns"
                            multiple
                            filterable
                            allow-create
                            collapse-tags
                            collapse-tags-tooltip
                            :options="mappingTargetOptions"
                            :placeholder="$tr('未设置时更新全部非键字段')"
                          />
                          <el-button
                            v-if="node.config.updateColumns !== undefined"
                            link
                            @click="delete node.config.updateColumns"
                            >{{ $tr('恢复更新全部') }}</el-button
                          >
                        </div>
                        <small
                          v-if="node.config.updateColumns?.length === 0"
                          class="field-hint"
                          >{{ $tr('当前为空：已有行不更新，只插入缺失行。') }}</small
                        >
                      </el-form-item>
                      <el-form-item
                        :label="$tr('每批写入行数')"
                        class="form-row-inline batch-field"
                        ><el-input-number
                          v-model="node.config.batchSize"
                          :min="1"
                          :max="2000"
                          :step="50" /></el-form-item
                      ><el-alert
                        :title="$tr('写入步骤使用独立事务；失败会回滚当前步骤，已成功提交的前序步骤会保留。')"
                        type="info"
                        :closable="false"
                      />
                    </template>
                    <el-alert
                      v-else
                      :title="$tr('此节点需要迁移为 SQL 查询或结果写入，请在 JSON 中检查原配置；执行器会明确提示未支持步骤。')"
                      type="warning"
                      :closable="false"
                    />
                  </el-form>
                  <div class="dependency-strip">
                    <span>{{ $tr('执行依赖') }}</span
                    ><el-tag
                      v-for="edge in pipeline.edges.filter(
                        (item) =>
                          item.target === node?.id && item.enabled !== false,
                      )"
                      :key="edge.source"
                      >{{
                        pipeline.nodes.find((item) => item.id === edge.source)
                          ?.name || edge.source
                      }}</el-tag
                    ><small
                      v-if="
                        !pipeline.edges.some(
                          (item) =>
                            item.target === node?.id && item.enabled !== false,
                        )
                      "
                      >{{ $tr('无上游，可独立查询') }}</small
                    >
                  </div>
                </section>
                <aside class="step-result" :class="{ 'is-mapping': isWriteStep(node.type) }" :aria-label="$tr('预览与字段映射')">
                  <template
                    v-if="
                      isEtlRowSource(node.type)
                    "
                  >
                    <div class="section-title">
                      <strong>{{
                        previewResult
                          ? $tr(`预览 ${previewResult.rowCount} 行`)
                          : $tr('结果预览')
                      }}</strong>
                      <small v-if="previewResult">{{
                        previewResult.stale
                          ? $tr('旧预览 · 配置已修改')
                          : previewResult.sampled
                            ? $tr('最多 100 行样本')
                            : $tr('结果预览')
                      }}</small>
                    </div>
                    <p class="help">
                      {{ $tr('正式运行不截断总行数。这里只留样本，用来确认 SQL 和参数。') }}
                    </p>
                    <p v-if="previewUpstreamLabels.length" class="help">
                      {{ $tr('已先执行上游并传入参数') }}：{{
                        previewUpstreamLabels.join('、')
                      }}
                    </p>
                    <el-table
                      v-if="previewResult"
                      class="etl-preview-table"
                      :data="previewResult.rows"
                      max-height="420"
                      border
                      ><el-table-column
                        v-for="column in previewResult.columns"
                        :key="column"
                        :prop="column"
                        :label="column"
                        min-width="130"
                        show-overflow-tooltip
                    /></el-table>
                    <el-empty
                      v-else
                      :image-size="72"
                      :description="$tr('点「预览」查看样本')"
                    />
                  </template>
                  <template
                    v-else-if="
                      ['database.write', 'database.upsert'].includes(node.type)
                    "
                  >
                    <div class="mapping-panel">
                    <div class="section-title">
                      <strong>{{ $tr('字段映射') }}</strong>
                      <div>
                        <el-button
                          link
                          :loading="previewing"
                          @click="previewInput"
                          >{{ $tr('加载字段') }}</el-button
                        ><el-button link @click="autoMapping">{{ $tr('同名映射') }}</el-button
                        ><el-button link :icon="Plus" @click="addMapping"
                          >{{ $tr('添加字段') }}</el-button
                        >
                      </div>
                    </div>
                    <p class="help">
                      {{ $tr('留空时按查询结果同名写入。SQL 字段别名可以直接对应目标字段。') }}
                    </p>
                    <div
                      v-if="mappingCount"
                      ref="mappingViewport"
                      class="mapping-viewport"
                      @scroll="onMappingScroll"
                    >
                      <div
                        class="mapping-spacer"
                        :style="{
                          height: `${mappingCount * MAPPING_ROW_HEIGHT}px`,
                        }"
                      >
                        <div
                          v-for="row in visibleMappingRows"
                          :key="row.index"
                          class="mapping-row"
                          :style="{ transform: `translateY(${row.offset}px)` }"
                        >
                          <el-select-v2
                            v-model="row.mapping.source"
                            filterable
                            allow-create
                            default-first-option
                            :options="sourceColumnOptions"
                            :placeholder="$tr('查询结果字段')"
                          /><span>→</span
                          ><el-input
                            v-model="row.mapping.target"
                            :placeholder="$tr('目标字段')"
                          /><el-button
                            link
                            type="danger"
                            @click="node.config.mappings.splice(row.index, 1)"
                            >{{ $tr('删除') }}</el-button
                          >
                        </div>
                      </div>
                    </div>
                    <p
                      v-if="!(node.config.mappings || []).length"
                      class="help"
                    >
                      {{ $tr('还没有单独映射。点「加载字段」后可按同名填入，也可以保持留空。') }}
                    </p>
                    <section v-if="inputPreview" class="preview-panel">
                      <div class="section-title">
                        <strong>{{ $tr('输入样本') }} {{ inputPreview.rowCount }} {{ $tr('行') }}</strong
                        ><small>{{
                          inputPreview.stale
                            ? $tr('旧预览 · 配置已修改')
                            : $tr('最多 100 行样本')
                        }}</small>
                      </div>
                      <p
                        v-if="
                          inputPreview.columns.length > SAMPLE_COLUMN_LIMIT &&
                          !showWideSample
                        "
                        class="help"
                      >
                        {{ $tr('字段较多，样本先显示前 24 列') }}
                        <el-button link @click="showWideSample = true">{{
                          $tr('显示全部列')
                        }}</el-button>
                      </p>
                      <el-table
                        class="etl-preview-table"
                        :data="inputPreview.rows"
                        max-height="240"
                        border
                        ><el-table-column
                          v-for="column in sampleColumns"
                          :key="column"
                          :prop="column"
                          :label="column"
                          min-width="120"
                          show-overflow-tooltip
                      /></el-table>
                    </section>
                    </div>
                  </template>
                  <el-empty
                    v-else
                    :image-size="72"
                    :description="$tr('此步骤请在左侧或 JSON 中处理')"
                  />
                </aside>
              </div>
              <el-empty v-else :description="$tr('添加一个查询步骤开始配置')" />
            </template>
            <el-empty v-else :description="$tr('添加同步任务开始配置')"
              ><el-button type="primary" @click="addPipeline()"
                >{{ $tr('新增任务') }}</el-button
              ></el-empty
            >
            <div
              v-if="validationErrors.length || stickyWarnings.length"
              class="validation-panel"
            >
              <el-alert
                v-for="error in validationErrors"
                :key="error"
                :title="error"
                type="error"
                :closable="false"
              /><el-alert
                v-for="warning in stickyWarnings"
                :key="warning"
                :title="warning"
                type="warning"
                :closable="false"
              />
            </div>
            </div>
            <section
              v-if="liveRunSnapshot || liveBatchMode"
              class="run-console"
              aria-live="polite"
              :aria-label="$tr('执行日志')"
            >
              <div
                class="run-console-resizer"
                role="separator"
                aria-orientation="horizontal"
                :title="$tr('拖拽调整高度，双击恢复默认')"
                @pointerdown="startRunConsoleResize"
                @dblclick="resetRunConsoleHeight"
              ></div>
              <header class="run-console-head">
                <strong
                  >{{ $tr('执行日志') }} ·
                  <template v-if="liveBatchMode"
                    >{{ $tr('全部任务') }} ·
                    {{ liveBatchSummary.headline }}</template
                  >
                  <template v-else>{{
                    liveRunSnapshot?.pipelineName || pipeline?.name
                  }}</template></strong
                >
                <el-tag size="small">{{
                  liveBatchMode
                    ? statusLabel(
                        liveBatchSummary.finished
                          ? liveBatchSummary.failed
                            ? 'FAILED'
                            : liveBatchSummary.cancelled
                              ? 'CANCELLED'
                              : 'SUCCESS'
                          : liveRunSnapshot?.status || 'RUNNING',
                      )
                    : statusLabel(liveRunSnapshot?.status || '')
                }}</el-tag>
                <span class="run-console-message">{{
                  liveRunSnapshot?.message
                }}</span>
                <el-button
                  v-if="
                    canCancelLiveRun &&
                    (liveBatchMode
                      ? running ||
                        ['PENDING', 'RUNNING'].includes(
                          liveRunSnapshot?.status || '',
                        )
                      : ['PENDING', 'RUNNING'].includes(
                          liveRunSnapshot?.status || '',
                        ))
                  "
                  link
                  type="danger"
                  @click="cancelLiveRun"
                  >{{ $tr('取消') }}</el-button
                >
                <el-button link @click="openLiveHistory">{{
                  $tr('运行记录')
                }}</el-button>
                <el-button link @click="liveConsoleOpen = !liveConsoleOpen">{{
                  liveConsoleOpen ? $tr('收起') : $tr('展开')
                }}</el-button>
              </header>
              <div
                v-show="liveConsoleOpen"
                ref="liveLogBody"
                class="run-console-body"
                :style="{ height: `${runConsoleBodyHeight}px` }"
              >
                <p v-if="!liveLogLines.length" class="run-console-empty">
                  {{ $tr('等待日志…') }}
                </p>
                <div
                  v-for="item in liveLogLines"
                  :key="item.batchKey || item.id"
                  class="run-console-line"
                  :data-level="item.level"
                >
                  <time>{{ formatLogTime(item.createdAt) }}</time>
                  <em>{{ item.level }}</em>
                  <span
                    v-if="item.pipelineName"
                    class="run-console-task"
                    >{{ formatBatchLogPrefix(item.pipelineName) }}</span
                  >
                  <span v-if="item.nodeId" class="run-console-node">{{
                    liveNodeName(item.nodeId)
                  }}</span>
                  <span class="run-console-text">{{ item.message }}</span>
                </div>
              </div>
            </section>
          </section>
        </main>
        <main v-else class="empty-workspace">
          <el-empty :description="$tr('创建工作区，选好数据源后开始同步')"
            ><el-button type="primary" @click="newVisible = true"
              >{{ $tr('新建工作区') }}</el-button
            ></el-empty
          >
        </main>
      </div>
    </div>
    <WorkspaceSchedule ref="scheduleDialog" @logs="openScheduleLogs" />
    <WorkspaceScheduleLogs ref="scheduleLogsDialog" @logs="openScheduleLogs" />
    <WorkspaceNotify ref="notifyDialog" />
    <EtlShareDialog ref="shareDialog" />
    <EtlHistoryDialog
      ref="historyDialog"
      :busy="historyBusy"
      @restore="restoreHistory"
    />
    <EtlMergeDialog
      ref="mergeDialog"
      :workspaces="workspaces"
      :current-id="activeWorkspace?.id"
      :document="doc"
      @apply="applyImportedNodes"
    />
    <el-dialog
      v-model="newVisible"
      :title="$tr('新建工作区')"
      width="min(960px, 94vw)"
      :close-on-click-modal="false"
      ><el-form label-position="top"
        ><div class="write-grid">
          <el-form-item :label="$tr('工作区名称')"
            ><el-input
              v-model="newName"
              maxlength="100"
              :placeholder="$tr('例如：订单数仓同步')" /></el-form-item
          ><el-form-item :label="$tr('说明（可选）')"
            ><el-input v-model="newDescription" maxlength="500"
          /></el-form-item>
        </div>
        <el-form-item :label="$tr('工作区数据源')"
          ><WorkspaceSources
            v-model="newResources"
            :connections="connections"
            class="full-width" /></el-form-item></el-form
      ><template #footer
        ><el-button @click="newVisible = false">{{ $tr('取消') }}</el-button
        ><el-button
          type="primary"
          :loading="createBusy"
          @click="createWorkspace"
          >{{ $tr('创建并配置步骤') }}</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      v-model="sourcesVisible"
      :title="$tr('工作区数据源')"
      width="min(960px, 94vw)"
      ><WorkspaceSources
        v-model="sourceDraft"
        :connections="connections"
        :used-refs="usedRefs"
      /><template #footer
        ><el-button @click="sourcesVisible = false">{{ $tr('取消') }}</el-button
        ><el-button type="primary" @click="applySources"
          >{{ $tr('应用') }}</el-button
        ></template
      ></el-dialog
    >
    <KettleImportWizard
      ref="kettleWizard"
      :document="doc"
      :connections="connections"
      @apply="applyKettleDocument"
    />
    <el-drawer
      v-model="runsVisible"
      :title="$tr('运行记录与步骤进度')"
      class="etl-runs-drawer"
      size="35%"
    >
      <div class="runs-drawer-body">
        <div class="runs-drawer-toolbar">
          <el-select
            v-model="runsStatusFilter"
            clearable
            :placeholder="$tr('按状态筛选')"
            style="width: 148px"
          >
            <el-option
              v-for="status in runsStatusOptions"
              :key="status"
              :label="statusLabel(status)"
              :value="status"
            />
          </el-select>
          <el-button :icon="Refresh" @click="refreshRuns(true)">{{
            $tr('刷新')
          }}</el-button>
          <span v-if="runs.length >= 100" class="runs-cap-hint">{{
            $tr('仅显示最近 100 条')
          }}</span>
        </div>
        <el-table
          :data="pagedRuns"
          highlight-current-row
          max-height="360"
          :empty-text="$tr('暂无运行记录')"
          @current-change="selectedRun = $event || selectedRun"
        >
          <el-table-column
            prop="pipelineName"
            :label="$tr('任务')"
            min-width="100"
            show-overflow-tooltip
          />
          <el-table-column :label="$tr('状态')" width="78">
            <template #default="scope">{{
              statusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column :label="$tr('时间')" width="148">
            <template #default="scope">{{
              new Date(scope.row.startedAt).toLocaleString()
            }}</template>
          </el-table-column>
          <el-table-column prop="revision" :label="$tr('版本')" width="58" />
        </el-table>
        <el-pagination
          v-model:current-page="runsPage"
          :page-size="runsPageSize"
          :total="filteredRuns.length"
          layout="total, prev, pager, next"
          small
          background
        />
        <template v-if="selectedRun">
          <div class="runs-drawer-detail">
            <div class="section-title">
              <strong>{{ selectedRun.message }}</strong>
              <el-button
                v-if="
                  canCancelSelectedRun &&
                  ['PENDING', 'RUNNING'].includes(selectedRun.status)
                "
                type="danger"
                plain
                @click="cancelRun"
                >{{ $tr('取消任务') }}</el-button
              >
            </div>
            <el-table :data="runSteps" max-height="160">
              <el-table-column :label="$tr('步骤')" min-width="120">
                <template #default="scope">{{
                  runNodeName(scope.row.nodeId)
                }}</template>
              </el-table-column>
              <el-table-column :label="$tr('状态')" width="78">
                <template #default="scope">{{
                  statusLabel(scope.row.status)
                }}</template>
              </el-table-column>
              <el-table-column prop="rows" :label="$tr('行数')" width="72" />
              <el-table-column
                prop="message"
                :label="$tr('信息')"
                min-width="100"
                show-overflow-tooltip
              />
            </el-table>
            <div class="section-title">
              <strong>{{ $tr('执行日志') }}</strong>
              <el-select
                v-model="logNode"
                clearable
                :placeholder="$tr('全部任务与节点日志')"
                @change="
                  logPage = 1;
                  refreshLogs();
                "
              >
                <el-option
                  v-for="step in runSteps"
                  :key="step.nodeId"
                  :label="runNodeName(step.nodeId)"
                  :value="step.nodeId"
                />
              </el-select>
            </div>
            <el-table v-loading="logsBusy" :data="runLogs" max-height="280">
              <el-table-column :label="$tr('时间')" width="148">
                <template #default="scope">{{
                  new Date(scope.row.createdAt).toLocaleString()
                }}</template>
              </el-table-column>
              <el-table-column prop="level" :label="$tr('级别')" width="58" />
              <el-table-column :label="$tr('节点')" min-width="100">
                <template #default="scope">{{
                  runNodeName(scope.row.nodeId)
                }}</template>
              </el-table-column>
              <el-table-column
                prop="rowCount"
                :label="$tr('累计行数')"
                width="88"
              />
              <el-table-column
                prop="message"
                :label="$tr('事件')"
                min-width="120"
                show-overflow-tooltip
              />
            </el-table>
            <el-pagination
              v-model:current-page="logPage"
              :page-size="50"
              :total="logTotal"
              layout="total, prev, pager, next"
              small
              @current-change="refreshLogs"
            />
          </div>
        </template>
      </div>
    </el-drawer>
    <AiChatWindow
      v-if="activeWorkspace"
      :key="String(activeWorkspace.id)"
      ref="aiWindow"
      etl-mode
      :db-config-id="aiSource?.dbConfigId"
      :instance-name="aiSource?.instance"
      :conn-label="
        aiEditPreference === 'pipeline' && pipeline
          ? pipeline.name || pipeline.id
          : aiSource?.displayName
      "
      :before-send="prepareAi"
      :get-extra-context="aiContext"
      @apply-etl-config="applyAi"
    />
  </Page>
</template>

<style scoped>
.editor-view-switch { flex: none; }
.canvas-drawer-resizer { position: fixed; top: 0; bottom: 0; right: calc(min(var(--etl-node-drawer-width), 90vw) - 4px); z-index: 1502; width: 8px; cursor: col-resize; touch-action: none; }
.canvas-drawer-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px; background: transparent; transition: background 0.15s; }
.canvas-drawer-resizer:hover::after { background: var(--el-color-primary); }
.canvas-drawer-mask { position: fixed; inset: 0; z-index: 1500; background: rgb(0 0 0 / 30%); }
.canvas-drawer-header { position: fixed; top: 0; right: 0; z-index: 1501; display: flex; gap: 12px; align-items: center; box-sizing: border-box; width: min(var(--etl-node-drawer-width, 1000px), 90vw); height: 52px; padding: 0 16px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-lighter); }
.canvas-drawer-header span { flex: 1; color: var(--el-text-color-secondary); font-size: 12px; }
.step-split.canvas-node-drawer { position: fixed; top: 52px; right: 0; bottom: 0; z-index: 1501; box-sizing: border-box; width: min(var(--etl-node-drawer-width, 1000px), 90vw); margin: 0; padding: 12px 16px; overflow: auto; background: var(--el-bg-color); box-shadow: var(--el-box-shadow-dark); }
:global(.etl-runs-drawer) {
  color: var(--el-text-color-primary);
}
:global(.etl-runs-drawer .el-drawer__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-bottom: 12px;
  overflow: hidden;
}
.runs-drawer-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
}
.runs-drawer-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}
.runs-cap-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.runs-drawer-detail {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}
.etl-shell {
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-bg-color);
  /* 铺满 Page 内容区。原先用 100vh - 130px，比实际可用高度矮一截，底部会留空。 */
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.toolbar,
.toolbar-nav,
.toolbar-actions,
.pipeline-header,
.step-header,
.section-title,
.preview-actions,
.flow-strip,
.source-chips {
  display: flex;
  align-items: center;
  gap: 10px;
}
.toolbar {
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  flex-wrap: wrap;
}
.toolbar-nav {
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.toolbar-actions {
  flex-wrap: wrap;
}
.save-split :deep(.el-dropdown) {
  display: inline-flex;
}
.etl-ai-split .etl-ai-btn {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.etl-ai-split .etl-ai-btn :deep(.el-icon) {
  color: var(--el-color-primary);
}
.nav-select {
  width: 180px;
}
.source-chips {
  flex-wrap: wrap;
  gap: 6px;
}
.source-chip {
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.source-chip:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
.etl-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.workspace-sidebar {
  flex: 0 0 210px;
  padding: 12px;
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
  overflow: auto;
}
.sidebar-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.workspace-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}
.workspace-item {
  /* 宽度含内边距，长名称也不会把卡片撑出侧栏。 */
  box-sizing: border-box;
  min-width: 0;
}
.workspace-item__title {
  /* 名称完整显示，字号略小，过长自动换行；无空格的长中英文也能断开。 */
  display: block;
  width: 100%;
  font-size: 13px;
  line-height: 1.45;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.workspace-item__dirty {
  white-space: nowrap;
}
.workspace-item[draggable='true'] {
  cursor: grab;
}
.workspace-item.dragging {
  opacity: 0.45;
}
.workspace-item.drop-before {
  box-shadow: inset 0 2px 0 var(--el-color-primary);
}
.workspace-item.drop-after {
  box-shadow: inset 0 -2px 0 var(--el-color-primary);
}
.sidebar-title > .el-dropdown {
  margin-left: auto;
}
.sidebar-title {
  gap: 2px;
}
.workspace-item small {
  max-width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.sidebar-title > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-title > .el-button {
  flex: none;
}
.workspace-source-btn {
  max-width: 100%;
  overflow: hidden;
}
.workspace-item.active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.workspace-item.dirty {
  border-color: var(--el-color-warning-light-5);
}
.workspace-item.dirty.active {
  border-color: var(--el-color-warning);
  background: var(--el-color-warning-light-8);
}
.workspace-source-btn {
  margin-top: 2px;
  width: 100%;
}
.conflict-row,
.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.workspace-context-menu {
  position: fixed;
  z-index: 4000;
  min-width: 140px;
  padding: 4px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
}
.workspace-context-menu button {
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
.workspace-context-menu button:hover {
  background: var(--el-fill-color-light);
}
.workspace-context-menu .danger {
  color: var(--el-color-danger);
}
.workspace-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-areas: 'tabs' 'editor';
  grid-template-rows: auto minmax(0, 1fr);
}
.workspace-tabs {
  grid-area: tabs;
  min-width: 0;
  min-height: 0;
}
.task-content {
  grid-area: editor;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.task-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.workspace-main.tasks-left {
  grid-template-areas: 'tabs editor';
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.workspace-main.tasks-right {
  grid-template-areas: 'editor tabs';
  grid-template-columns: minmax(0, 1fr) 220px;
  grid-template-rows: minmax(0, 1fr);
}
.workspace-main.tasks-left .workspace-tabs,
.workspace-main.tasks-right .workspace-tabs {
  height: 100%;
  overflow: hidden;
}
/* 画布和 JSON 视图隐藏标签栏后，不论标签栏在哪一侧都只留编辑区，避免空出 220px 的侧栏。 */
.workspace-main.tabs-hidden.tabs-hidden {
  grid-template-areas: 'editor';
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.workspace-head,
.task-bar,
.pipeline-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.pipeline-header,
.flow-strip,
.validation-panel {
  flex-shrink: 0;
}
.workspace-name {
  width: 220px;
}
.head-help {
  flex: 1;
}
.task-bar > .el-select {
  width: 250px;
}
.task-bar-spacer {
  flex: 1;
}
.pipeline-header > .el-input {
  width: 300px;
}
.help,
.head-help {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.flow-strip {
  flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.flow-node {
  display: contents;
}
.flow-arrow {
  color: var(--el-text-color-secondary);
}
.flow-step {
  align-items: center;
  width: auto;
  max-width: 280px;
  margin-bottom: 0;
}
.flow-step-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.add-step-inline {
  margin-left: 4px;
}
.step-split {
  display: grid;
  /* 占满流水线下方剩余高度，左右两侧才能各自滚动 */
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  align-items: stretch;
}
.step-split.result-right,
.step-split.result-hidden {
  grid-template-rows: minmax(0, 1fr);
}
.step-split.result-right {
  grid-template-columns: minmax(320px, 1.15fr) minmax(280px, 0.9fr);
}
.step-split.result-bottom {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1.15fr) minmax(0, 0.85fr);
}
.step-split.result-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.step-result {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 8px 16px 24px;
  background: var(--el-fill-color-lighter);
}
.step-result.is-mapping {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 12px;
}
.mapping-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.mapping-panel > .section-title,
.mapping-panel > .help {
  flex: 0 0 auto;
}
.mapping-panel > .preview-panel {
  flex: 0 0 auto;
  max-height: 42%;
  overflow: auto;
  margin-top: 12px;
}
.step-split.result-right .step-result {
  border-left: 1px solid var(--el-border-color-light);
}
.step-split.result-bottom .step-result {
  border-left: 0;
  border-top: 1px solid var(--el-border-color-light);
  min-height: 0;
  height: 100%;
  overflow: auto;
}
.step-split.result-right .step-result.is-mapping,
.step-split.result-bottom .step-result.is-mapping {
  overflow: hidden;
}
.step-split.result-hidden .step-result {
  display: none;
}
.step-item {
  display: flex;
  gap: 9px;
  width: 100%;
  text-align: left;
  align-items: flex-start;
  padding: 12px 8px;
  margin-bottom: 8px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 7px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  cursor: pointer;
}
.result-dock-trigger {
  margin-left: auto;
  padding: 8px;
}
button.step-item.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}
button.step-item.active .step-number {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
button.step-item.active small {
  color: var(--el-color-primary);
}
.step-current {
  flex: 0 0 auto;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--el-color-primary);
  color: var(--el-color-white);
  font-size: 11px;
  font-style: normal;
  line-height: 18px;
}
.step-item.disabled {
  opacity: 0.5;
}
button.step-item.flow-step {
  width: auto;
  max-width: 280px;
  margin-bottom: 0;
  align-items: center;
}
.step-item div {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.step-item strong,
.step-item small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-item strong {
  font-size: 13px;
}
.step-item small {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.step-number {
  border-radius: 50%;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  text-align: center;
  line-height: 22px;
}
.add-step {
  width: 100%;
  margin: 8px 0 0 !important;
}
.step-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
}
.step-header {
  margin-bottom: 20px;
}
.step-header > .el-input {
  max-width: 320px;
}
.step-editor .el-form-item .el-select {
  width: 100%;
}
/* 数据源选择行 */
.inline-control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.inline-control > .el-select,
.inline-control > .el-select-v2 {
  flex: 1;
  min-width: 0;
  width: auto !important;
}
/* 标签与控件同一行，label 不换行 */
.step-editor .form-row-inline {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: nowrap;
}
.step-editor .form-row-inline :deep(.el-form-item__label) {
  width: auto !important;
  max-width: none;
  margin-bottom: 0 !important;
  padding-right: 12px;
  line-height: 32px;
  white-space: nowrap;
  justify-content: flex-start;
}
.step-editor .form-row-inline :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.step-editor .form-row-inline .el-radio-group {
  display: inline-flex;
  flex-wrap: nowrap;
  align-self: flex-start;
}
.step-editor .form-row-inline .field-hint {
  display: block;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
/* 写入两列：每列内 label + 控件横排，两列并排 */
.step-editor .write-grid {
  align-items: center;
  margin-bottom: 18px;
}
.step-editor .write-grid .form-row-inline {
  margin-bottom: 0;
}
.step-editor .form-row-inline + .form-row-inline {
  margin-top: 6px;
}
.sql-label,
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0 10px;
  font-size: 14px;
}
.sql-label-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 原 textarea 为 9 行、14px、行高 1.65，加上下内边距约 218px，这里固定为两倍。 */
.etl-step-context-menu {
  position: fixed;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  max-width: 240px;
  padding: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
}
.etl-step-context-menu__title {
  padding: 4px 8px 6px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  margin-bottom: 2px;
}
.etl-step-context-menu button {
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.etl-step-context-menu button:hover { background: var(--el-fill-color-light); }
.etl-step-context-menu button.danger { color: var(--el-color-danger); }
.sql-meta-row {
  margin-top: 10px;
}
.etl-sql-editor {
  height: 436px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}
.run-console {
  position: relative;
  flex: 0 0 auto;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.run-console-resizer {
  position: relative;
  z-index: 2;
  height: 6px;
  margin-top: -3px;
  cursor: row-resize;
  touch-action: none;
}
.run-console-resizer::after {
  content: '';
  position: absolute;
  top: 2px;
  right: 0;
  left: 0;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}
.run-console-resizer:hover::after {
  background: var(--el-color-primary);
}
.run-console-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-width: 0;
}
.run-console-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.run-console-body {
  overflow: auto;
  padding: 0 12px 10px;
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}
.run-console-empty {
  margin: 8px 0;
  color: var(--el-text-color-secondary);
}
.run-console-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.run-console-line time,
.run-console-line em,
.run-console-task {
  color: var(--el-color-primary);
  font-style: normal;
  margin-right: 6px;
  flex-shrink: 0;
}
.run-console-node {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
}
.run-console-line em {
  font-style: normal;
  min-width: 40px;
}
.run-console-text {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.run-console-line[data-level='ERROR'] .run-console-text,
.run-console-line[data-level='ERROR'] em {
  color: var(--el-color-danger);
}
.run-console-line[data-level='WARN'] .run-console-text,
.run-console-line[data-level='WARN'] em {
  color: var(--el-color-warning);
}
.help {
  line-height: 1.65;
  margin: 8px 0 12px;
}
.parameter-row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.parameter-row > .el-input {
  flex: 1;
  min-width: 90px;
}
.parameter-row > .el-select {
  flex: 1.2;
  min-width: 100px;
}
.preview-actions {
  margin-top: 16px;
  flex-wrap: wrap;
}
.preview-actions > .el-button {
  margin-left: auto;
}
.preview-panel {
  margin-top: 20px;
}
.write-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.write-grid .el-select,
.write-grid .el-select-v2 {
  width: 100% !important;
}
.mapping-viewport {
  flex: 1 1 auto;
  min-height: 120px;
  overflow: auto;
  position: relative;
}
.mapping-spacer {
  position: relative;
}
.mapping-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.mapping-viewport .mapping-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  margin-bottom: 0;
}
.mapping-row > .el-select,
.mapping-row > .el-select-v2,
.mapping-row > .el-input {
  flex: 1;
  min-width: 0;
}
.field-processing-row { flex-wrap: wrap; }
.field-processing-row > .el-input { min-width: 110px; }
.batch-field {
  margin-top: 8px;
}
.dependency-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.json-panel {
  /* 编辑器高度跟随剩余空间（原 calc(100vh - 290px) 与实际布局不符，底部会留白）。 */
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
}
.empty-workspace {
  display: grid;
  place-items: center;
  flex: 1;
}
.full-width {
  width: 100%;
}
.catalog-search {
  display: flex;
  align-items: center;
  gap: 6px;
}
.catalog-search > .el-input {
  flex: 1;
  min-width: 0;
}
.table-catalog {
  display: grid;
  gap: 7px;
  max-height: 320px;
  overflow: auto;
}
.catalog-hint {
  margin: 0;
}
.catalog-item {
  /* 覆盖 .el-button + .el-button 的左边距，避免首项与后续表不对齐 */
  margin-left: 0 !important;
  justify-content: flex-start;
  height: auto;
  padding: 2px 0;
  white-space: normal;
  text-align: left;
}
.validation-panel {
  display: grid;
  gap: 8px;
  padding: 16px;
}
.ai-answer {
  white-space: pre-wrap;
  margin-top: 20px;
}
@media (max-width: 1100px) {
  .step-split.result-right {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 0.8fr);
  }
  .step-split.result-right .step-result {
    border-left: 0;
    border-top: 1px solid var(--el-border-color-light);
  }
  .step-editor {
    padding: 14px;
  }
  .head-help {
    display: none;
  }
  .parameter-row {
    flex-wrap: wrap;
  }
  .nav-select {
    width: 140px;
  }
}
</style>

<!-- 结果区三点菜单挂到 body，样式需非 scoped -->
<style>
.etl-result-dock-popper.el-popover {
  padding: 10px 12px !important;
  min-width: 0 !important;
}
.etl-result-dock-popper .dock-menu__title {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.2;
}
.etl-result-dock-popper .dock-icons {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
}
.etl-result-dock-popper .dock-icon {
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
.etl-result-dock-popper .dock-icon:hover {
  background: var(--el-fill-color-light);
}
.etl-result-dock-popper .dock-icon.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.etl-result-dock-popper .dock-preview {
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
.etl-result-dock-popper .dock-preview__chrome {
  position: absolute;
  inset: 0;
  background: var(--el-bg-color);
}
.etl-result-dock-popper .dock-preview__panel {
  position: absolute;
  background: var(--el-color-primary);
  opacity: 0.85;
}
.etl-result-dock-popper .dock-preview[data-side='right'] .dock-preview__panel {
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
}
.etl-result-dock-popper .dock-preview[data-side='bottom'] .dock-preview__panel {
  right: 0;
  bottom: 0;
  left: 0;
  height: 6px;
}
/* 不显示：空窗 + 斜线 */
.etl-result-dock-popper .dock-preview[data-side='hidden'] .dock-preview__panel {
  display: none;
}
.etl-result-dock-popper .dock-preview[data-side='hidden']::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top left,
    transparent calc(50% - 0.5px),
    var(--el-border-color-darker) calc(50% - 0.5px),
    var(--el-border-color-darker) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
  pointer-events: none;
}
.etl-result-dock-popper .dock-icon.active .dock-preview {
  border-color: var(--el-color-primary);
}

/* ETL preview tables only: thicker, always-visible horizontal scrollbar */
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal {
  height: 12px;
  left: 4px;
  right: 4px;
  bottom: 3px;
  border-radius: 6px;
  background-color: var(--el-fill-color-dark);
  opacity: 1 !important;
  display: block !important;
}
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal > .el-scrollbar__thumb {
  height: 100%;
  border-radius: 6px;
  background-color: var(--el-text-color-regular);
  opacity: 0.78;
}
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal > .el-scrollbar__thumb:hover {
  background-color: var(--el-color-primary);
  opacity: 1;
}
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal.el-scrollbar-fade-enter-from,
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal.el-scrollbar-fade-leave-active,
.etl-preview-table.el-table .el-table__body-wrapper .el-scrollbar__bar.is-horizontal.el-scrollbar-fade-leave-to {
  opacity: 1 !important;
}
/* Native fallback hint (Firefox) when custom bar unavailable */
.etl-preview-table.el-table .el-scrollbar__wrap--hidden-default {
  scrollbar-width: thin;
  scrollbar-color: var(--el-text-color-regular) var(--el-fill-color-dark);
}
</style>
