/**
 * 客户端后台任务：跨主机复制 + 结构文档（初始化/生成/分析）。
 * 进行中写入 localStorage，刷新后角标还能显示；服务端 Redis 是权威源。
 * 只在面板打开时查一次；有进行中才 10 秒轮询；关掉面板立刻停刷。
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
const POLL_MS = 10_000;
const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const tasks = ref<ClientTask[]>([]);
const panelVisible = ref(false);
const activeTab = ref<'running' | 'done'>('running');
const polling = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
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
    // 服务端列表是权威源。某一侧接口失败才保留该侧本地进行中，避免一次失败把进度抹掉。
    const keepSource = new Set<ClientTaskSource>();
    if (copyRes.status === 'fulfilled') keepSource.add('copy');
    if (schemaRes.status === 'fulfilled') keepSource.add('schema');
    const seen = new Set(next.map((t) => `${t.source}:${t.id}`));
    const leftover = tasks.value.filter((t) => {
      const key = `${t.source}:${t.id}`;
      // 服务端已带回同一条（含终态）时，绝不能再留本地 PENDING
      if (seen.has(key)) return false;
      if (!isActive(t.status)) return false;
      if (keepSource.has(t.source)) return false;
      return true;
    });
    tasks.value = [...next, ...leftover];
    pruneCompleted();
    persistRunning();

    // 列表接口失败时，对钉住的本地进行中逐条问详情，拿到 SUCCESS 才能从进行中摘掉
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

  function startPolling() {
    if (polling.value) return;
    polling.value = true;
    timer = setInterval(async () => {
      await refreshAll();
      if (!hasRunning.value) {
        stopPolling();
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    polling.value = false;
  }

  async function onPanelOpened() {
    await refreshAll();
    if (hasRunning.value) {
      startPolling();
    } else {
      stopPolling();
    }
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
    stopPolling();
  }

  function togglePanel() {
    if (panelVisible.value) {
      hidePanel();
      return;
    }
    openPanel(hasRunning.value ? 'running' : 'done');
  }

  /** 复制任务启动后立刻入列表并打开面板 */
  function trackCopy(raw: DbCopyTaskVO) {
    if (!raw?.taskId) return;
    upsert(fromCopy(raw));
    persistRunning();
    openPanel('running');
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

  /** 页面进入只恢复角标缓存，不打开面板、不轮询 */
  async function bootstrap() {
    restoreCache();
    pruneCompleted();
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
        stopPolling();
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
