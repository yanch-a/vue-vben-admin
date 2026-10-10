<script setup lang="ts">
/** 工作区右键定时配置：支持前置工作区串行、时间预览和触发历史；不保存或发布任务草稿。@author yanch */
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type {
  EtlScheduleConfig,
  EtlScheduleDetail,
  EtlSchedulePeerWorkspace,
  EtlScheduleStep,
  EtlWorkspaceRow,
} from '#/api/visual/etl';
import {
  createScheduleForm as defaults,
  decodeSchedule as fromRow,
  schedulePayload,
} from './scheduleModel';
import {
  getEtlRun,
  getEtlSchedule,
  pauseEtlSchedule,
  previewEtlSchedule,
  saveEtlSchedule,
} from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';

const emit = defineEmits<{
  logs: [workspaceId: string | number, runId: string];
}>();
const visible = ref(false),
  loading = ref(false),
  saving = ref(false),
  previewing = ref(false);
const target = ref<EtlWorkspaceRow>();
const detail = ref<EtlScheduleDetail>();
const form = ref<EtlScheduleConfig>(defaults());
const times = ref<number[]>([]),
  ruleError = ref(''),
  taskSearch = ref('');
const addingPeerId = ref<string | number>();
let requestVersion = 0;
const modes = [
  { value: 'ONCE', label: '单次' },
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'INTERVAL', label: '固定间隔' },
  { value: 'CRON', label: '自定义 Cron' },
];
const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const zones = [
  'Asia/Shanghai',
  'UTC',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'America/New_York',
  'Europe/London',
];
const taskOptions = computed(() =>
  form.value.publishedVersion === detail.value?.publishedVersion
    ? detail.value?.latestPipelines || []
    : detail.value?.pipelines || [],
);
const tasks = computed(() =>
  taskOptions.value.filter((task) =>
    `${task.name} ${task.id}`
      .toLowerCase()
      .includes(taskSearch.value.toLowerCase()),
  ),
);
const published = computed(() => detail.value?.publishedVersion || 0);
/** 尚未加入前置链的其他已发布工作区。 */
const availablePeers = computed(() => {
  const used = new Set(
    (form.value.preSteps || []).map((step) => String(step.workspaceId)),
  );
  return (detail.value?.peerWorkspaces || []).filter(
    (peer) => !used.has(String(peer.id)),
  );
});
const statusText = computed<Record<string, string>>(() => ({
  PENDING: translateUiText('等待执行'),
  RUNNING: translateUiText('执行中'),
  SUCCESS: translateUiText('成功'),
  FAILED: translateUiText('失败'),
  SKIPPED: translateUiText('已跳过'),
  CANCELLED: translateUiText('已取消'),
}));

