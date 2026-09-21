<script lang="ts" setup>
import type { SqlAuditResult, SqlAuditStep, SqlWorkOrder } from '#/api/visual/sqlWorkOrder';
import {
  downloadBlobAsFile,
  readBlobErrorMessage,
  unwrapFileBlob,
} from '#/utils/blobDownload';

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { ArrowLeft, Download, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listSelectableModels } from '#/api/ai/model';
import { getInstances } from '#/api/visual/database';
import {
  auditWorkOrder,
  auditWorkOrderRules,
  downloadWorkOrderRollback,
  executeWorkOrder,
  reviewWorkOrder,
  saveWorkOrder,
  submitWorkOrder,
  workOrderCapabilities,
  workOrderDetail,
  workOrderPage,
} from '#/api/visual/sqlWorkOrder';
import { getDbConfigList } from '#/api/visual/vq';

import { normalizeInstanceNames } from './instanceOptions';

defineOptions({ name: 'SqlWorkOrder' });

const router = useRouter();
const route = useRoute();
const loading = ref(false);
/** DBA 点击执行期间的忙标记，与列表 loading 分开，避免互相打断。 */
const executing = ref(false);
const rows = ref<SqlWorkOrder[]>([]);
const total = ref(0);
const dba = ref(false);
const canForceSubmit = ref(false);
const canAudit = ref(false);
const roleReady = ref(false);
const scope = ref<'mine' | 'review'>('mine');
const query = reactive({ pageNum: 1, pageSize: 20, status: '', title: '' });
const connections = ref<any[]>([]);
const sqlConnections = computed(() =>
  connections.value.filter((item) => String(item.dbType || '').toUpperCase() !== 'MONGODB'),
);
const instances = ref<string[]>([]);
const instancesLoading = ref(false);

const editorVisible = ref(false);
const editorSaving = ref(false);
const form = reactive({
  id: undefined as any,
  title: '',
  dbConfigId: undefined as any,
  instanceName: '',
  scriptText: '',
  changeNote: '',
});

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>();
const auditVisible = ref(false);
const auditLoading = ref(false);
/** form=填写问题；running=过程中；done=展示结果 */
const auditPhase = ref<'form' | 'running' | 'done'>('form');
const auditForm = reactive({ modelId: undefined as any, question: '' });
const models = ref<any[]>([]);
/** 审计过程步骤（running 时为前端预演，done 后换成后端真实步骤） */
const auditSteps = ref<SqlAuditStep[]>([]);
const auditResult = ref<SqlAuditResult | null>(null);
let auditProgressTimer: ReturnType<typeof setInterval> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const statusOptions = [
  ['DRAFT', '草稿'], ['PENDING', '待审批'], ['APPROVED', '已通过'],
  ['REJECTED', '已驳回'], ['PREPARING', '准备回滚'], ['EXECUTING', '执行中'], ['SUCCESS', '执行成功'], ['FAILED', '执行失败'],
];
const statusLabel = Object.fromEntries(statusOptions);

/** 审计轨迹 action 中文名 */
const eventActionLabel: Record<string, string> = {
  CREATE: '创建工单',
  UPDATE: '更新草稿',
  SUBMIT: '提交审批',
  FORCE_SUBMIT: '强制提交',
  AI_AUDIT: 'AI 审计',
  APPROVE: '审批通过',
  REJECT: '审批驳回',
  PREPARE_ROLLBACK: '生成回滚',
  EXECUTE_SUCCESS: '执行成功',
  EXECUTE_FAILED: '执行失败',
  EXECUTION_QUEUE_REJECTED: '执行排队失败',
};

/** 前端预演步骤（等待接口期间给用户过程感；完成后会被真实步骤替换） */
const AUDIT_PREVIEW_STEPS: SqlAuditStep[] = [
  { code: 'PARSE', title: '解析 SQL 语句', status: 'pending', detail: '等待开始' },
  { code: 'SCHEMA', title: 'Schema 对象检查', status: 'pending', detail: '等待开始' },
  { code: 'RULES', title: '执行内置规则集', status: 'pending', detail: '等待开始' },
  { code: 'ESTIMATE', title: '影响行数估算', status: 'pending', detail: '等待开始' },
  { code: 'AI', title: '调用大模型生成建议', status: 'pending', detail: '等待开始' },
  { code: 'SUMMARY', title: '汇总审计报告', status: 'pending', detail: '等待开始' },
];

const auditSession = computed(() => detail.value?.auditSession || null);
const auditSessionSteps = computed<SqlAuditStep[]>(() => {
  const steps = auditSession.value?.steps;
  return Array.isArray(steps) ? steps : [];
});
const auditSessionCoverage = computed(() => auditSession.value?.coverage || null);

function unbox(res: any) { return res?.data ?? res; }
function typeForStatus(status?: string) {
  if (status === 'SUCCESS' || status === 'APPROVED') return 'success';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'PENDING' || status === 'PREPARING' || status === 'EXECUTING') return 'warning';
  return 'info';
}

