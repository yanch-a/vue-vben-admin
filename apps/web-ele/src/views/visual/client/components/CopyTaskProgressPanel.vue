<script lang="ts" setup>
/**
 * 跨主机复制任务进度面板
 * @author yanch
 */
import { computed } from 'vue';

import type { DbCopyTaskVO } from '#/api/visual/dbCopy';

defineOptions({ name: 'CopyTaskProgressPanel' });

const props = defineProps<{
  modelValue: boolean;
  task: DbCopyTaskVO | null;
  /** 任务列表（下拉切换） */
  tasks?: DbCopyTaskVO[];
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  hide: [];
  cancel: [];
  select: [taskId: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const percent = computed(() => {
  const t = props.task;
  if (!t) return 0;
  if (typeof t.progressPercent === 'number') return t.progressPercent;
  if (!t.totalObjects) return 0;
  return Math.min(
    100,
    Math.round((t.processedObjects * 100) / t.totalObjects),
  );
});

const statusText = computed(() => {
  const s = props.task?.status;
  const map: Record<string, string> = {
    PENDING: '等待中',
    RUNNING: '执行中',
    SUCCESS: '已完成',
    PARTIAL: '部分成功',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  return map[s || ''] || s || '-';
});

const canCancel = computed(() => {
  const s = props.task?.status;
  return s === 'PENDING' || s === 'RUNNING';
});

const errors = computed(() => props.task?.errors || []);
</script>

<template>
  <ElDialog
    v-model="visible"
    title="复制任务进度"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
    @close="emit('hide')"
  >
    <div v-if="!task" class="empty">暂无任务</div>
    <template v-else>
      <div v-if="tasks && tasks.length > 1" class="task-switch">
        <span class="label">任务</span>
        <ElSelect
          :model-value="task.taskId"
          style="flex: 1"
          @change="(id: string) => emit('select', id)"
        >
          <ElOption
            v-for="t in tasks"
            :key="t.taskId"
            :label="`${t.sourceInstance || ''} → ${t.targetInstance || ''} (${t.status})`"
            :value="t.taskId"
          />
        </ElSelect>
      </div>

      <div class="meta">
        <div>
          {{ task.sourceInstance }} → {{ task.targetInstance }}
        </div>
        <div class="status">状态：{{ statusText }}</div>
      </div>

      <ElProgress
        :percentage="percent"
        :status="
          task.status === 'FAILED'
            ? 'exception'
            : task.status === 'SUCCESS'
              ? 'success'
              : undefined
        "
      />

      <div class="detail">
        <div>进度：{{ task.processedObjects }} / {{ task.totalObjects }}</div>
        <div v-if="task.currentObject">当前：{{ task.currentObject }}</div>
        <div>
          成功 {{ task.successCount || 0 }}，失败 {{ task.failedCount || 0 }}
        </div>
        <div v-if="task.message" class="msg">{{ task.message }}</div>
      </div>

      <div v-if="errors.length" class="errors">
        <div class="err-title">异常（最多显示 1000 条）</div>
        <ElScrollbar max-height="160px">
          <div v-for="(e, i) in errors" :key="i" class="err-item">
            <strong>{{ e.objectName }}</strong>
            <span v-if="e.phase"> [{{ e.phase }}]</span>
            ：{{ e.message }}
          </div>
        </ElScrollbar>
      </div>
    </template>

    <template #footer>
      <ElButton v-if="canCancel" type="danger" plain @click="emit('cancel')">
        取消任务
      </ElButton>
      <ElButton @click="emit('hide'); visible = false">隐藏</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.task-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.label {
  font-size: var(--vc-ui-font-size, 13px);
  white-space: nowrap;
}
.meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: var(--vc-ui-font-size, 13px);
}
.status {
  color: var(--el-text-color-secondary);
}
.detail {
  margin-top: 12px;
  font-size: var(--vc-ui-font-size, 13px);
  line-height: 1.7;
  color: var(--el-text-color-regular);
}
.msg {
  color: var(--el-text-color-secondary);
}
.errors {
  margin-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 10px;
}
.err-title {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: var(--vc-ui-font-size, 13px);
}
.err-item {
  font-size: var(--vc-ui-font-size-sm, 12px);
  line-height: 1.5;
  color: var(--el-color-danger);
  margin-bottom: 4px;
  word-break: break-all;
}
</style>
