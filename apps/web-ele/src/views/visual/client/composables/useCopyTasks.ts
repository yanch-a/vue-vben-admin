/**
 * 跨主机复制任务状态（客户端轮询）
 * @author yanch
 */
import { computed, ref } from 'vue';

import {
  cancelDbCopyTask,
  getDbCopyTask,
  listDbCopyTasks,
  type DbCopyTaskVO,
} from '#/api/visual/dbCopy';

const tasks = ref<DbCopyTaskVO[]>([]);
const activeTaskId = ref<string | null>(null);
const progressVisible = ref(false);
const polling = ref(false);
let listInFlight = false;
let detailInFlight = false;
let pollInFlight = false;
let timer: ReturnType<typeof setInterval> | null = null;

function unwrapList(res: any): DbCopyTaskVO[] {
  const data = res?.data ?? res;
  return Array.isArray(data) ? data : [];
}

function unwrapTask(res: any): DbCopyTaskVO | null {
  const data = res?.data ?? res;
  return data && data.taskId ? data : null;
}

function isActiveStatus(status?: string) {
  return status === 'PENDING' || status === 'RUNNING';
}

export function useCopyTasks() {
  const activeTask = computed(
    () => tasks.value.find((t) => t.taskId === activeTaskId.value) ?? null,
  );

  const runningCount = computed(
    () => tasks.value.filter((t) => isActiveStatus(t.status)).length,
  );

  const hasRunning = computed(() => runningCount.value > 0);

  /** 刷新任务列表；定时轮询传 false，避免后台异常弹窗。 */
  async function refreshList(showErrorMessage = true) {
    const requestedAt = Date.now();
    if (listInFlight) return;
    listInFlight = true;
    try {
      const res: any = await listDbCopyTasks(showErrorMessage);
      const incoming = unwrapList(res);
      const ids = new Set(incoming.map((task) => task.taskId));
      const byId = new Map(tasks.value.filter((task) => ids.has(task.taskId) || (task.createTime || 0) >= requestedAt || task.taskId === activeTaskId.value).map((task) => [task.taskId, task]));
      for (const task of incoming) {
        const previous = byId.get(task.taskId);
        if (previous && !isActiveStatus(previous.status) && isActiveStatus(task.status)) continue;
        if (!previous || (task.updateTime || 0) >= (previous.updateTime || 0)) byId.set(task.taskId, { ...task, cancelRequested: task.cancelRequested || previous?.cancelRequested });
      }
      tasks.value = [...byId.values()].sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
    } catch {
      /* 静默：轮询失败不打断 UI */
    } finally { listInFlight = false; }
  }

  /** 刷新当前任务；定时轮询传 false，避免后台异常弹窗。 */
  async function refreshActive(showErrorMessage = true) {
    if (!activeTaskId.value || detailInFlight) return;
    detailInFlight = true;
    try {
      const res: any = await getDbCopyTask(
        activeTaskId.value,
        showErrorMessage,
      );
      const task = unwrapTask(res);
      if (!task) return;
      const idx = tasks.value.findIndex((t) => t.taskId === task.taskId);
      if (idx >= 0) {
        const previous = tasks.value[idx];
        if (previous && !isActiveStatus(previous.status) && isActiveStatus(task.status)) return;
        if (!previous || (task.updateTime || 0) >= (previous.updateTime || 0)) tasks.value[idx] = { ...task, cancelRequested: task.cancelRequested || previous?.cancelRequested };
      } else {
        tasks.value.unshift(task);
      }
      if (!isActiveStatus(task.status)) {
        stopIfIdle();
      }
    } catch {
      /* ignore */
    } finally { detailInFlight = false; }
  }

  function startPolling() {
    if (polling.value) return;
    polling.value = true;
    timer = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        await refreshList(false);
        if (activeTaskId.value && progressVisible.value) await refreshActive(false);
        stopIfIdle();
      } finally { pollInFlight = false; }
    }, 1500);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    polling.value = false;
  }

  function stopIfIdle() {
    if (!hasRunning.value) {
      stopPolling();
    }
  }

  /**
   * 任务启动后：设为当前任务、打开进度面板并开始轮询
   */
  function onTaskStarted(task: DbCopyTaskVO) {
    if (!task?.taskId) return;
    const idx = tasks.value.findIndex((t) => t.taskId === task.taskId);
    if (idx >= 0) {
      tasks.value[idx] = task;
    } else {
      tasks.value.unshift(task);
    }
    activeTaskId.value = task.taskId;
    progressVisible.value = true;
    startPolling();
  }

  function openTask(taskId: string) {
    activeTaskId.value = taskId;
    progressVisible.value = true;
    refreshActive();
    if (hasRunning.value) {
      startPolling();
    }
  }

  function hideProgress() {
    progressVisible.value = false;
  }

  async function cancelActive() {
    if (!activeTaskId.value) return;
    const id = activeTaskId.value;
    await cancelDbCopyTask(id);
    const task = tasks.value.find((item) => item.taskId === id);
    if (task && isActiveStatus(task.status)) { task.cancelRequested = true; task.message = '正在取消，等待本表回滚'; }
    await refreshActive();
    await refreshList();
  }

  return {
    tasks,
    activeTaskId,
    activeTask,
    progressVisible,
    runningCount,
    hasRunning,
    refreshList,
    onTaskStarted,
    openTask,
    hideProgress,
    cancelActive,
    startPolling,
  };
}
