<script setup lang="ts">
import { parseEtlJson } from './etlSafeJson';
/**
 * SQL ETL 操作台：工作区在左侧可收起列表，任务用可停靠标签栏。
 * 步骤排成流水线并标出当前步骤；结果预览可停靠右侧/下方或隐藏。JSON 与步骤共用同一份文档。
 * @author yanch
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { Page } from '@vben/common-ui';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Fold,
  Expand,
  Plus,
  VideoPlay,
  Refresh,
  MoreFilled,
  MagicStick,
} from '@element-plus/icons-vue';
import type {
  EtlConnectionOption,
  EtlNode,
  EtlResource,
  EtlRun,
  EtlWorkspaceDocument,
  EtlWorkspaceRow,
  EtlWorkspaceSync,
} from '#/api/visual/etl';
import {
  cancelEtlRun,
  createEtlWorkspace,
  deleteEtlWorkspace,
  executeEtlWorkflow,
  getEtlWorkspace,
  getEtlRun,
  listEtlRuns,
  listEtlRunLogs,
  listEtlSources,
  listEtlTables,
  listEtlWorkspaces,
  previewEtlStep,
  publishEtlWorkspace,
  saveEtlWorkspace,
  syncEtlWorkspace,
  validateEtlWorkspace,
} from '#/api/visual/etl';
import { getTableColumns } from '#/api/visual/database';
import AiChatWindow from '#/views/visual/client/components/ai/AiChatWindow.vue';
import JsonEditorPanel from '#/views/visual/client/components/query/JsonEditorPanel.vue';
import WorkspaceSources from './WorkspaceSources.vue';
import TaskTabs from './TaskTabs.vue';
import KettleImportWizard from './KettleImportWizard.vue';
import WorkspaceSchedule from './WorkspaceSchedule.vue';
import WorkspaceNotify from './WorkspaceNotify.vue';
import EtlShareDialog from './EtlShareDialog.vue';
import EtlMergeDialog from './EtlMergeDialog.vue';
import { translateUiText } from '#/locales/ui-text';
import { createEtlRequestGate } from './etlRequestGate';
import { createEtlPreviewSession } from './etlPreviewSession';
import EtlFieldRules from './EtlFieldRules.vue';
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
  cloneDocument,
  createSqlPipeline,
  createWorkspaceDocument,
  etlId,
  normalizeSqlDocument,
  syncStepDependencies,
} from './etlModel';
import {
  mergeEtlCollaboration,
  resolveEtlConflict,
  type EtlMergeConflict,
} from './etlCollabMerge';

defineOptions({ name: 'EtlWorkspace' });
const loading = ref(false),
  saving = ref(false),
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
const sqlInput = ref<{ textarea?: HTMLTextAreaElement }>();
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
/** 上次与服务端对齐时的 revision，本地稿过期判定用 */
const savedRevision = ref(0);
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
const COLLAB_SYNC_MS = 2 * 60 * 1000;
let collabTimer: ReturnType<typeof setTimeout> | undefined;
let collabPulling = false;
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
  if (!name || Object.hasOwn(doc.value.variables, name)) { ElMessage.warning('变量名不能为空或重复'); return; }
  doc.value.variables = { ...doc.value.variables, [name]: variableValue.value };
  variableName.value = ''; variableValue.value = '';
}
const catalog = ref<any[]>([]),
  catalogLoading = ref(false);
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
    }
  >
>({});
const previewResult = computed(() => previews.value[selectedNodeId.value]);
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
    if (request === logRequest) ElMessage.error(errorMessage(error));
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
    ElMessage.warning(
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
function sourceLabel(ref?: string) {
  return doc.value.resources[ref || '']?.displayName || '请选择数据源';
}
function errorMessage(error: any) {
  return error?.msg || error?.message || '操作失败';
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
    ElMessage.warning('请填写工作区名称');
    return;
  }
  if (!Object.keys(newResources.value).length) {
    ElMessage.warning('请至少加入一个具体数据源');
    return;
  }
  const names = Object.values(newResources.value).map((item) =>
    item.displayName?.trim(),
  );
  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    ElMessage.warning('请设置不同且非空的数据源别名');
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
    ElMessage.error(errorMessage(error));
  } finally {
    createBusy.value = false;
  }
}

