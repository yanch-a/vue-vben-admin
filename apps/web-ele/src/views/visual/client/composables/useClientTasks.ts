/**
 * 客户端后台任务：跨主机复制 + 结构文档（初始化/生成/分析）。
 * 进行中写入 localStorage，刷新后角标还能显示；服务端 Redis 是权威源。
 * 有进行中就轮询：面板打开 5 秒一次，收起后台 20 秒一次。
 * 刚提交的任务会立刻拉一次详情，避免等第一个 interval。
 * 已完成只展示近 7 天。
 * @author yanch
 */
import { computed, ref, watch } from 'vue';

import {
  cancelSchemaDocTask,
  schemaDocTask,
  schemaDocTaskList,
} from '#/api/ai/schemaDoc';
import {
  cancelDbCopyTask,
  getDbCopyTask,
  listDbCopyTasks,
  type DbCopyTaskVO,
} from '#/api/visual/dbCopy';

export type ClientTaskKind = 'COPY' | 'SCHEMA_INIT' | 'SCHEMA_GENERATE' | 'SCHEMA_ANALYZE';
export type ClientTaskSource = 'copy' | 'schema';

export interface ClientTask {
  id: string;
  source: ClientTaskSource;
  kind: ClientTaskKind;
  title: string;
  subtitle: string;
  status: string;
  total: number;
  done: number;
  current?: string;
  message?: string;
  createTime: number;
  updateTime?: number;
  errors: string[];
}

const CACHE_KEY = 'vc:client-running-tasks';
/** 面板可见时的轮询间隔 */
const POLL_VISIBLE_MS = 5_000;
/** 面板收起后后台继续刷，间隔放宽 */
const POLL_HIDDEN_MS = 20_000;
const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const tasks = ref<ClientTask[]>([]);
const panelVisible = ref(false);
const activeTab = ref<'running' | 'done'>('running');
const polling = ref(false);
const refreshing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
/** 当前 timer 用的间隔，切换可见/后台时要重建 */
let timerMs = 0;
let panelWatchBound = false;

/** 后端可能给字符串，复制任务枚举序列化偶发成对象 */
function normalizeStatus(status: unknown): string {
  if (status == null) return '';
  if (typeof status === 'object') {
    const o = status as { name?: string; status?: string };
    return String(o.name || o.status || '').toUpperCase();
  }
  return String(status).toUpperCase();
}

function isActive(status?: unknown) {
  const s = normalizeStatus(status);
  return s === 'PENDING' || s === 'RUNNING';
}

function unwrapList(res: any): any[] {
  const data = res?.data ?? res;
  return Array.isArray(data) ? data : [];
}

function unwrapOne(res: any): any | null {
  const data = res?.data ?? res;
  return data && (data.taskId || data.id) ? data : null;
}

function schemaKind(type?: string): ClientTaskKind {
  if (type === 'INIT') return 'SCHEMA_INIT';
  if (type === 'ANALYZE') return 'SCHEMA_ANALYZE';
  return 'SCHEMA_GENERATE';
}

function schemaTitle(type?: string) {
  if (type === 'INIT') return '初始化骨架';
  if (type === 'ANALYZE') return '分析查询历史';
  return 'AI 生成文档';
}

function copyTitle(raw: DbCopyTaskVO) {
  const from = raw.sourceInstance || '源库';
  const to = raw.targetInstance || '目标库';
  return `复制 ${from} → ${to}`;
}

function fromCopy(raw: DbCopyTaskVO): ClientTask {
  return {
    id: raw.taskId,
    source: 'copy',
    kind: 'COPY',
    title: copyTitle(raw),
    subtitle: raw.mode === 'structure' ? '仅结构' : '结构 + 数据',
    status: normalizeStatus(raw.status),
    total: raw.totalObjects || 0,
    done: raw.processedObjects || 0,
    current: raw.currentObject,
    message: raw.message,
    createTime: raw.createTime || 0,
    updateTime: raw.updateTime,
    errors: (raw.errors || []).map((e) =>
      [e.objectName, e.phase ? `[${e.phase}]` : '', e.message].filter(Boolean).join(' '),
    ),
  };
}

function fromSchema(raw: any): ClientTask {
  const scope = [raw.dbName, raw.instanceName].filter(Boolean).join(' / ');
  return {
    id: raw.taskId,
    source: 'schema',
    kind: schemaKind(raw.type),
    title: schemaTitle(raw.type),
    subtitle: scope,
    status: normalizeStatus(raw.status),
    total: raw.total || 0,
    done: raw.done || 0,
    current: raw.currentTable,
    message: raw.message,
    createTime: raw.createTime || 0,
    updateTime: raw.updateTime,
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  };
}