/** ElMessageBox 取消/关闭不视为业务失败。 */
function isMessageBoxCancel(error: unknown): boolean {
  if (error === 'cancel' || error === 'close') return true;
  if (error && typeof error === 'object' && 'action' in error) {
    const action = (error as { action?: string }).action;
    return action === 'cancel' || action === 'close';
  }
  return false;
}

/**
 * 统一取后端业务错误文案。
 * sqlWorkOrder 走 utils/request（responseReturn:body），业务码失败不会触发全局 ElMessage，
 * 调用方必须自行弹错；同时兼容 msg / message / response.data.msg 几种形态。
 */
function errorMessage(error: any, fallback = '操作失败'): string {
  return String(
    error?.msg
      || error?.message
      || error?.response?.data?.msg
      || error?.response?.data?.message
      || fallback,
  ).trim();
}
function typeForRisk(level?: string) {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'MEDIUM') return 'primary';
  return 'success';
}
function dateText(value?: string) { return value ? new Date(value).toLocaleString() : '-'; }

function stepStatusType(status?: string) {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'warning';
  if (status === 'skipped' || status === 'disabled') return 'info';
  return 'info';
}

function stepStatusLabel(status?: string) {
  if (status === 'success') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '进行中';
  if (status === 'skipped') return '跳过';
  if (status === 'disabled') return '未启用';
  if (status === 'pending') return '等待';
  return status || '-';
}

function formatDuration(ms?: number) {
  if (ms == null || Number.isNaN(Number(ms))) return '';
  const value = Number(ms);
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function eventLabel(action?: string) {
  return eventActionLabel[action || ''] || action || '-';
}

function stopAuditProgressPreview() {
  if (auditProgressTimer) {
    clearInterval(auditProgressTimer);
    auditProgressTimer = undefined;
  }
}

/** 请求进行中时，按固定节奏推进预演步骤（真实结果回来后会被替换）。 */
function startAuditProgressPreview() {
  stopAuditProgressPreview();
  auditSteps.value = AUDIT_PREVIEW_STEPS.map((item) => ({ ...item }));
  let index = 0;
  const tick = () => {
    const list = auditSteps.value;
    const previous = index > 0 ? list[index - 1] : undefined;
    if (previous?.status === 'running') {
      list[index - 1] = { ...previous, status: 'success', detail: '已完成（等待最终结果确认）' };
    }
    if (index >= list.length) {
      stopAuditProgressPreview();
      return;
    }
    const current = list[index];
    if (!current) return;
    list[index] = {
      ...current,
      status: 'running',
      detail: index === 4 ? '正在等待大模型返回…' : '执行中…',
    };
    auditSteps.value = [...list];
    index += 1;
  };
  tick();
  auditProgressTimer = setInterval(tick, 900);
}

/** 加载工单列表；定时轮询传 false，避免后台异常弹窗。 */
async function load(showErrorMessage = true) {
  loading.value = true;
  try {
    const res: any = await workOrderPage(
      { ...query, scope: scope.value },
      showErrorMessage,
    );
    const data = unbox(res);
    rows.value = data?.list || [];
    total.value = Number(data?.total || 0);
  } finally { loading.value = false; }
}

async function loadCapabilities() {
  const data = unbox(await workOrderCapabilities());
  dba.value = Boolean(data?.dba);
  canForceSubmit.value = Boolean(data?.canForceSubmit);
  canAudit.value = Boolean(data?.canAudit);
  scope.value = dba.value ? 'review' : 'mine';
  roleReady.value = true;
}

async function loadConnections() {
  connections.value = unbox(await getDbConfigList({})) || [];
}

async function onConnectionChange() {
  form.instanceName = '';
  instances.value = [];
  if (!form.dbConfigId) return;
  instancesLoading.value = true;
  try {
    instances.value = normalizeInstanceNames(await getInstances(form.dbConfigId));
    if (instances.value.length === 1) form.instanceName = instances.value[0] || '';
  } catch (error: any) {
    ElMessage.error(error?.message || '加载实例列表失败');
  } finally {
    instancesLoading.value = false;
  }
}

function resetForm() {
  Object.assign(form, { id: undefined, title: '', dbConfigId: undefined, instanceName: '', scriptText: '', changeNote: '' });
  instances.value = [];
}

function createOrder() {
  if (dba.value) return;
  resetForm();
  editorVisible.value = true;
}

async function editOrder(row: SqlWorkOrder) {
  const data = unbox(await workOrderDetail(row.id));
  const order = data?.order;
  resetForm();
  Object.assign(form, {
    id: order.id, title: order.title, dbConfigId: order.dbConfigId,
    instanceName: order.instanceName, scriptText: order.scriptText,
    changeNote: `基于 v${order.currentVersion} 修改`,
  });
  const savedInstance = order.instanceName;
  await onConnectionChange();
  if (instances.value.includes(savedInstance)) form.instanceName = savedInstance;
  else ElMessage.warning(`原目标实例「${savedInstance}」已不可用，请重新选择`);
  editorVisible.value = true;
}

async function saveDraft() {
  if (!form.title.trim() || !form.dbConfigId || !form.instanceName || !form.scriptText.trim()) {
    ElMessage.warning('请填写标题、连接、实例和 SQL 脚本'); return;
  }
  editorSaving.value = true;
  try {
    await saveWorkOrder({ ...form });
    ElMessage.success('草稿已保存并生成新版本');
    editorVisible.value = false;
    await load();
  } finally { editorSaving.value = false; }
}

/** 加载工单详情；定时轮询传 false，手动打开时保留错误提示。 */
async function openDetail(row: SqlWorkOrder, showErrorMessage = true) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = unbox(await workOrderDetail(row.id, showErrorMessage));
  }
  finally { detailLoading.value = false; }
}