/** 打开指定工作区，不切换/丢弃当前编辑中的工作区草稿。 */
async function open(workspace: EtlWorkspaceRow) {
  target.value = workspace;
  visible.value = true;
  taskSearch.value = '';
  addingPeerId.value = undefined;
  detail.value = undefined;
  form.value = defaults();
  times.value = [];
  await load(true);
}
/** 刷新服务端状态；历史刷新不覆盖用户尚未保存的表单。 */
async function load(reset = false) {
  if (!target.value) return;
  const version = ++requestVersion;
  loading.value = true;
  try {
    const response: any = await getEtlSchedule(target.value.id);
    if (version !== requestVersion) return;
    detail.value = response.data ?? response;
    if (reset) {
      const row = detail.value?.schedule;
      form.value = row
        ? fromRow(row, detail.value?.preSteps || [])
        : {
            ...defaults(),
            publishedVersion: published.value,
            pipelineIds: (detail.value?.pipelines || [])
              .filter((task) => task.enabled)
              .map((task) => task.id),
          };
    }
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '定时配置加载失败');
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}
/** 明确重新选择最新发布版本，后续编辑草稿不影响此处绑定版本。 */
function useLatest() {
  form.value.publishedVersion = published.value;
  form.value.pipelineIds = (detail.value?.latestPipelines || [])
    .filter((task) => task.enabled)
    .map((task) => task.id);
}
/** 前置步骤改用该工作区最新发布版本。 */
function useLatestPre(step: EtlScheduleStep) {
  const latest = step.latestPublishedVersion || 0;
  if (!latest) return;
  step.publishedVersion = latest;
  step.pipelines = step.latestPipelines || [];
  step.pipelineIds = (step.latestPipelines || [])
    .filter((task) => task.enabled)
    .map((task) => task.id);
}
/** 所选任务按列表/勾选顺序串行，不开启多个工作区写入批次。 */
function selectAll() {
  form.value.pipelineIds = taskOptions.value
    .filter((task) => task.enabled)
    .map((task) => task.id);
}
function selectAllPre(step: EtlScheduleStep) {
  const options =
    step.publishedVersion === step.latestPublishedVersion
      ? step.latestPipelines || []
      : step.pipelines || [];
  step.pipelineIds = options
    .filter((task) => task.enabled)
    .map((task) => task.id);
}
function preTaskOptions(step: EtlScheduleStep) {
  return step.publishedVersion === step.latestPublishedVersion
    ? step.latestPipelines || []
    : step.pipelines || [];
}
/** 追加一个前置工作区，默认勾选其全部已启用任务。 */
function addPreStep() {
  const peer = (detail.value?.peerWorkspaces || []).find(
    (item) => String(item.id) === String(addingPeerId.value),
  );
  if (!peer) {
    ElMessage.warning('请选择要先执行的工作区');
    return;
  }
  if (
    (form.value.preSteps || []).some(
      (step) => String(step.workspaceId) === String(peer.id),
    )
  ) {
    ElMessage.warning('该工作区已在前置列表中');
    return;
  }
  form.value.preSteps = [
    ...(form.value.preSteps || []),
    peerToStep(peer),
  ];
  addingPeerId.value = undefined;
}
function peerToStep(peer: EtlSchedulePeerWorkspace): EtlScheduleStep {
  return {
    workspaceId: peer.id,
    workspaceName: peer.workspaceName,
    publishedVersion: peer.publishedVersion,
    latestPublishedVersion: peer.publishedVersion,
    pipelines: peer.latestPipelines,
    latestPipelines: peer.latestPipelines,
    pipelineIds: peer.latestPipelines
      .filter((task) => task.enabled)
      .map((task) => task.id),
  };
}
function removePreStep(index: number) {
  form.value.preSteps = (form.value.preSteps || []).filter(
    (_, i) => i !== index,
  );
}
function movePreStep(index: number, delta: number) {
  const list = [...(form.value.preSteps || [])];
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item!);
  form.value.preSteps = list;
}
/** 规则变化使旧预览失效；使用版本号忽略旧的并发预览响应。 */
let previewVersion = 0;
watch(
  () => JSON.stringify(form.value),
  () => {
    times.value = [];
    ruleError.value = '';
    previewing.value = false;
    previewVersion++;
  },
);
async function preview() {
  const version = ++previewVersion;
  previewing.value = true;
  ruleError.value = '';
  try {
    const response: any = await previewEtlSchedule(schedulePayload(form.value));
    if (version === previewVersion) times.value = response.data ?? response;
  } catch (error: any) {
    if (version === previewVersion)
      ruleError.value =
        error.msg || error.message || translateUiText('时间规则无效');
  } finally {
    if (version === previewVersion) previewing.value = false;
  }
}
/** 独立保存计划，仍由服务端校验任务、版本和权限；开启必须用户明确操作开关。 */
async function save() {
  if (!target.value || !detail.value) return;
  if (!form.value.pipelineIds.length) {
    ElMessage.warning('请至少选择一个本工作区同步任务');
    return;
  }
  for (const step of form.value.preSteps || []) {
    if (step.missing) {
      ElMessage.warning(
        `前置工作区「${step.workspaceName || step.workspaceId}」已不可用，请先移除`,
      );
      return;
    }
    if (!step.pipelineIds?.length) {
      ElMessage.warning(
        `前置工作区「${step.workspaceName || step.workspaceId}」请至少选择一个任务`,
      );
      return;
    }
  }
  saving.value = true;
  try {
    await saveEtlSchedule(target.value.id, schedulePayload(form.value));
    ElMessage.success(
      form.value.enabled ? '定时执行已启用' : '定时计划已保存，当前未启用',
    );
    await load(true);
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '计划保存失败');
  } finally {
    saving.value = false;
  }
}
/** 暂停只作用于未来触发，不取消已运行任务；旧的一次性时间可直接暂停。 */
async function pause() {
  if (!target.value || !detail.value?.schedule) return;
  saving.value = true;
  try {
    await pauseEtlSchedule(target.value.id, detail.value.schedule.revision);
    ElMessage.success('已暂停后续定时执行，当前批次继续');
    await load(true);
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '暂停失败');
  } finally {
    saving.value = false;
  }
}
/** 以用户所选时区显示绝对时间，避免把 UTC 时间误认成本地时间。 */
function formatTime(value?: number) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: form.value.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(value);
  } catch {
    return translateUiText('时区无效');
  }
}
/** 历史批次可关联多个原任务运行，按运行所属工作区打开日志。 */
function runIds(json: string): string[] {
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
    ElMessage.error(error.msg || error.message || '运行记录加载失败');
  }
}
defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="$tr('定时执行配置')"
    width="min(880px, 94vw)"
    top="4vh"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-loading="loading" class="schedule-body">
      <div class="schedule-heading">
        <strong>{{ target?.workspaceName }}</strong
        ><el-tag :type="detail?.schedule?.enabled ? 'success' : 'info'">{{
          detail?.schedule?.enabled ? $tr('已启用') : $tr('未启用')
        }}</el-tag>
      </div>
      <el-alert
        v-if="!published"
        :title="$tr('请先保存并发布工作区，再配置定时执行')"
        type="warning"
        :closable="false"
      />
      <template v-else>
        <el-alert
          :title="
            $tr(
              '定时执行使用已发布版本；保存计划不会保存或发布草稿。可配置前置工作区，整条链按顺序串行，失败中断本次。',
            )
          "
          type="info"
          :closable="false"
        />
        <el-form
          label-width="110px"
          class="schedule-form"
          @submit.prevent="save"
        >
          <el-form-item :label="$tr('定时开关')"
            ><el-switch v-model="form.enabled" /><span class="hint">{{
              $tr('关闭仅暂停后续触发，当前批次继续')
            }}</span></el-form-item
          >
          <el-form-item :label="$tr('前置工作区')">
            <div class="pre-steps">
              <p class="hint block-hint">
                {{
                  $tr(
                    '可选：先串行执行其他工作区的已发布任务，再执行本工作区。例如先同步 B，再同步当前工作区 A。',
                  )
                }}
              </p>
              <div
                v-for="(step, index) in form.preSteps"
                :key="`${step.workspaceId}-${index}`"
                class="pre-step-card"
                :class="{ missing: step.missing }"
              >
                <div class="pre-step-head">
                  <strong
                    >{{ index + 1 }}.
                    {{ step.workspaceName || step.workspaceId }}</strong
                  >
                  <el-tag v-if="step.missing" type="danger" size="small">{{
                    $tr('已失效，请移除')
                  }}</el-tag>
                  <span v-else class="hint"
                    >{{ $tr('发布版本') }} {{ step.publishedVersion }}</span
                  >
                  <el-button
                    v-if="
                      step.latestPublishedVersion &&
                      step.publishedVersion !== step.latestPublishedVersion
                    "
                    link
                    type="primary"
                    @click="useLatestPre(step)"
                    >{{ $tr('改用最新发布版本') }}
                    {{ step.latestPublishedVersion }}</el-button
                  >
                  <div class="pre-step-actions">
                    <el-button
                      link
                      :disabled="index === 0"
                      @click="movePreStep(index, -1)"
                      >{{ $tr('上移') }}</el-button
                    >
                    <el-button
                      link
                      :disabled="index === form.preSteps.length - 1"
                      @click="movePreStep(index, 1)"
                      >{{ $tr('下移') }}</el-button
                    >
                    <el-button link type="danger" @click="removePreStep(index)">{{
                      $tr('移除')
                    }}</el-button>
                  </div>
                </div>
                <div class="picker-tools">
                  <el-button @click="selectAllPre(step)">{{
                    $tr('全选已启用任务')
                  }}</el-button>
                </div>
                <el-checkbox-group
                  v-model="step.pipelineIds"
                  class="task-options"
                >
                  <el-checkbox
                    v-for="task in preTaskOptions(step)"
                    :key="task.id"
                    :value="task.id"
                    :disabled="!task.enabled"
                    >{{ task.name || task.id
                    }}{{ task.enabled ? '' : $tr('（已停用）') }}</el-checkbox
                  >
                </el-checkbox-group>
                <small
                  >{{ $tr('已选') }} {{ step.pipelineIds.length }}
                  {{ $tr('个；按勾选顺序执行。') }}</small
                >
              </div>
              <div v-if="availablePeers.length" class="add-pre">
                <el-select
                  v-model="addingPeerId"
                  clearable
                  filterable
                  :placeholder="$tr('选择要先执行的工作区')"
                  style="width: 260px"
                >
                  <el-option
                    v-for="peer in availablePeers"
                    :key="peer.id"
                    :label="peer.workspaceName"
                    :value="peer.id"
                  />
                </el-select>
                <el-button type="primary" plain @click="addPreStep">{{
                  $tr('添加前置工作区')
                }}</el-button>
              </div>
              <p v-else-if="!(form.preSteps || []).length" class="hint">
                {{
                  $tr(
                    '暂无其他已发布工作区可作前置；请先发布需要先执行的工作区。',
                  )
                }}
              </p>
            </div>
          </el-form-item>
          <el-form-item :label="$tr('本工作区版本')"
            ><span>{{ $tr('发布版本') }} {{ form.publishedVersion }}</span
            ><el-button
              v-if="form.publishedVersion !== published"
              link
              type="primary"
              @click="useLatest"
              >{{ $tr('改用最新发布版本') }} {{ published }}</el-button
            ><span v-else class="hint">{{ $tr('当前最新发布版本') }}</span></el-form-item
          >
          <el-form-item :label="$tr('本工作区任务')"
            ><div class="task-picker">
              <div class="picker-tools">
                <el-input
                  v-model="taskSearch"
                  :placeholder="$tr('检索同步任务')"
                  clearable
                /><el-button @click="selectAll">{{
                  $tr('全选已启用任务')
                }}</el-button>
              </div>
              <el-checkbox-group v-model="form.pipelineIds" class="task-options"
                ><el-checkbox
                  v-for="task in tasks"
                  :key="task.id"
                  :value="task.id"
                  :disabled="!task.enabled"
                  >{{ task.name || task.id
                  }}{{ task.enabled ? '' : $tr('（已停用）') }}</el-checkbox
                ></el-checkbox-group
              ><small
                >{{ $tr('已选') }} {{ form.pipelineIds.length }}
                {{ $tr('个；在前置工作区之后按勾选顺序执行。') }}</small
              >
            </div></el-form-item
          >
          <el-form-item :label="$tr('执行方式')"
            ><el-radio-group v-model="form.mode"
              ><el-radio-button
                v-for="mode in modes"
                :key="mode.value"
                :value="mode.value"
                >{{ $tr(mode.label) }}</el-radio-button
              ></el-radio-group
            ></el-form-item
          >
          <el-form-item :label="$tr('执行时区')"
            ><el-select
              v-model="form.timeZone"
              filterable
              allow-create
              default-first-option
              :aria-label="$tr('执行时区')"
              ><el-option
                v-for="zone in zones"
                :key="zone"
                :label="zone"
                :value="zone" /></el-select
          ></el-form-item>
          <el-form-item v-if="form.mode === 'ONCE'" :label="$tr('执行日期')"
            ><el-date-picker
              v-model="form.runAt"
              type="datetime"
              value-format="x"
              :placeholder="$tr('选择未来时间（浏览器本地时区）')"
            /><small class="hint">{{
              $tr('日期选择器用浏览器本地时区，以下预览按执行时区显示。')
            }}</small></el-form-item
          >
          <el-form-item
            v-if="['DAILY', 'WEEKLY'].includes(form.mode)"
            :label="$tr('执行时间')"
            ><el-time-select
              v-model="form.timeOfDay"
              start="00:00"
              step="00:01"
              end="23:59"
              :placeholder="$tr('选择时:分')"
          /></el-form-item>
          <el-form-item v-if="form.mode === 'WEEKLY'" :label="$tr('执行星期')"
            ><el-checkbox-group v-model="form.weekDays"
              ><el-checkbox
                v-for="(day, index) in weekDays"
                :key="day"
                :value="index + 1"
                >{{ $tr(day) }}</el-checkbox
              ></el-checkbox-group
            ></el-form-item
          >
          <el-form-item v-if="form.mode === 'INTERVAL'" :label="$tr('执行间隔')"
            ><el-input-number
              v-model="form.intervalMinutes"
              :min="1"
              :max="10080"
              :aria-label="$tr('执行间隔分钟')"
            /><span class="hint">{{
              $tr('分钟；首次在保存后一个间隔触发')
            }}</span></el-form-item
          >
          <el-form-item v-if="form.mode === 'CRON'" :label="$tr('Cron 表达式')"
            ><div class="cron-input">
              <el-input
                v-model="form.cronExpression"
                placeholder="0 */5 * * * *"
              /><small>{{
                $tr(
                  '六段：秒 分 时 日 月 周；秒为 0。例如每 5 分钟：0 */5 * * * *',
                )
              }}</small>
            </div></el-form-item
          >
          <el-form-item :label="$tr('时间预览')"
            ><div>
              <el-button :loading="previewing" @click="preview">{{
                $tr('预览接下来执行时间')
              }}</el-button>
              <p v-if="ruleError" class="rule-error">{{ ruleError }}</p>
              <ol v-if="times.length" class="time-preview">
                <li v-for="time in times" :key="time">
                  {{ formatTime(time) }}
                </li>
              </ol>
            </div></el-form-item
          >
          <el-form-item :label="$tr('下次触发')"
            ><span>{{ formatTime(detail?.schedule?.nextFireAt) }}</span
            ><span class="hint">{{
              $tr('服务端运行，关闭页面不影响执行；扫描误差约 5 秒')
            }}</span></el-form-item
          >
        </el-form>
      </template>
      <div class="history-heading">
        <strong>{{ $tr('最近定时触发') }}</strong
        ><el-button link type="primary" @click="load(false)">{{
          $tr('刷新状态')
        }}</el-button>
      </div>
      <el-table
        :data="detail?.recentFires || []"
        max-height="220"
        :empty-text="$tr('暂无定时触发记录')"
        ><el-table-column :label="$tr('计划时间')" width="175"
          ><template #default="{ row }">{{
            formatTime(row.scheduledAt)
          }}</template></el-table-column
        ><el-table-column :label="$tr('状态')" width="85"
          ><template #default="{ row }"
            ><el-tag
              :type="
                row.status === 'FAILED'
                  ? 'danger'
                  : row.status === 'SUCCESS'
                    ? 'success'
                    : 'info'
              "
              >{{ statusText[row.status] || row.status }}</el-tag
            ></template
          ></el-table-column
        ><el-table-column
          prop="message"
          :label="$tr('说明')"
          min-width="150"
          show-overflow-tooltip
        /><el-table-column :label="$tr('运行日志')" width="100"
          ><template #default="{ row }"
            ><el-button
              v-for="(id, index) in runIds(row.runIdsJson)"
              :key="id"
              link
              type="primary"
              @click="openRunLog(id)"
              >{{ $tr('任务') }} {{ index + 1 }}</el-button
            ></template
          ></el-table-column
        ></el-table
      >
      <p class="hint">
        {{
          $tr(
            '相关工作区仍在运行时跳过本次，不重叠、不积压。服务停机错过超过一分钟的计划不会补跑。',
          )
        }}
      </p>
    </div>
    <template #footer
      ><el-button @click="visible = false">{{ $tr('关闭') }}</el-button
      ><el-button
        v-if="detail?.schedule?.enabled"
        :loading="saving"
        @click="pause"
        >{{ $tr('暂停定时') }}</el-button
      ><el-button
        type="primary"
        :loading="saving"
        :disabled="loading || !published || !detail"
        @click="save"
        >{{ $tr('保存定时配置') }}</el-button
      ></template
    >
  </el-dialog>
</template>

<style scoped>
.schedule-body {
  max-height: calc(85vh - 110px);
  overflow: auto;
  padding-right: 8px;
}
.schedule-heading,
.history-heading,
.picker-tools,
.add-pre,
.pre-step-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.history-heading {
  justify-content: space-between;
}
.schedule-form {
  margin-top: 18px;
}
.hint,
small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.hint {
  margin-left: 10px;
}
.block-hint {
  margin: 0 0 10px;
  margin-left: 0;
  line-height: 1.5;
}
.task-picker,
.cron-input,
.pre-steps {
  width: 100%;
}
.pre-step-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--el-fill-color-blank);
}
.pre-step-card.missing {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}
.pre-step-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.task-options {
  display: flex;
  flex-direction: column;
  max-height: 150px;
  overflow: auto;
}
.picker-tools .el-input {
  flex: 1;
}
.time-preview {
  margin: 10px 0 0;
  padding-left: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 28px;
}
.rule-error {
  color: var(--el-color-danger);
}
</style>