function upsert(task: ClientTask) {
  const idx = tasks.value.findIndex((t) => t.id === task.id && t.source === task.source);
  if (idx >= 0) {
    tasks.value[idx] = task;
  } else {
    tasks.value.unshift(task);
  }
}

function persistRunning() {
  try {
    const running = tasks.value.filter((t) => isActive(t.status));
    localStorage.setItem(CACHE_KEY, JSON.stringify(running));
  } catch {
    /* 隐私模式等写不进就忽略 */
  }
}

function restoreCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    for (const t of list) {
      if (t?.id && t?.source && isActive(t.status)) {
        upsert(t);
      }
    }
  } catch {
    /* 坏缓存丢掉即可 */
  }
}

function pruneCompleted() {
  const cutoff = Date.now() - DONE_WINDOW_MS;
  // 进行中一律保留；已完成只留近 7 天
  tasks.value = tasks.value.filter((t) => isActive(t.status) || (t.createTime || 0) >= cutoff);
}

export function useClientTasks() {
  const runningTasks = computed(() => tasks.value.filter((t) => isActive(t.status)));
  const doneTasks = computed(() => {
    const cutoff = Date.now() - DONE_WINDOW_MS;
    return tasks.value
      .filter((t) => !isActive(t.status) && (t.createTime || 0) >= cutoff)
      .sort((a, b) => (b.updateTime || b.createTime) - (a.updateTime || a.createTime));
  });
  const runningCount = computed(() => runningTasks.value.length);
  const hasRunning = computed(() => runningCount.value > 0);

  function percent(t: ClientTask) {
    if (!t.total) return t.status === 'SUCCESS' ? 100 : 0;
    return Math.min(100, Math.round((t.done / t.total) * 100));
  }

  async function refreshAll() {
    refreshing.value = true;
    try {
      await doRefreshAll();
    } finally {
      refreshing.value = false;
    }
  }

  async function doRefreshAll() {
    const wasRunningKeys = new Set(
      tasks.value.filter((t) => isActive(t.status)).map((t) => `${t.source}:${t.id}`),
    );
    const [copyRes, schemaRes] = await Promise.allSettled([listDbCopyTasks(), schemaDocTaskList()]);
    const next: ClientTask[] = [];
    if (copyRes.status === 'fulfilled') {
      for (const raw of unwrapList(copyRes.value)) {
        if (raw?.taskId) next.push(fromCopy(raw));
      }
    }
    if (schemaRes.status === 'fulfilled') {
      for (const raw of unwrapList(schemaRes.value)) {
        if (raw?.taskId) next.push(fromSchema(raw));
      }
    }
    // 刚提交的任务列表可能还没带上，进行中即使不在列表里也先钉住，再 refreshOne。
    const seen = new Set(next.map((t) => `${t.source}:${t.id}`));
    const leftover = tasks.value.filter((t) => {
      const key = `${t.source}:${t.id}`;
      // 服务端已带回同一条（含终态）时，绝不能再留本地 PENDING
      if (seen.has(key)) return false;
      if (!isActive(t.status)) return false;
      return true;
    });
    tasks.value = [...next, ...leftover];
    pruneCompleted();
    persistRunning();

    // 列表里还没有、或该侧接口失败：逐条问详情，避免刚提交的任务被抹掉
    if (leftover.length) {
      await Promise.all(leftover.map((t) => refreshOne(t)));
      pruneCompleted();
      persistRunning();
    }

    // 刚才还在跑、现在都结束了：切到「已完成」，避免人还盯着空的进行中页签
    const stillRunning = tasks.value.some((t) => isActive(t.status));
    if (panelVisible.value && wasRunningKeys.size > 0 && !stillRunning) {
      activeTab.value = 'done';
    }
  }

  async function refreshOne(task: ClientTask) {
    try {
      const res: any =
        task.source === 'copy' ? await getDbCopyTask(task.id) : await schemaDocTask(task.id);
      const raw = unwrapOne(res);
      if (!raw) return;
      upsert(task.source === 'copy' ? fromCopy(raw) : fromSchema(raw));
      persistRunning();
    } catch (e: any) {
      const msg = String(e?.message || e?.msg || '');
      // 过期/不存在：从进行中拿掉，避免本地占位永远 PENDING
      if (msg.includes('不存在') || msg.includes('过期')) {
        upsert({
          ...task,
          status: 'FAILED',
          message: '任务已过期或不存在',
        });
        persistRunning();
      }
    }
  }

  function pollInterval() {
    return panelVisible.value ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
  }

  /** 按当前面板可见性重建 interval；已在跑且间隔没变则不动 */
  function startPolling() {
    const ms = pollInterval();
    if (polling.value && timer && timerMs === ms) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    polling.value = true;
    timerMs = ms;
    timer = setInterval(async () => {
      await refreshAll();
      if (!hasRunning.value) {
        stopPolling();
      }
    }, ms);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    polling.value = false;
    timerMs = 0;
  }

  /** 有进行中就按可见/后台间隔轮询；没有就停 */
  function syncPolling() {
    if (hasRunning.value) {
      startPolling();
    } else {
      stopPolling();
    }
  }

  async function onPanelOpened() {
    await refreshAll();
    syncPolling();
  }

  function openPanel(tab: 'running' | 'done' = 'running') {
    const alreadyOpen = panelVisible.value;
    activeTab.value = tab;
    panelVisible.value = true;
    // 已经打开时 watch 不会再触发，补一次查询/轮询
    if (alreadyOpen) {
      void onPanelOpened();
    }
  }

  function hidePanel() {
    panelVisible.value = false;
  }

  function togglePanel() {
    if (panelVisible.value) {
      hidePanel();
      return;
    }
    openPanel(hasRunning.value ? 'running' : 'done');
  }

  /** 复制任务启动后立刻入列表、拉一次详情并打开面板 */
  function trackCopy(raw: DbCopyTaskVO) {
    if (!raw?.taskId) return;
    const task = fromCopy(raw);
    upsert(task);
    persistRunning();
    openPanel('running');
    void refreshOne(task).then(() => syncPolling());
  }

  /** 结构文档任务只拿到 taskId 时先占位，再拉一次详情 */
  async function trackSchema(taskId: string, hint?: Partial<ClientTask>) {
    if (!taskId || taskId.includes('[object') || taskId.includes(',')) return;
    upsert({
      id: taskId,
      source: 'schema',
      kind: hint?.kind || 'SCHEMA_GENERATE',
      title: hint?.title || '结构文档任务',
      subtitle: hint?.subtitle || '',
      status: 'PENDING',
      total: 0,
      done: 0,
      message: '已提交，等待进度…',
      createTime: Date.now(),
      errors: [],
    });
    persistRunning();
    openPanel('running');
    await refreshOne({
      id: taskId,
      source: 'schema',
      kind: hint?.kind || 'SCHEMA_GENERATE',
      title: '',
      subtitle: '',
      status: 'PENDING',
      total: 0,
      done: 0,
      createTime: Date.now(),
      errors: [],
    });
    syncPolling();
  }

  async function cancel(task: ClientTask) {
    if (task.source === 'copy') {
      await cancelDbCopyTask(task.id);
    } else {
      await cancelSchemaDocTask(task.id);
    }
    // 本地立刻标取消：僵尸任务后端也会写成 CANCELLED，避免刷新后又变进行中
    upsert({
      ...task,
      status: 'CANCELLED',
      message: '已取消',
    });
    persistRunning();
    try {
      await refreshAll();
    } catch {
      /* 列表刷新失败也保留本地已取消 */
    }
  }

  /** 页面进入恢复角标；有进行中先拉一次，再按后台间隔继续刷 */
  async function bootstrap() {
    restoreCache();
    pruneCompleted();
    if (hasRunning.value) {
      await refreshAll();
    }
    syncPolling();
  }

  function dispose() {
    stopPolling();
  }

  if (!panelWatchBound) {
    panelWatchBound = true;
    watch(panelVisible, (open) => {
      if (open) {
        void onPanelOpened();
      } else {
        // 收起后面板不关轮询，只把间隔从 5s 换成 20s
        syncPolling();
      }
    });
  }

  return {
    tasks,
    runningTasks,
    doneTasks,
    runningCount,
    hasRunning,
    panelVisible,
    activeTab,
    refreshing,
    percent,
    bootstrap,
    dispose,
    refreshAll,
    trackCopy,
    trackSchema,
    cancel,
    openPanel,
    hidePanel,
    togglePanel,
    startPolling,
  };
}