/** 从站内通知进入页面时，直接打开对应工单详情。 */
async function openOrderFromNotification(orderId: unknown) {
  if (orderId === undefined || orderId === null || orderId === '') return;
  await openDetail({ id: String(orderId) } as SqlWorkOrder);
}

async function submit(row: SqlWorkOrder, force = false) {
  try {
    if (force) {
      const prompt: any = await ElMessageBox.prompt(
        '审计存在 ERROR，强制提交将留下 FORCE_SUBMIT 事件。请填写原因：',
        '强制提交',
        { inputValidator: (v: string) => Boolean(v?.trim()) || '必须填写强制提交原因', type: 'error' },
      );
      await submitWorkOrder(row.id, { forceSubmit: true, forceReason: prompt.value });
    } else {
      await ElMessageBox.confirm('提交后脚本将锁定，修改需驳回后生成新版本。确认提交？', '提交 DBA 审批', { type: 'warning' });
      try {
        await submitWorkOrder(row.id, {});
      } catch (error: any) {
        const message = errorMessage(error);
        if (canForceSubmit.value && (message.includes('ERROR') || message.includes('forceSubmit') || message.includes('禁止提交'))) {
          await ElMessageBox.confirm(`${message}\n\n是否强制提交？`, '审计拦截', { type: 'error', confirmButtonText: '强制提交' });
          return submit(row, true);
        }
        throw error;
      }
    }
    ElMessage.success(force ? '已强制提交审批' : '已提交审批');
    await load();
  } catch (error: any) {
    if (isMessageBoxCancel(error)) return;
    ElMessage.error(errorMessage(error, '提交失败'));
  }
}

function typeForFinding(status?: string) {
  if (status === 'ERROR') return 'danger';
  if (status === 'WARNING') return 'warning';
  return 'success';
}

function estimatedRowsText(row: any) {
  if (row?.estimatedRows != null && row.estimatedRows !== undefined) return String(row.estimatedRows);
  if (row?.estimatedRowsStatus && row.estimatedRowsStatus !== 'ok' && row.estimatedRowsStatus !== 'n/a') {
    return row.estimatedRowsStatus + (row.estimatedRowsNote ? ` (${row.estimatedRowsNote})` : '');
  }
  return row?.estimatedRowsStatus === 'n/a' ? '-' : (row?.estimatedRowsNote || '-');
}

async function openAudit(row?: SqlWorkOrder) {
  const order = row || detail.value?.order;
  if (!order) return;
  if (models.value.length === 0) {
    const groups = unbox(await listSelectableModels()) || [];
    models.value = groups.flatMap((group: any) => (group.models || []).map((model: any) => ({ ...model, providerName: group.providerName || group.name })));
    auditForm.modelId = models.value.find((m: any) => m.isDefault === 1)?.id || models.value[0]?.id;
  }
  auditForm.question = '检查危险操作、锁表和性能风险，并结合上线规范判断是否建议通过。';
  detail.value = detail.value || { order };
  if (!detail.value.order?.scriptText) detail.value.order = order;
  auditPhase.value = 'form';
  auditResult.value = null;
  auditSteps.value = [];
  stopAuditProgressPreview();
  auditVisible.value = true;
}

async function runAudit() {
  const order = detail.value?.order;
  if (!order) return;
  auditLoading.value = true;
  auditPhase.value = 'running';
  auditResult.value = null;
  startAuditProgressPreview();
  try {
    const rulesRes: any = await auditWorkOrderRules(order.id);
    stopAuditProgressPreview();
    const rules = unbox(rulesRes) as SqlAuditResult;
    const ruleSteps = Array.isArray(rules?.steps) ? [...rules.steps] : [];
    const liveSteps = ruleSteps.map((step) => {
      if (step.code === 'AI') {
        return { ...step, status: 'running', detail: step.detail || '正在等待大模型返回…' };
      }
      if (step.code === 'SUMMARY') {
        return { ...step, status: 'pending', detail: step.detail || '等待 AI 建议完成后汇总' };
      }
      return step;
    });
    auditSteps.value = liveSteps;
    auditResult.value = {
      ...rules,
      aiAdviceMarkdown: '',
      aiStatus: 'pending',
    };

    const res: any = await auditWorkOrder(order.id, { ...auditForm });
    const result = unbox(res) as SqlAuditResult;
    auditSteps.value = Array.isArray(result?.steps) ? result.steps : liveSteps;
    auditResult.value = result;
    auditPhase.value = 'done';
    if (result?.aiStatus === 'failed') {
      ElMessage.warning('规则审计已完成，但 AI 建议生成失败：' + (result.aiError || '未知错误'));
    } else {
      ElMessage.success('AI 审计完成，结果已写入工单记录');
    }
    await openDetail(order);
    await load();
  } catch (error: any) {
    if (auditResult.value?.ruleReportMarkdown) {
      auditPhase.value = 'done';
      ElMessage.warning(errorMessage(error, 'AI 阶段失败，已保留规则审计结果'));
      try {
        await openDetail(order);
        await load();
      } catch {
        /* ignore */
      }
    } else {
      auditPhase.value = 'form';
      ElMessage.error(errorMessage(error, 'AI 审计失败'));
    }
  } finally {
    stopAuditProgressPreview();
    auditLoading.value = false;
  }
}



