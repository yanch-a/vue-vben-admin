<script setup lang="ts">
/** 「更多」→定时任务日志：只看触发历史，可点进某次运行的步骤日志。@author yanch */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import type {
  EtlScheduleDetail,
  EtlScheduleFire,
  EtlWorkspaceRow,
} from '#/api/visual/etl';
import { getEtlRun, getEtlSchedule } from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';

function say(
  type: 'success' | 'warning' | 'info' | 'error',
  message: unknown,
) {
  ElMessage[type](translateUiText(message));
}

const emit = defineEmits<{
  logs: (workspaceId: string | number, runId: string) => void;
}>();

const visible = ref(false);
const loading = ref(false);
const target = ref<EtlWorkspaceRow>();
const fires = ref<EtlScheduleFire[]>([]);
const nextFireAt = ref<number>();
let requestVersion = 0;

const statusText = computed<Record<string, string>>(() => ({
  PENDING: translateUiText('等待执行'),
  RUNNING: translateUiText('执行中'),
  SUCCESS: translateUiText('成功'),
  FAILED: translateUiText('失败'),
  SKIPPED: translateUiText('已跳过'),
  CANCELLED: translateUiText('已取消'),
}));

async function open(workspace: EtlWorkspaceRow) {
  target.value = workspace;
  visible.value = true;
  fires.value = [];
  nextFireAt.value = undefined;
  await refresh();
}

async function refresh() {
  if (!target.value) return;
  const version = ++requestVersion;
  const workspaceId = target.value.id;
  loading.value = true;
  try {
    const response: any = await getEtlSchedule(workspaceId);
    if (version !== requestVersion) return;
    const detail = (response.data ?? response) as EtlScheduleDetail;
    fires.value = detail?.recentFires || [];
    nextFireAt.value = detail?.schedule?.nextFireAt;
  } catch (error: any) {
    if (version !== requestVersion) return;
    say('error', error.msg || error.message || '加载定时任务日志失败');
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function formatTime(value?: number) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(value);
  } catch {
    return translateUiText('时间无效');
  }
}

function runIds(json?: string): string[] {
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
}

async function openRunLog(runId: string) {
  try {
    const response: any = await getEtlRun(runId);
    const run = response.data ?? response;
    emit('logs', run.workspaceId ?? target.value!.id, runId);
    visible.value = false;
  } catch (error: any) {
    say('error', error.msg || error.message || '运行记录加载失败');
  }
}

async function openFireLogs(row: { runIdsJson?: string }) {
  const ids = runIds(row.runIdsJson);
  if (!ids.length) {
    say('warning', '本次触发没有可查看的执行记录');
    return;
  }
  // multi-task fire: open last run; tip when multiple
  if (ids.length > 1) {
    say('info', `本次触发共 ${ids.length} 条运行，已打开最新一条；可在运行记录中切换其它任务`);
  }
  await openRunLog(ids[ids.length - 1]!);
}

defineExpose({ open });
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="$tr('定时任务日志')"
    class="etl-schedule-logs-drawer"
    size="min(720px, 96vw)"
  >
    <div class="toolbar">
      <span v-if="nextFireAt" class="hint">
        {{ $tr('下次触发') }}：{{ formatTime(nextFireAt) }}
      </span>
      <span v-else class="hint">{{ $tr('当前无启用中的定时计划') }}</span>
      <el-button :icon="Refresh" :loading="loading" @click="refresh">{{
        $tr('刷新')
      }}</el-button>
    </div>
    <el-table
      v-loading="loading"
      :data="fires"
      max-height="calc(100vh - 180px)"
      :empty-text="$tr('暂无定时触发记录')"
    >
      <el-table-column :label="$tr('计划时间')" width="175">
        <template #default="{ row }">{{
          formatTime(row.scheduledAt)
        }}</template>
      </el-table-column>
      <el-table-column :label="$tr('状态')" width="90">
        <template #default="{ row }">
          <el-tag
            :type="
              row.status === 'FAILED'
                ? 'danger'
                : row.status === 'SUCCESS'
                  ? 'success'
                  : 'info'
            "
            >{{ statusText[row.status] || row.status }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="message"
        :label="$tr('说明')"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column :label="$tr('执行日志')" width="88">
        <template #default="{ row }">
          <el-button
            v-if="runIds(row.runIdsJson).length"
            link
            type="primary"
            @click="openFireLogs(row)"
            >{{ $tr('查看') }}</el-button
          >
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>
    <p class="hint">
      {{
        $tr(
          '仅展示本工作区最近 20 次定时触发。相关工作区占用或跳过时也会留下记录；点「任务」可查看对应运行步骤日志。',
        )
      }}
    </p>
  </el-drawer>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
