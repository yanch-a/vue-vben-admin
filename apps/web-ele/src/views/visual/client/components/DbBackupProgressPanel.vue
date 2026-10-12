<script lang="ts" setup>
/**
 * 整库备份进度。可以最小化，最小化后任务留在右上角后台任务里。
 * @author yanch
 */
import { computed } from 'vue';

import type { ClientTask } from '../composables/useClientTasks';
import { taskIndeterminate, taskPercent, transferSize } from '../composables/clientTaskDisplay';

defineOptions({ name: 'DbBackupProgressPanel' });

const props = defineProps<{
  modelValue: boolean;
  task: ClientTask | null;
  downloading?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  minimize: [];
  cancel: [];
  download: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const statusText = computed(() => {
  const map: Record<string, string> = {
    PENDING: '等待中',
    RUNNING: '导出中',
    SUCCESS: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  return map[props.task?.status || ''] || props.task?.status || '-';
});

const indeterminate = computed(() => {
  const task = props.task;
  if (!task) return false;
  return taskIndeterminate(task);
});

const percent = computed(() => {
  const task = props.task;
  if (!task) return 0;
  return taskPercent(task);
});

const canCancel = computed(() => {
  const status = props.task?.status;
  return (status === 'PENDING' || status === 'RUNNING') && !props.task?.cancelRequested;
});

const canDownload = computed(
  () => props.task?.status === 'SUCCESS' && !!props.task.downloadReady,
);

function formatSize(bytes?: number) {
  return transferSize(bytes);
}

function durationText(ms?: number) {
  if (!ms || ms < 1000) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="$tr('导出/备份进度')"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="emit('minimize')"
  >
    <div v-if="!task" class="empty">{{ $tr('正在提交备份任务') }}</div>
    <template v-else>
      <div class="meta">
        <strong>{{ task.title }}</strong>
        <span class="status">{{ statusText }}</span>
      </div>
      <div v-if="task.subtitle" class="sub">{{ task.subtitle }}</div>
      <ElProgress
        :percentage="indeterminate ? 50 : percent"
        :indeterminate="indeterminate"
        :show-text="!indeterminate"
        :stroke-width="10"
        :status="
          task.status === 'FAILED'
            ? 'exception'
            : task.status === 'SUCCESS'
              ? 'success'
              : undefined
        "
        :aria-label="$tr('备份进度')"
      />
      <div class="detail">
        <div v-if="task.total">
          {{ $tr('表进度：') }}{{ task.done }} / {{ task.total }}
        </div>
        <div v-if="task.current">{{ $tr('当前：') }}{{ task.current }}</div>
        <div v-if="formatSize(task.fileSize)">
          {{ $tr('文件大小：') }}{{ formatSize(task.fileSize) }}
          <span v-if="task.zipped">{{ $tr('（已压缩为 ZIP）') }}</span>
        </div>
        <div v-if="durationText(task.elapsedMs)">
          {{ $tr('耗时：') }}{{ durationText(task.elapsedMs) }}
        </div>
        <div v-if="task.message" class="msg">{{ task.message }}</div>
        <div v-if="task.fileName && canDownload" class="file">
          {{ $tr('文件：') }}{{ task.fileName }}
        </div>
      </div>
      <div v-if="task.errors.length" class="errors" role="alert">
        <div v-for="(err, index) in task.errors.slice(0, 3)" :key="index">{{ err }}</div>
      </div>
    </template>
    <template #footer>
      <ElButton v-if="canCancel" type="danger" plain @click="emit('cancel')">
        {{ $tr('取消') }}
      </ElButton>
      <ElButton
        v-if="canDownload"
        type="primary"
        :loading="downloading"
        @click="emit('download')"
      >
        {{ $tr('下载') }}
      </ElButton>
      <ElButton @click="emit('minimize')">{{ $tr('最小化') }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  font-size: var(--vc-ui-font-size, 13px);
}
.status {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.sub {
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--vc-ui-font-size-sm, 12px);
}
.detail {
  margin-top: 12px;
  font-size: var(--vc-ui-font-size, 13px);
  line-height: 1.7;
  color: var(--el-text-color-regular);
}
.msg,
.file {
  word-break: break-all;
}
.errors {
  margin-top: 12px;
  color: var(--el-color-danger);
  font-size: var(--vc-ui-font-size-sm, 12px);
  line-height: 1.5;
  word-break: break-all;
}
</style>
