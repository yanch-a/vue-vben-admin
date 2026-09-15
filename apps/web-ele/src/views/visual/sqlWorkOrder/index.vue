<script lang="ts" setup>
import type { SqlWorkOrder } from '#/api/visual/sqlWorkOrder';

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { ArrowLeft, Download, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listSelectableModels } from '#/api/ai/model';
import { getInstances } from '#/api/visual/database';
import {
  auditWorkOrder,
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
const rows = ref<SqlWorkOrder[]>([]);
const total = ref(0);
const dba = ref(false);
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
const auditForm = reactive({ modelId: undefined as any, question: '' });
const models = ref<any[]>([]);
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const statusOptions = [
  ['DRAFT', '草稿'], ['PENDING', '待审批'], ['APPROVED', '已通过'],
  ['REJECTED', '已驳回'], ['PREPARING', '准备回滚'], ['EXECUTING', '执行中'], ['SUCCESS', '执行成功'], ['FAILED', '执行失败'],
];
const statusLabel = Object.fromEntries(statusOptions);

function unbox(res: any) { return res?.data ?? res; }
function typeForStatus(status?: string) {
  if (status === 'SUCCESS' || status === 'APPROVED') return 'success';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'PENDING' || status === 'PREPARING' || status === 'EXECUTING') return 'warning';
  return 'info';
}
function typeForRisk(level?: string) {
  if (level === 'CRITICAL') return 'danger';
  if (level === 'HIGH') return 'warning';
  if (level === 'MEDIUM') return 'primary';
  return 'success';
}
function dateText(value?: string) { return value ? new Date(value).toLocaleString() : '-'; }

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

async function submit(row: SqlWorkOrder) {
  await ElMessageBox.confirm('提交后脚本将锁定，修改需驳回后生成新版本。确认提交？', '提交 DBA 审批', { type: 'warning' });
  await submitWorkOrder(row.id);
  ElMessage.success('已提交审批'); await load();
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
  auditVisible.value = true;
}

async function runAudit() {
  const order = detail.value?.order;
  if (!order) return;
  auditLoading.value = true;
  try {
    await auditWorkOrder(order.id, { ...auditForm });
    ElMessage.success('AI 审计完成，结论已写入工单记录');
    auditVisible.value = false;
    await openDetail(order);
    await load();
  } finally { auditLoading.value = false; }
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
  try {
    await ElMessageBox.confirm('系统会先读取旧数据并生成回滚文件，成功后才执行 SQL。确认开始？', '执行已审批工单', { type: 'warning' });
    await executeWorkOrder(row.id, false);
  } catch (error: any) {
    const message = error?.message || String(error || '');
    if (!message.includes('人工回滚') && !message.includes('无法自动还原')) throw error;
    await ElMessageBox.confirm(`${message}\n\n确认由 DBA 人工处理无法自动还原的部分？`, '回滚不完整', { type: 'error', confirmButtonText: '接受风险并执行' });
    await executeWorkOrder(row.id, true);
  }
  ElMessage.success('回滚文件已生成，工单进入执行队列'); await load();
}

async function downloadRollback(row: SqlWorkOrder) {
  const data: any = await downloadWorkOrderRollback(row.id);
  const blob = data instanceof Blob ? data : data?.data;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = `work-order-${row.id}-rollback.sql`; anchor.click();
  URL.revokeObjectURL(href);
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
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); });

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
              <ElButton v-if="['PENDING','APPROVED'].includes(row.status)" link type="primary" @click="openDetail(row).then(() => openAudit())">{{ $tr('AI 审计') }}</ElButton>
              <ElButton v-if="row.status === 'PENDING'" link type="success" @click="review(row, true)">{{ $tr('通过') }}</ElButton>
              <ElButton v-if="row.status === 'PENDING'" link type="danger" @click="review(row, false)">{{ $tr('驳回') }}</ElButton>
              <ElButton v-if="row.status === 'APPROVED'" link type="warning" @click="execute(row)">{{ $tr('执行') }}</ElButton>
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
        <h4>{{ $tr('SQL 脚本') }}</h4><pre class="code">{{ detail.order.scriptText }}</pre>
        <template v-if="detail.order.aiAuditReport"><h4>{{ $tr('审计报告') }}</h4><div class="report">{{ detail.order.aiAuditReport }}</div></template>
        <template v-if="detail.order.executionMessage"><h4>{{ $tr('执行状态') }}</h4><ElAlert :title="detail.order.executionMessage" :type="detail.order.status === 'FAILED' ? 'error' : 'info'" :closable="false" /></template>
        <h4>{{ $tr('版本记录') }}</h4><ElTable :data="detail.versions" size="small"><ElTableColumn prop="versionNo" :label="$tr('版本')" width="70"><template #default="{ row }">v{{ row.versionNo }}</template></ElTableColumn><ElTableColumn prop="createdByName" :label="$tr('修改人')" width="110" /><ElTableColumn prop="changeNote" :label="$tr('说明')" /><ElTableColumn :label="$tr('时间')" width="170"><template #default="{ row }">{{ dateText(row.createTime) }}</template></ElTableColumn></ElTable>
        <h4>{{ $tr('审计轨迹') }}</h4><ElTimeline><ElTimelineItem v-for="event in detail.events" :key="event.id" :timestamp="dateText(event.createTime)" placement="top"><strong>{{ event.action }}</strong> · {{ event.actorName }}<div>{{ event.commentText }}</div></ElTimelineItem></ElTimeline>
      </div>
    </ElDrawer>

    <ElDialog v-model="auditVisible" :title="$tr('向 AI 询问 SQL 风险')" width="620px">
      <ElForm label-position="top"><ElFormItem :label="$tr('审计模型')"><ElSelect v-model="auditForm.modelId" filterable><ElOption v-for="model in models" :key="model.id" :label="`${model.providerName || ''} / ${model.modelName || model.modelCode}`" :value="model.id" /></ElSelect></ElFormItem><ElFormItem :label="$tr('DBA 审计问题')"><ElInput v-model="auditForm.question" type="textarea" :rows="5" /></ElFormItem></ElForm>
      <template #footer><ElButton @click="auditVisible = false">{{ $tr('取消') }}</ElButton><ElButton type="primary" :loading="auditLoading" @click="runAudit">{{ $tr('开始审计') }}</ElButton></template>
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
@media (max-width: 900px) { .toolbar { flex-wrap: wrap; }.filters { width: 100%; margin-left: 0; flex-wrap: wrap; }.target-row { grid-template-columns: 1fr; } }
</style>