function closeAuditDialog() {
  stopAuditProgressPreview();
  auditVisible.value = false;
  auditPhase.value = 'form';
  auditResult.value = null;
  auditSteps.value = [];
}

async function review(row: SqlWorkOrder, approved: boolean) {
  const result: any = await ElMessageBox.prompt(
    approved ? '请输入通过意见（可简短说明上线窗口）' : '请输入驳回原因',
    approved ? '审批通过' : '驳回工单',
    { inputValidator: (value: string) => approved || Boolean(value?.trim()) || '驳回时必须填写原因', type: approved ? 'success' : 'warning' },
  );
  await reviewWorkOrder(row.id, { approved, comment: result.value });
  ElMessage.success(approved ? '审批已通过' : '工单已驳回'); await load();
}

async function execute(row: SqlWorkOrder) {
  // 防重复点击：失败时若未处理 Promise，页面会像卡住且无提示。
  if (executing.value) return;
  try {
    await ElMessageBox.confirm(
      '系统会先读取旧数据并生成回滚文件，成功后才执行 SQL。确认开始？',
      '执行已审批工单',
      { type: 'warning' },
    );
  } catch (error) {
    if (isMessageBoxCancel(error)) return;
    ElMessage.error(errorMessage(error));
    return;
  }

  executing.value = true;
  try {
    try {
      await executeWorkOrder(row.id, false);
    } catch (error: any) {
      const message = errorMessage(error);
      // 仅“回滚不完整”允许二次确认后带 allowIncompleteRollback 重试，其它错误直接提示。
      if (!message.includes('人工回滚') && !message.includes('无法自动还原')) {
        ElMessage.error(message || '执行失败');
        return;
      }
      try {
        await ElMessageBox.confirm(
          `${message}\n\n确认由 DBA 人工处理无法自动还原的部分？`,
          '回滚不完整',
          { type: 'error', confirmButtonText: '接受风险并执行' },
        );
      } catch (inner) {
        if (isMessageBoxCancel(inner)) return;
        ElMessage.error(errorMessage(inner));
        return;
      }
      await executeWorkOrder(row.id, true);
    }
    ElMessage.success('回滚文件已生成，工单进入执行队列');
    await load();
  } catch (error: any) {
    if (isMessageBoxCancel(error)) return;
    ElMessage.error(errorMessage(error, '执行失败'));
  } finally {
    executing.value = false;
  }
}

async function downloadRollback(row: SqlWorkOrder) {
  try {
    const data: any = await downloadWorkOrderRollback(row.id);
    const blob = unwrapFileBlob(data);
    if (!blob) {
      ElMessage.error('下载失败：未收到有效文件');
      return;
    }
    const errMsg = await readBlobErrorMessage(blob);
    if (errMsg) {
      ElMessage.error(errMsg);
      return;
    }
    await downloadBlobAsFile(blob, `work-order-${row.id}-rollback.sql`);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '下载失败');
  }
}

onMounted(async () => {
  await loadCapabilities();
  if (!dba.value) await loadConnections();
  await load();
  await openOrderFromNotification(route.query.orderId);
  refreshTimer = setInterval(async () => {
    if (!rows.value.some((item) => ['EXECUTING', 'PREPARING'].includes(item.status))) return;
    try {
      await load(false);
      if (detailVisible.value && ['EXECUTING', 'PREPARING'].includes(detail.value?.order?.status || '')) {
        await openDetail(detail.value.order, false);
      }
    } catch {
      // 保留上一次成功状态，下一轮继续尝试，不打断当前操作。
    }
  }, 3000);
});
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  stopAuditProgressPreview();
});

