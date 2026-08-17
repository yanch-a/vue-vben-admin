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

  async function refreshList() {
    try {
      const res: any = await listDbCopyTasks();
      tasks.value = unwrapList(res);
    } catch {
      /* 静默：轮询失败不打断 UI */
    }
  }

  async function refreshActive() {
    if (!activeTaskId.value) return;
    try {
      const res: any = await getDbCopyTask(activeTaskId.value);
      const task = unwrapTask(res);
      if (!task) return;
      const idx = tasks.value.findIndex((t) => t.taskId === task.taskId);
      if (idx >= 0) {
        tasks.value[idx] = task;
      } else {
        tasks.value.unshift(task);
      }
      if (!isActiveStatus(task.status)) {
        stopIfIdle();
      }
    } catch {
      /* ignore */
    }
  }

  function startPolling() {
    if (polling.value) return;
    polling.value = true;
    timer = setInterval(async () => {
      await refreshList();
      if (activeTaskId.value && progressVisible.value) {
        await refreshActive();
      }
      stopIfIdle();
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
    await cancelDbCopyTask(activeTaskId.value);
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