async function refreshWorkspaces() {
  workspaces.value = unbox<EtlWorkspaceRow[]>(await listEtlWorkspaces()) || [];
}
/** 每次打开意图都有独立代次，陈旧响应及其 finally 不允许覆盖新的工作区。 */
async function openWorkspace(
  row: EtlWorkspaceRow,
  _protect = false,
  force = false,
) {
  const request = workspaceRequests.begin();
  if (
    !force &&
    String(activeWorkspace.value?.id) === String(row.id) &&
    dirty.value
  ) {
    cachePaused = false;
    loading.value = false;
    flushActiveDraft();
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
    draftConflict.value = undefined;
    editorMode.value = 'steps';
    activePipelineId.value = doc.value.pipelines[0]?.id || '';
    selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
    previews.value = {};
    runs.value = [];
    selectedRun.value = undefined;
    runLogs.value = [];
    logRequest++;
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
    scheduleCollabPull();
    await refreshRuns();
    if (!workspaceRequests.current(request)) return false;
    return true;
  } catch (error) {
    if (workspaceRequests.current(request))
      ElMessage.error(errorMessage(error));
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
    if (localDoc) doc.value = localDoc;
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
    if (ancestorRevision !== serverRevision) draftConflict.value = detail;
    if (!dirty.value) clearEtlLocalDraft(detail.id);
  } catch {
    ElMessage.warning('本地草稿恢复失败，缓存已保留，请导出备份后处理');
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
    : doc.value.pipelines[0]?.id || '';
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
  if (!manual && (saving.value || loading.value || cachePaused || document.hidden)) {
    scheduleCollabPull();
    return;
  }
  if (manual && (saving.value || loading.value || cachePaused)) {
    ElMessage.info(
      saving.value ? '正在保存，请稍后再同步' : '正在打开工作区，请稍后再同步',
    );
    return;
  }
  if (collabPulling) return;
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
        ElMessage.info(
          saving.value ? '正在保存，请稍后再同步' : '正在打开工作区，请稍后再同步',
        );
      }
      return;
    }
    if (!sync.changed) {
      if (sync.accessRole && activeWorkspace.value) {
        activeWorkspace.value.accessRole = sync.accessRole;
      }
      if (manual) ElMessage.success('已是最新版本');
      return;
    }
    // 保存已经推进到更新的版本时，丢掉这次更早的响应，避免把旧稿并回来。
    if ((Number(sync.revision) || 0) < knownRemoteRevision.value) return;
    if (editorMode.value === 'json' && !jsonValid.value) {
      syncBlocked.value = true;
      if (manual) {
        ElMessage.warning(
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
      ElMessage.success(
        hiddenCount
          ? '对方的更新已并入本地，新任务在任务列表里，标签栏默认不打开'
          : '对方的更新已并入本地',
      );
    }
    else if (
      merged.conflicts.length &&
      merged.conflicts.map((item) => item.path).join('|') !== previousConflicts
    ) {
      ElMessage.warning('对方也改了相同内容，请选择保留哪一份');
    }
  } catch (error) {
    if (manual) ElMessage.error(errorMessage(error));
  } finally {
    collabPulling = false;
    if (collabAlive && String(activeWorkspace.value?.id) === String(row?.id)) {
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
    ElMessage.warning('请先处理协同冲突后再保存');
    return;
  }
  if (editorMode.value === 'json' && !jsonValid.value) {
    ElMessage.warning('JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。');
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
  ElMessage.success(summary || '节点已合并到当前工作区，确认后请保存');
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
      ElMessage.error('JSON 格式错误');
      return false;
    }
    try {
      candidate = parseEtlJson(jsonText.value);
    } catch {
      ElMessage.error('JSON 格式错误');
      return false;
    }
  }
  const result = unbox<any>(
    await validateEtlWorkspace(JSON.stringify(candidate)),
  );
  if (!workspaceRequests.current(request) || snapshot() !== base) {
    ElMessage.info('配置或工作区已变化，请重新操作');
    return false;
  }
  validationErrors.value = result.errors || [];
  validationWarnings.value = result.warnings || [];
  if (!result.valid) {
    ElMessage.error(result.errors[0] || '配置无效');
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
async function saveDraft(): Promise<boolean> {
  if (!activeWorkspace.value || saving.value) return false;
  if (mergeConflicts.value.length) {
    ElMessage.warning('请先处理协同冲突后再保存');
    return false;
  }
  if (draftConflict.value) {
    ElMessage.warning('请先选择保留本地或使用服务端版本，也可导出本地备份');
    return false;
  }
  if (syncBlocked.value) {
    ElMessage.warning('JSON 还没写完，暂时不能自动并入对方的更新。请先修好 JSON 或导出备份。');
    return false;
  }
  saving.value = true;
  const request = workspaceRequests.stamp();
  try {
    return await commitDraft(request, false);
  } finally {
    saving.value = false;
  }
}

/** 按当前已知的服务端版本保存。版本被别人推进时先合并，合并不了就停，不覆盖。 */
async function commitDraft(request: number, retried: boolean): Promise<boolean> {
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
      }),
    );
    if (
      !workspaceRequests.current(request) ||
      String(activeWorkspace.value?.id) !== String(row.id) ||
      !activeWorkspace.value
    )
      return false;
    activeWorkspace.value = {
      ...activeWorkspace.value,
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
    if (!dirty.value) clearEtlLocalDraft(row.id);
    else flushActiveDraft();
    await refreshWorkspaces();
    ElMessage.success(retried ? '已按最新版本合并并保存' : '已保存');
    return true;
  } catch (error) {
    if (
      !retried &&
      workspaceRequests.current(request) &&
      /其他人|其他页面|revision|版本冲突|已变化|合并/.test(errorMessage(error)) &&
      activeWorkspace.value
    ) {
      const incorporated = await incorporateLatest(activeWorkspace.value.id, request);
      if (incorporated === 'clean') return commitDraft(request, true);
      if (incorporated === 'conflict') {
        ElMessage.warning('保存时遇到新版本，无冲突的修改已并入');
        return false;
      }
    }
    ElMessage.error(errorMessage(error));
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
    activePipelineId.value = doc.value.pipelines[0]?.id || '';
  if (!node.value) selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
}
async function publish() {
  const request = workspaceRequests.stamp();
  const id = activeWorkspace.value?.id;
  if (dirty.value && !(await saveDraft())) return;
  if (
    !activeWorkspace.value ||
    !workspaceRequests.current(request) ||
    activeWorkspace.value.id !== id ||
    dirty.value
  )
    return;
  try {
    await publishEtlWorkspace(id!);
    if (!workspaceRequests.current(request)) return;
    ElMessage.success('发布成功');
    await refreshWorkspaces();
  } catch (error) {
    ElMessage.error(errorMessage(error));
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
    clearEtlLocalDraft(id);
    activeWorkspace.value = undefined;
    await refreshWorkspaces();
    if (workspaces.value[0]) await openWorkspace(workspaces.value[0]);
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      ElMessage.error(errorMessage(error));
  }
}