watch(
  () => route.query.orderId,
  (orderId, previousId) => {
    if (orderId !== previousId) openOrderFromNotification(orderId);
  },
);
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="work-order-page">
      <header class="toolbar">
        <ElButton :icon="ArrowLeft" circle :title="$tr('返回数据库客户端')" @click="router.back()" />
        <h2>{{ $tr('SQL 上线工单') }}</h2>
        <ElTag v-if="roleReady" :type="dba ? 'warning' : 'info'" effect="plain">
          {{ $tr(dba ? 'DBA 审批台' : '开发提单台') }}
        </ElTag>
        <div class="filters">
          <ElInput v-model="query.title" clearable :placeholder="$tr('标题')" :prefix-icon="Search" @keyup.enter="() => load()" />
          <ElSelect v-model="query.status" clearable :placeholder="$tr('全部状态')">
            <ElOption v-for="item in statusOptions" :key="item[0]" :label="item[1]" :value="item[0]" />
          </ElSelect>
          <ElButton :icon="Refresh" circle :title="$tr('刷新')" @click="() => load()" />
          <ElButton v-if="roleReady && !dba" type="primary" :icon="Plus" @click="createOrder">{{ $tr('新建工单') }}</ElButton>
        </div>
      </header>

      <ElTable v-loading="loading" :data="rows" height="calc(100vh - 190px)" stripe>
        <ElTableColumn prop="title" :label="$tr('标题')" min-width="220" show-overflow-tooltip />
        <ElTableColumn prop="instanceName" :label="$tr('目标实例')" min-width="150" show-overflow-tooltip />
        <ElTableColumn prop="dbType" :label="$tr('数据库')" width="130" />
        <ElTableColumn :label="$tr('状态')" width="110">
          <template #default="{ row }"><ElTag :type="typeForStatus(row.status)">{{ statusLabel[row.status] || row.status }}</ElTag></template>
        </ElTableColumn>
        <ElTableColumn :label="$tr('风险')" width="100">
          <template #default="{ row }"><ElTag v-if="row.riskLevel" :type="typeForRisk(row.riskLevel)" effect="plain">{{ row.riskLevel }}</ElTag><span v-else>-</span></template>
        </ElTableColumn>
        <ElTableColumn prop="currentVersion" :label="$tr('版本')" width="72"><template #default="{ row }">v{{ row.currentVersion }}</template></ElTableColumn>
        <ElTableColumn prop="submitterName" :label="$tr('提交人')" width="110" />
        <ElTableColumn :label="$tr('更新时间')" width="170"><template #default="{ row }">{{ dateText(row.updateTime || row.createTime) }}</template></ElTableColumn>
        <ElTableColumn :label="$tr('操作')" fixed="right" min-width="330">
          <template #default="{ row }">
            <ElButton link type="primary" @click="openDetail(row)">{{ $tr('详情') }}</ElButton>
            <ElButton v-if="!dba && ['DRAFT','REJECTED'].includes(row.status)" link @click="editOrder(row)">{{ $tr('编辑') }}</ElButton>
            <ElButton v-if="!dba && ['DRAFT','REJECTED'].includes(row.status)" link type="primary" @click="submit(row)">{{ $tr('提交') }}</ElButton>
            <template v-if="dba">
              <ElButton v-if="canAudit && ['PENDING','APPROVED'].includes(row.status)" link type="primary" @click="openDetail(row).then(() => openAudit())">{{ $tr('AI 审计') }}</ElButton>
              <ElButton v-if="row.status === 'PENDING'" link type="success" @click="review(row, true)">{{ $tr('通过') }}</ElButton>
              <ElButton v-if="row.status === 'PENDING'" link type="danger" @click="review(row, false)">{{ $tr('驳回') }}</ElButton>
              <ElButton v-if="row.status === 'APPROVED'" link type="warning" :loading="executing" :disabled="executing" @click="execute(row)">{{ $tr('执行') }}</ElButton>
            </template>
            <ElButton v-if="['EXECUTING','SUCCESS','FAILED'].includes(row.status)" link :icon="Download" @click="downloadRollback(row)">{{ $tr('回滚脚本') }}</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <ElPagination v-model:current-page="query.pageNum" v-model:page-size="query.pageSize" :total="total" layout="total, sizes, prev, pager, next" @change="load" />
    </div>

    <ElDialog v-model="editorVisible" :title="form.id ? '编辑工单并生成新版本' : '新建 SQL 工单'" width="820px" destroy-on-close>
      <ElForm label-position="top">
        <ElFormItem :label="$tr('标题')"><ElInput v-model="form.title" maxlength="160" show-word-limit /></ElFormItem>
        <div class="target-row">
          <ElFormItem :label="$tr('数据库连接')"><ElSelect v-model="form.dbConfigId" filterable @change="onConnectionChange"><ElOption v-for="item in sqlConnections" :key="item.id" :label="item.dbName || item.dbHost || String(item.id)" :value="item.id" /></ElSelect></ElFormItem>
          <ElFormItem :label="$tr('目标实例')"><ElSelect v-model="form.instanceName" filterable :loading="instancesLoading" :placeholder="$tr('请选择实例')"><ElOption v-for="item in instances" :key="item" :label="item" :value="item" /></ElSelect></ElFormItem>
        </div>
        <ElFormItem :label="$tr('SQL 脚本')"><ElInput v-model="form.scriptText" type="textarea" :rows="16" resize="vertical" class="sql-input" spellcheck="false" /></ElFormItem>
        <ElFormItem :label="$tr('版本说明')"><ElInput v-model="form.changeNote" maxlength="500" /></ElFormItem>
      </ElForm>
      <template #footer><ElButton @click="editorVisible = false">{{ $tr('取消') }}</ElButton><ElButton type="primary" :loading="editorSaving" @click="saveDraft">{{ $tr('保存草稿') }}</ElButton></template>
    </ElDialog>

    <ElDrawer v-model="detailVisible" :title="$tr('工单详情')" size="720px">
      <div v-loading="detailLoading" v-if="detail?.order" class="detail">
        <div class="detail-head"><h3>{{ detail.order.title }}</h3><ElTag :type="typeForStatus(detail.order.status)">{{ statusLabel[detail.order.status] }}</ElTag><ElTag v-if="detail.order.riskLevel" :type="typeForRisk(detail.order.riskLevel)" effect="plain">{{ $tr('风险') }} {{ detail.order.riskLevel }} / {{ detail.order.riskScore }}</ElTag></div>
        <ElDescriptions :column="2" border size="small"><ElDescriptionsItem :label="$tr('目标')">{{ detail.order.dbType }} / {{ detail.order.instanceName }}</ElDescriptionsItem><ElDescriptionsItem :label="$tr('版本')">v{{ detail.order.currentVersion }}</ElDescriptionsItem><ElDescriptionsItem :label="$tr('提交人')">{{ detail.order.submitterName }}</ElDescriptionsItem><ElDescriptionsItem :label="$tr('审批人')">{{ detail.order.reviewerName || '-' }}</ElDescriptionsItem></ElDescriptions>
        <div v-if="detail.order.forceSubmitted" style="margin: 8px 0"><ElTag type="danger" effect="dark">{{ $tr('已强制提交') }}</ElTag></div>
        <h4>{{ $tr('按语句审核') }}</h4>
        <ElTable v-if="detail.statementFindings?.length" :data="detail.statementFindings" size="small" border>
          <ElTableColumn prop="statementIndex" :label="$tr('#')" width="58"><template #default="{ row }">{{ row.statementIndex + 1 }}</template></ElTableColumn>
          <ElTableColumn :label="$tr('状态')" width="100"><template #default="{ row }"><ElTag :type="typeForFinding(row.status)" size="small">{{ row.status || 'OK' }}</ElTag></template></ElTableColumn>
          <ElTableColumn prop="sqlPreview" :label="$tr('SQL')" min-width="220" show-overflow-tooltip />
          <ElTableColumn :label="$tr('影响行数')" width="140"><template #default="{ row }">{{ estimatedRowsText(row) }}</template></ElTableColumn>
          <ElTableColumn :label="$tr('命中规则')" min-width="240">
            <template #default="{ row }">
              <div v-if="row.hits?.length" class="hit-list">
                <div v-for="(hit, idx) in row.hits" :key="idx">
                  <ElTag :type="hit.severity === 'ERROR' ? 'danger' : 'warning'" size="small" effect="plain">{{ hit.severity }}</ElTag>
                  {{ hit.ruleCode }}: {{ hit.message }}
                </div>
              </div>
              <span v-else>-</span>
            </template>
          </ElTableColumn>
        </ElTable>
        <ElEmpty v-else description="暂无按语句结果（提交或审计后生成）" :image-size="64" />

        <template v-if="auditSession">
          <h4>{{ $tr('审计过程') }}</h4>
          <div class="audit-summary">
            <ElTag v-if="auditSession.modelName" type="info" effect="plain">{{ auditSession.modelName }}</ElTag>
            <ElTag v-if="auditSession.durationMs != null" effect="plain">耗时 {{ formatDuration(auditSession.durationMs) }}</ElTag>
            <ElTag v-if="auditSession.errorCount != null" :type="auditSession.errorCount > 0 ? 'danger' : 'success'" effect="plain">ERROR {{ auditSession.errorCount }}</ElTag>
            <ElTag v-if="auditSession.warningCount != null" :type="auditSession.warningCount > 0 ? 'warning' : 'success'" effect="plain">WARNING {{ auditSession.warningCount }}</ElTag>
            <ElTag v-if="auditSession.source" effect="plain">{{ auditSession.source === 'AI_AUDIT' ? '含 AI 建议' : '仅规则引擎' }}</ElTag>
          </div>
          <ElTimeline v-if="auditSessionSteps.length" class="audit-steps">
            <ElTimelineItem
              v-for="(step, idx) in auditSessionSteps"
              :key="`${step.code}-${idx}`"
              :type="stepStatusType(step.status)"
              :timestamp="formatDuration(step.durationMs)"
              placement="top"
            >
              <div class="step-title">
                <strong>{{ step.title || step.code }}</strong>
                <ElTag size="small" :type="stepStatusType(step.status)" effect="plain">{{ stepStatusLabel(step.status) }}</ElTag>
              </div>
              <div class="step-detail">{{ step.detail }}</div>
            </ElTimelineItem>
          </ElTimeline>
          <div v-if="auditSessionCoverage" class="coverage-box">
            <div class="coverage-title">{{ $tr('规则覆盖') }}</div>
            <div class="coverage-grid">
              <span>总数 {{ auditSessionCoverage.totalRules ?? 0 }}</span>
              <span>方言启用 {{ auditSessionCoverage.activeRules ?? 0 }}</span>
              <span>命中 {{ auditSessionCoverage.hitRules ?? 0 }}</span>
              <span>未命中 {{ auditSessionCoverage.cleanRules ?? 0 }}</span>
              <span>方言跳过 {{ auditSessionCoverage.skippedByDialect ?? 0 }}</span>
              <span>禁用 {{ auditSessionCoverage.disabledRules ?? 0 }}</span>
            </div>
            <div v-if="auditSessionCoverage.hitRuleCodes?.length" class="coverage-codes">
              命中：{{ auditSessionCoverage.hitRuleCodes.join('、') }}
            </div>
            <div v-if="auditSessionCoverage.skippedRuleCodes?.length" class="coverage-codes muted">
              方言跳过（部分）：{{ auditSessionCoverage.skippedRuleCodes.join('、') }}
            </div>
          </div>
          <template v-if="auditSession.ruleReportMarkdown">
            <h4>{{ $tr('确定性规则结果') }}</h4>
            <div class="report rule-report">{{ auditSession.ruleReportMarkdown }}</div>
          </template>
          <template v-if="auditSession.aiAdviceMarkdown || auditSession.aiStatus === 'failed'">
            <h4>{{ $tr('AI 审计建议') }}</h4>
            <ElAlert
              v-if="auditSession.aiStatus === 'failed'"
              type="warning"
              :closable="false"
              :title="auditSession.aiError || 'AI 建议生成失败'"
              style="margin-bottom: 8px"
            />
            <div v-if="auditSession.question" class="audit-question">DBA 问题：{{ auditSession.question }}</div>
            <div v-if="auditSession.aiAdviceMarkdown" class="report ai-report">{{ auditSession.aiAdviceMarkdown }}</div>
          </template>
        </template>
        <template v-else-if="detail.order.aiAuditReport">
          <h4>{{ $tr('审计报告') }}</h4>
          <div class="report">{{ detail.order.aiAuditReport }}</div>
        </template>

        <h4>{{ $tr('SQL 脚本') }}</h4><pre class="code">{{ detail.order.scriptText }}</pre>
        <template v-if="detail.order.executionMessage"><h4>{{ $tr('执行状态') }}</h4><ElAlert :title="detail.order.executionMessage" :type="detail.order.status === 'FAILED' ? 'error' : 'info'" :closable="false" /></template>
        <h4>{{ $tr('版本记录') }}</h4><ElTable :data="detail.versions" size="small"><ElTableColumn prop="versionNo" :label="$tr('版本')" width="70"><template #default="{ row }">v{{ row.versionNo }}</template></ElTableColumn><ElTableColumn prop="createdByName" :label="$tr('修改人')" width="110" /><ElTableColumn prop="changeNote" :label="$tr('说明')" /><ElTableColumn :label="$tr('时间')" width="170"><template #default="{ row }">{{ dateText(row.createTime) }}</template></ElTableColumn></ElTable>
        <h4>{{ $tr('审计轨迹') }}</h4>
        <ElTimeline>
          <ElTimelineItem v-for="event in detail.events" :key="event.id" :timestamp="dateText(event.createTime)" placement="top">
            <strong>{{ eventLabel(event.action) }}</strong> · {{ event.actorName }}
            <div>{{ event.commentText }}</div>
          </ElTimelineItem>
        </ElTimeline>
      </div>
    </ElDrawer>

    <ElDialog
      v-model="auditVisible"
      :title="auditPhase === 'done' ? $tr('AI 审计结果') : $tr('向 AI 询问 SQL 风险')"
      width="720px"
      destroy-on-close
      @closed="closeAuditDialog"
    >
      <template v-if="auditPhase === 'form'">
        <ElForm label-position="top">
          <ElFormItem :label="$tr('审计模型')">
            <ElSelect v-model="auditForm.modelId" filterable>
              <ElOption
                v-for="model in models"
                :key="model.id"
                :label="`${model.providerName || ''} / ${model.modelName || model.displayName || model.modelCode}`"
                :value="model.id"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem :label="$tr('DBA 审计问题')">
            <ElInput v-model="auditForm.question" type="textarea" :rows="5" />
          </ElFormItem>
        </ElForm>
      </template>

      <template v-else>
        <div v-if="auditResult" class="audit-summary" style="margin-bottom: 12px">
          <ElTag v-if="auditResult.modelName" type="info" effect="plain">{{ auditResult.modelName }}</ElTag>
          <ElTag effect="plain">耗时 {{ formatDuration(auditResult.durationMs) }}</ElTag>
          <ElTag :type="(auditResult.errorCount || 0) > 0 ? 'danger' : 'success'" effect="plain">ERROR {{ auditResult.errorCount || 0 }}</ElTag>
          <ElTag :type="(auditResult.warningCount || 0) > 0 ? 'warning' : 'success'" effect="plain">WARNING {{ auditResult.warningCount || 0 }}</ElTag>
        </div>
        <h4 class="dialog-section-title">{{ $tr('执行步骤') }}</h4>
        <ElTimeline class="audit-steps">
          <ElTimelineItem
            v-for="(step, idx) in auditSteps"
            :key="`${step.code}-${idx}`"
            :type="stepStatusType(step.status)"
            :timestamp="formatDuration(step.durationMs)"
            placement="top"
          >
            <div class="step-title">
              <strong>{{ step.title || step.code }}</strong>
              <ElTag size="small" :type="stepStatusType(step.status)" effect="plain">{{ stepStatusLabel(step.status) }}</ElTag>
            </div>
            <div class="step-detail">{{ step.detail }}</div>
          </ElTimelineItem>
        </ElTimeline>

        <template v-if="auditPhase === 'done' && auditResult">
          <div v-if="auditResult.coverage" class="coverage-box">
            <div class="coverage-title">{{ $tr('规则覆盖') }}</div>
            <div class="coverage-grid">
              <span>总数 {{ auditResult.coverage.totalRules ?? 0 }}</span>
              <span>方言启用 {{ auditResult.coverage.activeRules ?? 0 }}</span>
              <span>命中 {{ auditResult.coverage.hitRules ?? 0 }}</span>
              <span>未命中 {{ auditResult.coverage.cleanRules ?? 0 }}</span>
              <span>方言跳过 {{ auditResult.coverage.skippedByDialect ?? 0 }}</span>
              <span>禁用 {{ auditResult.coverage.disabledRules ?? 0 }}</span>
            </div>
          </div>
          <h4 class="dialog-section-title">{{ $tr('确定性规则结果') }}</h4>
          <div class="report rule-report">{{ auditResult.ruleReportMarkdown }}</div>
          <h4 class="dialog-section-title">{{ $tr('AI 审计建议') }}</h4>
          <ElAlert
            v-if="auditResult.aiStatus === 'failed'"
            type="warning"
            :closable="false"
            :title="auditResult.aiError || 'AI 建议生成失败，规则结果仍可参考'"
            style="margin-bottom: 8px"
          />
          <div v-if="auditResult.aiAdviceMarkdown" class="report ai-report">{{ auditResult.aiAdviceMarkdown }}</div>
          <div v-else-if="auditResult.aiStatus !== 'failed'" class="report ai-report muted">暂无 AI 建议</div>
        </template>
        <ElAlert
          v-else-if="auditPhase === 'running'"
          type="info"
          :closable="false"
          title="规则预审已优先执行；大模型建议生成中。下方步骤为真实进度。"
          style="margin-top: 8px"
        />
      </template>

      <template #footer>
        <template v-if="auditPhase === 'form'">
          <ElButton @click="closeAuditDialog">{{ $tr('取消') }}</ElButton>
          <ElButton type="primary" :loading="auditLoading" @click="runAudit">{{ $tr('开始审计') }}</ElButton>
        </template>
        <template v-else-if="auditPhase === 'running'">
          <ElButton disabled :loading="true">{{ $tr('审计进行中') }}</ElButton>
        </template>
        <template v-else>
          <ElButton type="primary" @click="closeAuditDialog">{{ $tr('完成') }}</ElButton>
        </template>
      </template>
    </ElDialog>
  </Page>
