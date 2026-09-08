<script lang="ts" setup>
/**
 * 右上角悬浮任务进度：进行中 / 近 7 天已完成。
 * 数据来自 useClientTasks（复制 + 结构文档）。
 * @author yanch
 */
import { computed } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';

import type { ClientTask } from '../composables/useClientTasks';

defineOptions({ name: 'ClientTaskPanel' });

const props = defineProps<{
  modelValue: boolean;
  tab: 'running' | 'done';
  running: ClientTask[];
  done: ClientTask[];
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  'update:tab': ['running' | 'done'];
  cancel: [task: ClientTask];
  refresh: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});
const activeTab = computed({
  get: () => props.tab,
  set: (v) => emit('update:tab', v),
});

function isRunningStatus(s?: string) {
  return s === 'PENDING' || s === 'RUNNING';
}

const list = computed(() =>
  activeTab.value === 'running'
    ? props.running.filter((t) => isRunningStatus(t.status))
    : props.done.filter((t) => !isRunningStatus(t.status)),
);

function isRunning(t: ClientTask) {
  return isRunningStatus(t.status);
}

const statusText: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '进行中',
  SUCCESS: '已完成',
  PARTIAL: '部分完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

function statusType(s?: string) {
  if (s === 'SUCCESS') return 'success';
  if (s === 'FAILED') return 'danger';
  if (s === 'PARTIAL') return 'warning';
  if (s === 'CANCELLED') return 'info';
  return 'warning';
}

function percent(t: ClientTask) {
  if (!t.total) return t.status === 'SUCCESS' ? 100 : 0;
  return Math.min(100, Math.round((t.done / t.total) * 100));
}

function progressStatus(t: ClientTask) {
  if (t.status === 'FAILED') return 'exception';
  if (t.status === 'SUCCESS') return 'success';
  return undefined;
}

function timeText(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function canCancel(t: ClientTask) {
  return isRunningStatus(t.status);
}

async function onCancel(t: ClientTask) {
  try {
    await ElMessageBox.confirm(`确认取消「${t.title}」？`, '取消任务', { type: 'warning' });
    emit('cancel', t);
  } catch {
    /* 用户关闭确认框 */
  }
}
</script>

<template>
  <div v-show="visible" class="task-float" role="dialog" aria-label="后台任务进度">
    <div class="head">
      <strong>后台任务</strong>
      <ElBadge :value="running.length" :hidden="!running.length" class="badge">
        <span class="hint">进行中 {{ running.length }}</span>
      </ElBadge>
      <ElButton
        class="refresh"
        size="small"
        circle
        :icon="Refresh"
        title="立即刷新进度"
        :loading="refreshing"
        @click="emit('refresh')"
      />
      <button class="close" type="button" title="收起" @click="visible = false">×</button>
    </div>
    <ElTabs v-model="activeTab" class="tabs" stretch>
      <ElTabPane name="running">
        <template #label>进行中 ({{ running.length }})</template>
      </ElTabPane>
      <ElTabPane name="done">
        <template #label>已完成 ({{ done.length }})</template>
      </ElTabPane>
    </ElTabs>
    <ElScrollbar max-height="360px">
      <div v-if="!list.length" class="empty">
        {{ activeTab === 'running' ? '没有进行中的任务' : '近 7 天没有已完成任务' }}
      </div>
      <div v-for="t in list" :key="`${t.source}-${t.id}`" class="card">
        <div class="card-top">
          <span class="title">{{ t.title }}</span>
          <ElTag size="small" :type="statusType(t.status)">{{ statusText[t.status] || t.status }}</ElTag>
        </div>
        <div v-if="t.subtitle" class="sub">{{ t.subtitle }}</div>
        <ElProgress
          :percentage="percent(t)"
          :status="progressStatus(t)"
          :stroke-width="8"
        />
        <div v-if="t.message" class="step">
          <span class="step-k">{{ isRunning(t) ? '正在' : '结果' }}</span>
          <span>{{ t.message }}</span>
        </div>
        <div class="meta">
          <span v-if="t.total">{{ t.done }} / {{ t.total }}</span>
          <span v-if="t.current && isRunning(t)">对象 {{ t.current }}</span>
          <span class="time">{{ timeText(t.updateTime || t.createTime) }}</span>
        </div>
        <div v-if="t.errors.length" class="errs">
          <div v-for="(e, i) in t.errors.slice(0, 3)" :key="i">{{ e }}</div>
          <div v-if="t.errors.length > 3">还有 {{ t.errors.length - 3 }} 条</div>
        </div>
        <div v-if="canCancel(t)" class="actions">
          <ElButton size="small" type="danger" plain @click="onCancel(t)">取消</ElButton>
        </div>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped>
.task-float {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 2100;
  width: 360px;
  max-width: calc(100vw - 24px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}
.head strong {
  font-size: 14px;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.refresh {
  margin-left: auto;
}
.close {
  border: 0;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.tabs {
  padding: 0 8px;
}
.tabs :deep(.el-tabs__header) {
  margin: 0 0 6px;
}
.empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.card {
  margin: 0 10px 10px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.title {
  font-weight: 600;
  font-size: 13px;
}
.sub,
.meta,
.errs {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.step {
  margin-top: 8px;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  border-radius: 6px;
  word-break: break-all;
}
.step-k {
  margin-right: 6px;
  color: var(--el-color-primary);
  font-weight: 600;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.time {
  margin-left: auto;
}
.errs {
  margin-top: 6px;
  color: var(--el-color-danger);
  word-break: break-all;
}
.actions {
  margin-top: 8px;
  text-align: right;
}
</style>