/** 右键或「更多」选定的工作区；更多菜单先把目标设成当前工作区。 */
const workspaceMenu = ref<{ id: string | number; x: number; y: number }>();
function openWorkspaceMenu(event: MouseEvent, workspace: EtlWorkspaceRow) {
  workspaceMenu.value = {
    id: workspace.id,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 160)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)),
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
      ElMessage.error(errorMessage(error));
  }
}
/** 定时和通知按右键选中的工作区打开，不因此切换当前草稿。 */
const scheduleDialog = ref<InstanceType<typeof WorkspaceSchedule>>();
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
/** 从定时触发历史打开原任务运行日志，切换工作区仍遵守未保存草稿保护。 */
async function openScheduleLogs(workspaceId: string | number, runId: string) {
  const target = workspaces.value.find(
    (item) => String(item.id) === String(workspaceId),
  );
  if (!target) {
    ElMessage.warning('运行所属工作区不在当前列表（可能已删除），无法打开日志');
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
    runsVisible.value = true;
    await refreshLogs();
  } catch (error) {
    ElMessage.error(errorMessage(error));
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
      ElMessage.error(errorMessage(error));
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
    runsVisible.value = true;
    void refreshRuns();
  } else if (command === 'schedule') configureSchedule();
  else if (command === 'notify') configureNotify();
  else if (command === 'share') openShare();
  else if (command === 'merge') openMergeWorkspaces();
  else if (command === 'rename') void renameWorkspace();
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
  if (conditional) ElMessage.info('模板中的表名和字段需要改为你的实际数据结构');
}
function selectPipeline(id: string) {
  activePipelineId.value = id;
  selectedNodeId.value = pipeline.value?.nodes[0]?.id || '';
}
/** 示例只追加一个独立任务；JSON 草稿先应用，异步切换期间不得写到另一个工作区。 */
async function addExamplePipeline() {
  const workspace = activeWorkspace.value?.id;
  if (editorMode.value === 'json') { await changeMode('steps'); if (editorMode.value === 'json' || activeWorkspace.value?.id !== workspace) return; }
  const item = createFlexibleExamplePipeline(etlId('example'));
  item.name = translateUiText(item.name); item.nodes.forEach((step) => { step.name = translateUiText(step.name || step.id); });
  doc.value.pipelines.push(item); activePipelineId.value = item.id; selectedNodeId.value = item.nodes.at(-1)?.id || '';
}
async function removePipeline(id = activePipelineId.value) {
  if (!doc.value.pipelines.some((item) => item.id === id)) return;
  const request = draftOperations.begin();
  try {
    await ElMessageBox.confirm('删除当前同步任务？', '删除任务');
    if (!draftOperations.current(request)) return;
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
    ElMessage.warning('后续步骤还在引用它，请先修改参数来源或写入输入');
    return;
  }
  try {
    await ElMessageBox.confirm('删除当前步骤？', '删除步骤');
    if (!draftOperations.current(request) || !pipeline.value?.nodes.some((item) => item.id === id)) return;
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

/** 查询预览会执行必要的只读上游，直接检验关联 SQL 与跨库参数能否工作。 */
async function preview() {
  if (node.value) await previewQuery(node.value.id);
}
/** 写入配置可直接预览输入并加载字段，不需要来回切换查询/写入步骤。 */
async function previewInput() {
  const id = node.value?.config.inputStepId;
  if (!id) {
    ElMessage.warning('先选择输入查询步骤');
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
  previewing.value = true;
  syncJson();
  const base = JSON.stringify(doc.value);
  const current = () => previewRequests.current(previewRequest) && workspaceRequests.current(request) && pipeline.value?.id === pipelineId;
  try {
    const result = unbox<any>(await previewEtlStep(jsonText.value, pipelineId, id));
    if (!current()) return;
    if (base !== JSON.stringify(doc.value)) { ElMessage.info('配置已修改，请重新预览'); return; }
    previews.value[id] = result;
    queryColumns.value = { ...queryColumns.value, ...(result.upstreamColumns || {}), [id]: result.columns };
    ElMessage.success('步骤预览成功');
  } catch (error) {
    if (current()) ElMessage.error(errorMessage(error));
  } finally {
    // 旧请求结束不能解除新请求的 loading，也不能把另一任务的同名步骤结果写入当前任务。
    if (previewRequests.latest(previewRequest)) previewing.value = false;
  }
}

/** 任务内步骤 ID 可重复于另一任务，切换任务必须清理预览和字段目录并废弃在途请求。 */
watch(activePipelineId, () => {
  previewRequests.invalidate(); previewing.value = false;
  previews.value = {}; queryColumns.value = {};
}, { flush: 'sync' });

function inputColumns() {
  return queryColumns.value[node.value?.config.inputStepId || ''] || [];
}
function autoMapping() {
  if (!node.value) return;
  const columns = inputColumns();
  if (!columns.length) {
    ElMessage.info('先预览输入查询，或保持映射为空使用结果同名字段');
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

/** 运行只提交保存后的工作区与任务 ID，完整预检在后端完成。 */
async function runPipeline() {
  if (!pipeline.value || !activeWorkspace.value || running.value) return;
  const request = workspaceRequests.stamp();
  const workspaceId = activeWorkspace.value.id;
  const pipelineId = pipeline.value.id;
  running.value = true;
  try {
    if (dirty.value && !(await saveDraft())) return;
    if (
      !workspaceRequests.current(request) ||
      activeWorkspace.value.id !== workspaceId ||
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
      activeWorkspace.value?.id === workspaceId &&
      pipeline.value?.id === pipelineId &&
      activeWorkspace.value?.revision === revision;
    // 空 SQL/目标表仅警告不阻断保存，运行前再拦一次并给出可读提示。
    const result = unbox<any>(
      await validateEtlWorkspace(JSON.stringify(doc.value)),
    );
    if (!stillCurrent()) {
      ElMessage.info('配置或工作区已变化，请重新运行');
      return;
    }
    validationErrors.value = result.errors || [];
    validationWarnings.value = result.warnings || [];
    validatedSnapshot = snapshot();
    if (!result.valid) {
      ElMessage.error(result.errors?.[0] || '配置无效');
      return;
    }
    const incomplete = incompleteDraftWarnings();
    if (incomplete.length) {
      ElMessage.warning(incomplete[0]);
      return;
    }
    await ElMessageBox.confirm(
      '运行当前任务？写入步骤将修改目标表数据。每个写入步骤单独提交事务。',
      '运行同步任务',
      { type: 'warning', confirmButtonText: '运行' },
    );
    if (!stillCurrent()) {
      ElMessage.info('配置或工作区已变化，请重新确认运行');
      return;
    }
    const started = unbox<EtlRun>(
      await executeEtlWorkflow(workspaceId, pipelineId, revision),
    );
    if (!workspaceRequests.current(request)) return;
    selectedRun.value = started;
    runsVisible.value = true;
    await refreshRuns();
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      ElMessage.error(errorMessage(error));
  } finally {
    running.value = false;
  }
}
async function refreshRuns() {
  if (pollTimer) clearTimeout(pollTimer);
  if (!activeWorkspace.value) return;
  const request = workspaceRequests.stamp();
  const workspaceId = activeWorkspace.value.id;
  try {
    const items = unbox<EtlRun[]>(await listEtlRuns(workspaceId)) || [];
    if (
      !workspaceRequests.current(request) ||
      workspaceId !== activeWorkspace.value?.id
    )
      return;
    runs.value = items;
    if (selectedRun.value)
      selectedRun.value =
        items.find((item) => item.id === selectedRun.value?.id) ||
        selectedRun.value;
    if (runsVisible.value && selectedRun.value) await refreshLogs();
    if (!workspaceRequests.current(request)) return;
    if (items.some((item) => ['PENDING', 'RUNNING'].includes(item.status)))
      pollTimer = setTimeout(refreshRuns, 1500);
  } catch {
    /* 历史暂不可用不影响编辑；用户可手动重试。 */
  }
}
async function cancelRun() {
  if (!selectedRun.value) return;
  try {
    await cancelEtlRun(selectedRun.value.id);
    await refreshRuns();
  } catch (error) {
    ElMessage.error(errorMessage(error));
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
    ElMessage.warning('数据源别名必须非空且不重复');
    return;
  }
  doc.value.resources = sourceDraft.value;
  sourcesVisible.value = false;
}

/** 异步对象目录绑定请求代次，避免快速切换步骤时旧请求覆盖新数据源的表。 */
watch(
  () => [
    activePipelineId.value,
    workspaceRequests.stamp(),
    node.value?.id,
    nodeResource.value?.dbConfigId,
    nodeResource.value?.instance,
    nodeResource.value?.schema,
  ],
  async () => {
    const request = ++catalogRequest;
    catalogLoading.value = false;
    tableInsertRequests.invalidate(); catalogInserting.value = '';
    catalog.value = [];
    catalogSearch.value = '';
    const source = nodeResource.value;
    if (!source?.dbConfigId || !source.instance) return;
    catalogLoading.value = true;
    try {
      const tables = unbox<any[]>(
        await listEtlTables(source.dbConfigId, source.instance),
      );
      if (request === catalogRequest)
        catalog.value = source.schema
          ? tables.filter((item) => item.schemaName === source.schema)
          : tables;
    } catch (error) {
      if (request === catalogRequest) ElMessage.error(errorMessage(error));
    } finally {
      if (request === catalogRequest) catalogLoading.value = false;
    }
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
    const input = sqlInput.value?.textarea;
    const start = input?.selectionStart ?? sql.length;
    const end = input?.selectionEnd ?? sql.length;
    target.config.sql = sql.slice(0, start) + name + sql.slice(end);
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
      ElMessage.warning('未能读取字段列表，已插入 SELECT *，请手工补全列');
    }
  } catch (error) {
    if (!current()) return;
    request.apply(`SELECT * FROM ${name}`);
    ElMessage.warning(`读取字段失败，已插入 SELECT *：${errorMessage(error)}`);
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
      ElMessage.error(errorMessage(error));
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
    ElMessage.warning('工作区草稿已变化，请重新开始导入，避免覆盖修改');
    return;
  }
  applyDocument(document);
  selectPipeline(document.pipelines.at(-1)?.id || '');
  kettleWizard.value?.complete();
  ElMessage.success('已追加到草稿，请预检后保存并运行');
  try {
    connections.value = unbox<EtlConnectionOption[]>(await listEtlSources());
  } catch {
    /* 已应用草稿不因目录刷新失败丢失。 */
  }
}

async function openAi() {
  if (!aiResourceRef.value)
    aiResourceRef.value =
      node.value?.resourceRef || resources.value[0]?.[0] || '';
  if (!(await prepareAi())) return;
  aiWindow.value?.open({ scene: 'etl' });
}
/** 每次提问都读取最新完整草稿，并保护无效 JSON 与未授权的数据源。 */
async function prepareAi(): Promise<boolean> {
  if (!(await prepare())) return false;
  const aiJson = JSON.stringify(doc.value);
  if (aiJson.length > 64000) {
    ElMessage.warning(
      '工作区配置超过 AI 编辑上限，请拆分工作区；完整 JSON 仍可手工编辑',
    );
    return false;
  }
  const source = aiSource.value;
  if (!source?.dbConfigId || !source.instance) {
    ElMessage.warning('请先配置工作区数据源');
    return false;
  }
  return true;
}
function aiContext() {
  return { etlWorkspace: JSON.stringify(doc.value), workMode: 'etl' };
}
/** 候选只应用到草稿，需明确确认；历史候选或已变化的草稿不会被静默覆盖。 */
async function applyAi(candidate: {
  workspace: EtlWorkspaceDocument;
  baseJson?: string;
}) {
  if (!candidate?.workspace) return;
  if (!(await prepare())) return;
  const request = draftOperations.begin();
  try {
    const result: any = unbox(
      await validateEtlWorkspace(JSON.stringify(candidate.workspace)),
    );
    if (!draftOperations.current(request)) return;
    if (!result.valid) throw new Error((result.errors || []).join('；'));
    if (
      JSON.stringify(candidate.workspace.resources) !==
      JSON.stringify(doc.value.resources)
    )
      throw new Error('数据源绑定已经变化，请重新生成候选');
    await ElMessageBox.confirm(
      candidate.baseJson === JSON.stringify(doc.value)
        ? '应用 AI 候选到当前草稿？不会自动保存或执行。'
        : '草稿已变化或此候选来自历史会话。应用将替换当前任务配置，请先查看候选 JSON。确认替换？',
      '应用候选配置',
      { type: 'warning', modalClass: 'ai-mask-confirm-overlay' },
    );
    if (!draftOperations.current(request)) return;
    applyDocument(candidate.workspace);
  } catch (error) {
    if (draftOperations.current(request) && error !== 'cancel' && error !== 'close')
      ElMessage.error(errorMessage(error));
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  // 只有成功落盘才允许无提示关闭；存储超限/禁用时仍保护尚未备份的编辑。
  if (!flushActiveDraft()) {
    event.preventDefault();
    event.returnValue = '';
  }
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
onMounted(async () => {
  refreshEtlDirtyIds();
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('click', dismissWorkspaceMenu);
  loading.value = true;
  try {
    const [sourceResponse] = await Promise.all([
      listEtlSources(),
      refreshWorkspaces(),
    ]);
    connections.value = unbox<EtlConnectionOption[]>(sourceResponse) || [];
    if (workspaces.value[0]) await openWorkspace(workspaces.value[0]);
  } catch (error) {
    ElMessage.error(errorMessage(error));
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  flushActiveDraft();
  workspaceRequests.invalidate();
  previewRequests.invalidate();
  tableInsertRequests.invalidate(); draftOperations.invalidate(); catalogRequest++;
  if (cacheTimer) clearTimeout(cacheTimer);
  collabAlive = false;
  if (collabTimer) clearTimeout(collabTimer);
  window.removeEventListener('beforeunload', beforeUnload);
  document.removeEventListener('click', dismissWorkspaceMenu);
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<template>
  <Page auto-content-height class="etl-page">
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
          <el-button
            :disabled="!activeWorkspace"
            :loading="saving"
            @click="saveDraft"
            >{{ $tr('保存') }}</el-button
          >
          <el-button
            :disabled="!activeWorkspace"
            :loading="syncing"
            :title="$tr('拉取对方已保存的更新')"
            @click="syncNow"
            >{{ $tr('同步') }}</el-button
          >
          <el-button :disabled="!activeWorkspace || !isWorkspaceOwner" @click="publish"
            >{{ $tr('发布') }}</el-button
          >
          <el-button
            type="primary"
            :disabled="!pipeline || editorMode === 'json'"
            :loading="running"
            @click="runPipeline"
            >{{ $tr('运行') }}</el-button
          >
          <el-button
            :icon="MagicStick"
            :disabled="!activeWorkspace"
            @click="openAi"
            >{{ $tr('AI 配置') }}</el-button
          >
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
                <el-dropdown-item command="runs">{{ $tr('运行记录') }}</el-dropdown-item>
                <el-dropdown-item command="share">{{ $tr('协同成员') }}</el-dropdown-item>
                <el-dropdown-item command="merge">{{ $tr('合并其他工作区') }}</el-dropdown-item>
                <el-dropdown-item v-if="isWorkspaceOwner" command="schedule">{{ $tr('定时执行') }}</el-dropdown-item>
                <el-dropdown-item v-if="isWorkspaceOwner" command="notify">{{ $tr('消息通知') }}</el-dropdown-item>
                <el-dropdown-item command="rename">{{ $tr('改名') }}</el-dropdown-item>
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
            <el-button
              :icon="Plus"
              circle
              link
              :title="$tr('新建工作区')"
              @click="newVisible = true"
            />
          </div>
          <div
            v-for="workspace in workspaces"
            :key="String(workspace.id)"
            class="workspace-item"
            :class="{
              active: String(workspace.id) === String(activeWorkspace?.id),
              dirty: isWorkspaceDirty(workspace),
            }"
            role="button"
            tabindex="0"
            @click="openWorkspace(workspace, true)"
            @keydown.enter="openWorkspace(workspace, true)"
            @contextmenu.prevent="openWorkspaceMenu($event, workspace)"
          >
            <strong
              >{{ workspaceDisplayName(workspace)
              }}{{ isWorkspaceDirty(workspace) ? ' *' : '' }}</strong
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
              <button v-if="menuTargetIsOwner" @click="configureSchedule">{{ $tr('定时执行配置') }}</button>
              <button v-if="menuTargetIsOwner" @click="configureNotify">{{ $tr('消息通知配置') }}</button>
              <button @click="openShareFromMenu">{{ $tr('协同成员') }}</button>
              <button @click="renameWorkspace">{{ $tr('改名') }}</button>
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
          :class="`tasks-${taskPosition}`"
        >
          <TaskTabs
            :key="String(activeWorkspace.id)"
            class="workspace-tabs"
            :workspace-id="activeWorkspace.id"
            :tasks="doc.pipelines"
            :auto-hide-ids="suppressedPipelineIds"
            :active="activePipelineId"
            :position="taskPosition"
            @select="selectPipeline"
            @add="addPipeline"
            @add-example="addExamplePipeline"
            @delete="removePipeline"
            @position="setTaskPosition"
          />
          <section class="task-content">
            <div v-if="editorMode === 'json'" class="json-panel">
              <JsonEditorPanel
                v-model="jsonText"
                v-model:valid="jsonValid"
                mode="text"
                height="calc(100vh - 290px)"
              />
            </div>
            <template v-else-if="pipeline">
              <div class="pipeline-header">
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
                >
              </div>
              <div class="flow-strip" :aria-label="$tr('步骤流水线')">
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
              <div
                v-if="node"
                class="step-split"
                :class="`result-${resultDock}`"
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
                      v-if="node.type.startsWith('database.')"
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
                        ><el-button
                          link
                          class="source-settings"
                          @click="openSources"
                          >{{ $tr('管理数据源') }}</el-button
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
                            <el-input
                              v-model="catalogSearch"
                              clearable
                              size="small"
                              :placeholder="$tr('筛选表名')"
                            />
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
                      <el-input
                        ref="sqlInput"
                        v-model="node.config.sql"
                        type="textarea"
                        :rows="9"
                        placeholder="SELECT o.id AS order_id, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id"
                        class="sql-editor"
                      />
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
                          ><el-select
                            v-model="node.config.table"
                            filterable
                            allow-create
                            default-first-option
                            :loading="catalogLoading"
                            :placeholder="$tr('选择或输入目标表')"
                            ><el-option
                              v-for="table in catalog"
                              :key="table.qualifiedName || table.tableName"
                              :value="table.qualifiedName || table.tableName"
                              :label="
                                table.qualifiedName || table.tableName
                              " /></el-select
                        ></el-form-item>
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
                        ><el-select
                          v-model="node.config.keyColumns"
                          multiple
                          filterable
                          allow-create
                          default-first-option
                          :placeholder="$tr('例如：order_id')"
                          ><el-option
                            v-for="mapping in node.config.mappings || []"
                            :key="mapping.target"
                            :value="mapping.target"
                            :label="mapping.target" /></el-select
                      ></el-form-item>
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
                          <el-select
                            v-model="node.config.updateColumns"
                            multiple
                            filterable
                            :placeholder="$tr('未设置时更新全部非键字段')"
                            ><el-option
                              v-for="mapping in node.config.mappings || []"
                              :key="mapping.target"
                              :value="mapping.target"
                              :label="mapping.target"
                          /></el-select>
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
                <aside class="step-result" :aria-label="$tr('预览与字段映射')">
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
                    <el-table
                      v-if="previewResult"
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
                      v-for="(mapping, index) in node.config.mappings || []"
                      :key="index"
                      class="mapping-row"
                    >
                      <el-select
                        v-model="mapping.source"
                        filterable
                        allow-create
                        default-first-option
                        :placeholder="$tr('查询结果字段')"
                        ><el-option
                          v-for="column in inputColumns()"
                          :key="column"
                          :value="column"
                          :label="column" /></el-select
                      ><span>→</span
                      ><el-input
                        v-model="mapping.target"
                        :placeholder="$tr('目标字段')"
                      /><el-button
                        link
                        type="danger"
                        @click="node.config.mappings.splice(index, 1)"
                        >{{ $tr('删除') }}</el-button
                      >
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
                      <el-table
                        :data="inputPreview.rows"
                        max-height="240"
                        border
                        ><el-table-column
                          v-for="column in inputPreview.columns"
                          :key="column"
                          :prop="column"
                          :label="column"
                          min-width="120"
                          show-overflow-tooltip
                      /></el-table>
                    </section>
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
    <WorkspaceNotify ref="notifyDialog" />
    <EtlShareDialog ref="shareDialog" />
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
      size="min(800px, 96vw)"
      ><el-button :icon="Refresh" @click="refreshRuns">{{ $tr('刷新') }}</el-button
      ><el-table
        :data="runs"
        highlight-current-row
        @current-change="selectedRun = $event || selectedRun"
        ><el-table-column prop="pipelineName" :label="$tr('任务')" /><el-table-column
          :label="$tr('状态')"
          width="90"
          ><template #default="scope">{{
            statusLabel(scope.row.status)
          }}</template></el-table-column
        ><el-table-column :label="$tr('时间')" width="180"
          ><template #default="scope">{{
            new Date(scope.row.startedAt).toLocaleString()
          }}</template></el-table-column
        ><el-table-column prop="revision" :label="$tr('版本')" width="65" /></el-table
      ><template v-if="selectedRun"
        ><div class="section-title">
          <strong>{{ selectedRun.message }}</strong
          ><el-button
            v-if="['PENDING', 'RUNNING'].includes(selectedRun.status)"
            type="danger"
            plain
            @click="cancelRun"
            >{{ $tr('取消任务') }}</el-button
          >
        </div>
        <el-table :data="runSteps"
          ><el-table-column :label="$tr('步骤')" min-width="140"
            ><template #default="scope">{{
              runNodeName(scope.row.nodeId)
            }}</template></el-table-column
          ><el-table-column :label="$tr('状态')" width="90"
            ><template #default="scope">{{
              statusLabel(scope.row.status)
            }}</template></el-table-column
          ><el-table-column
            prop="rows"
            :label="$tr('行数')"
            width="90" /><el-table-column prop="message" :label="$tr('信息')"
        /></el-table>
        <div class="section-title">
          <strong>{{ $tr('执行日志') }}</strong
          ><el-select
            v-model="logNode"
            clearable
            :placeholder="$tr('全部任务与节点日志')"
            @change="
              logPage = 1;
              refreshLogs();
            "
            ><el-option
              v-for="step in runSteps"
              :key="step.nodeId"
              :label="runNodeName(step.nodeId)"
              :value="step.nodeId"
          /></el-select>
        </div>
        <el-table v-loading="logsBusy" :data="runLogs" max-height="360">
          <el-table-column :label="$tr('时间')" width="180"
            ><template #default="scope">{{
              new Date(scope.row.createdAt).toLocaleString()
            }}</template></el-table-column
          >
          <el-table-column
            prop="level"
            :label="$tr('级别')"
            width="65"
          /><el-table-column :label="$tr('节点')" min-width="120"
            ><template #default="scope">{{
              runNodeName(scope.row.nodeId)
            }}</template></el-table-column
          ><el-table-column
            prop="rowCount"
            :label="$tr('累计行数')"
            width="100"
          /><el-table-column prop="message" :label="$tr('事件')" />
        </el-table>
        <el-pagination
          v-model:current-page="logPage"
          :page-size="50"
          :total="logTotal"
          layout="total, prev, pager, next"
          @current-change="refreshLogs"
        /> </template
    ></el-drawer>
    <AiChatWindow
      v-if="activeWorkspace"
      :key="String(activeWorkspace.id)"
      ref="aiWindow"
      etl-mode
      :db-config-id="aiSource?.dbConfigId"
      :instance-name="aiSource?.instance"
      :conn-label="aiSource?.displayName"
      :before-send="prepareAi"
      :get-extra-context="aiContext"
      @apply-etl-config="applyAi"
    />
  </Page>