</template>

<style scoped>
.work-order-page { height: 100%; min-height: 520px; background: var(--el-bg-color); }
.toolbar { min-height: 54px; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--el-border-color); }
.toolbar h2 { margin: 0; font-size: 17px; letter-spacing: 0; white-space: nowrap; }
.filters { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.filters .el-input { width: 180px; }.filters .el-select { width: 140px; }
.el-pagination { justify-content: flex-end; padding: 10px 14px; }
.target-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.target-row .el-select { width: 100%; }
.sql-input :deep(textarea), .code { font-family: Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.55; }
.detail-head { display: flex; align-items: center; gap: 8px; }.detail-head h3 { margin: 0 auto 0 0; font-size: 16px; letter-spacing: 0; }
.detail h4 { margin: 20px 0 8px; font-size: 14px; letter-spacing: 0; }
.code { max-height: 330px; overflow: auto; margin: 0; padding: 12px; border: 1px solid var(--el-border-color); background: var(--el-fill-color-light); white-space: pre-wrap; }
.report { white-space: pre-wrap; line-height: 1.65; padding: 12px; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); }
.rule-report { border-left-color: var(--el-color-warning); }
.ai-report { border-left-color: var(--el-color-success); }
.hit-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.4; }
.audit-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.audit-steps { padding-left: 4px; }
.step-title { display: flex; align-items: center; gap: 8px; }
.step-detail { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.45; }
.coverage-box { margin: 10px 0 14px; padding: 10px 12px; border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank); }
.coverage-title { font-weight: 600; margin-bottom: 6px; font-size: 13px; }
.coverage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 12px; font-size: 12px; }
.coverage-codes { margin-top: 8px; font-size: 12px; line-height: 1.45; word-break: break-all; }
.coverage-codes.muted { color: var(--el-text-color-secondary); }
.audit-question { margin-bottom: 8px; font-size: 13px; color: var(--el-text-color-secondary); }
.dialog-section-title { margin: 14px 0 8px; font-size: 14px; }
@media (max-width: 900px) {
  .toolbar { flex-wrap: wrap; }
  .filters { width: 100%; margin-left: 0; flex-wrap: wrap; }
  .target-row { grid-template-columns: 1fr; }
  .coverage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.report.muted { color: var(--el-text-color-secondary); }
</style>