</template>

<style scoped>
:global(.etl-runs-drawer) {
  color: var(--el-text-color-primary);
}
.etl-shell {
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  overflow: hidden;
  background: var(--el-bg-color);
  min-height: calc(100vh - 130px);
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
  min-height: calc(100vh - 190px);
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
.workspace-item strong {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-item small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
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
  overflow: auto;
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
.workspace-head,
.task-bar,
.pipeline-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
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
  /* 编辑区与结果区等高，分隔线才能铺满 */
  align-items: stretch;
}
.step-split.result-right {
  grid-template-columns: minmax(320px, 1.15fr) minmax(280px, 0.9fr);
}
.step-split.result-bottom {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto;
}
.step-split.result-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.step-result {
  min-width: 0;
  min-height: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 8px 16px 24px;
  background: var(--el-fill-color-lighter);
}
.step-split.result-right .step-result {
  border-left: 1px solid var(--el-border-color-light);
}
.step-split.result-bottom .step-result {
  border-left: 0;
  border-top: 1px solid var(--el-border-color-light);
  min-height: 0;
  height: auto;
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
  min-height: 100%;
  height: 100%;
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
/* 数据源选择框与「管理数据源」同一行 */
.inline-control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.inline-control > .el-select {
  flex: 1;
  min-width: 0;
  width: auto !important;
}
.source-settings {
  flex: 0 0 auto;
  margin-left: 0;
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
.sql-editor :deep(textarea) {
  font-family: Consolas, monospace;
  font-size: 14px;
  line-height: 1.65;
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
.write-grid .el-select {
  width: 100% !important;
}
.mapping-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.mapping-row > .el-select,
.mapping-row > .el-input {
  flex: 1;
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
</style>
