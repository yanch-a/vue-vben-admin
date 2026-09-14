<script lang="ts" setup>
/**
 * 数据大屏工作台：一个入口内完成图表资产维护、大屏管理和大屏编排。
 * @author yanch
 */
import type {
  ChartAsset,
  ChartSpec,
  QueryResult,
  ScreenConfig,
  ScreenWidget,
} from '#/api/visual/dashboard';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  deleteChart,
  deleteScreen,
  getScreen,
  listCharts,
  listScreens,
  previewChart,
  previewScreen,
  publishScreen,
  refreshScreen,
  runChart,
  saveChartAsset,
  saveScreenDraft,
} from '#/api/visual/dashboard';
import { getInstances } from '#/api/visual/database';
import { getDbConfigList } from '#/api/visual/vq';

import ChartRenderer from './components/ChartRenderer.vue';

defineOptions({ name: 'VisualDashboardWorkbench' });

type WorkMode = 'charts' | 'editor' | 'screens';

const router = useRouter();
const mode = ref<WorkMode>('screens');
const loading = ref(false);
const charts = ref<ChartAsset[]>([]);
const screens = ref<any[]>([]);
const chartKeyword = ref('');
const screenKeyword = ref('');
const results = reactive<Record<string, QueryResult>>({});
const selectedWidgetId = ref('');
const canvasRef = ref<HTMLElement>();
const dirty = ref(false);

const screenForm = reactive({
  id: undefined as number | string | undefined,
  name: '未命名大屏',
  description: '',
  draftRevision: undefined as number | undefined,
  refreshMode: 'LIVE',
  refreshIntervalSeconds: 300,
});
const screenConfig = reactive<ScreenConfig>(emptyConfig());

const chartDialog = ref(false);
const chartSaving = ref(false);
const chartPreview = ref<QueryResult>();
const connections = ref<any[]>([]);
const instances = ref<string[]>([]);
const chartForm = reactive<ChartAsset>({
  title: '', dbConfigId: undefined, instanceName: '', sqlText: '',
  chartSpec: JSON.stringify(defaultSpec()), maxRows: 2000, timeoutSeconds: 30, sourceType: 'MANUAL',
});
const chartSpecForm = reactive({
  chartType: 'bar', xField: '', yFields: '', seriesField: '',
  valueFormat: 'number', stack: false, sortBy: '', sortOrder: 'asc',
});

const selectedWidget = computed(() =>
  screenConfig.widgets.find((item) => item.id === selectedWidgetId.value),
);
const filteredCharts = computed(() => {
  const keyword = chartKeyword.value.trim().toLowerCase();
  return keyword ? charts.value.filter((item) => `${item.title} ${item.description || ''}`.toLowerCase().includes(keyword)) : charts.value;
});
const filteredScreens = computed(() => {
  const keyword = screenKeyword.value.trim().toLowerCase();
  return keyword ? screens.value.filter((item) => `${item.name} ${item.description || ''}`.toLowerCase().includes(keyword)) : screens.value;
});

function defaultSpec(): ChartSpec {
  return { chartType: 'bar', xField: '', yFields: [] };
}

function emptyConfig(): ScreenConfig {
  return { schemaVersion: 1, width: 1200, height: 675, background: '#0b1220', widgets: [] };
}

function unwrap<T>(response: any, fallback: T): T {
  return (response?.data ?? response ?? fallback) as T;
}

function parseSpec(value?: string): ChartSpec {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<ChartSpec>;
    return { ...defaultSpec(), ...parsed, yFields: Array.isArray(parsed.yFields) ? parsed.yFields : [] };
  }
  catch { return defaultSpec(); }
}

async function loadAll() {
  loading.value = true;
  try {
    const [chartRes, screenRes] = await Promise.all([listCharts(), listScreens()]);
    charts.value = unwrap(chartRes, []);
    screens.value = unwrap(screenRes, []);
  } finally { loading.value = false; }
}

async function loadConnections() {
  if (connections.value.length) return;
  const response: any = await getDbConfigList({});
  connections.value = unwrap(response, []);
}

async function changeConnection() {
  instances.value = [];
  chartForm.instanceName = '';
  if (!chartForm.dbConfigId) return;
  const response: any = await getInstances(chartForm.dbConfigId);
  const trees: any[] = unwrap(response, []);
  instances.value = (trees[0]?.instances || []).map((item: any) => item.instanceName).filter(Boolean);
  chartForm.instanceName = instances.value[0] || '';
}

/** 切换组件连接时同步刷新实例列表，SQL 与数据源都可在大屏内独立配置。 */
async function changeWidgetConnection(widget: ScreenWidget) {
  instances.value = [];
  widget.data.instanceName = '';
  if (!widget.data.dbConfigId) return;
  const response: any = await getInstances(widget.data.dbConfigId);
  const trees: any[] = unwrap(response, []);
  instances.value = (trees[0]?.instances || []).map((item: any) => item.instanceName).filter(Boolean);
  widget.data.instanceName = instances.value[0] || '';
  dirty.value = true;
}

function defaultParamsText(widget: ScreenWidget) {
  return JSON.stringify(widget.data.defaultParams || {}, null, 2);
}

function updateDefaultParams(widget: ScreenWidget, value: string) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    widget.data.defaultParams = parsed;
    dirty.value = true;
  } catch {
    ElMessage.warning('默认参数必须是 JSON 对象，例如 {"startDate":"2026-01-01"}');
  }
}

function fillChartSpec() {
  chartForm.chartSpec = JSON.stringify({
    chartType: chartSpecForm.chartType,
    xField: chartSpecForm.xField.trim() || undefined,
    yFields: chartSpecForm.yFields.split(',').map((item) => item.trim()).filter(Boolean),
    seriesField: chartSpecForm.seriesField.trim() || undefined,
    valueFormat: chartSpecForm.valueFormat,
    stack: chartSpecForm.stack,
    sortBy: chartSpecForm.sortBy.trim() || undefined,
    sortOrder: chartSpecForm.sortOrder,
  });
}

async function openChartDialog(asset?: ChartAsset) {
  await loadConnections();
  Object.assign(chartForm, asset || {
    id: undefined, title: '', description: '', dbConfigId: undefined,
    instanceName: '', sqlText: '', chartSpec: JSON.stringify(defaultSpec()), maxRows: 2000, timeoutSeconds: 30, sourceType: 'MANUAL',
  });
  const spec = parseSpec(chartForm.chartSpec);
  Object.assign(chartSpecForm, {
    chartType: spec.chartType, xField: spec.xField || '', yFields: spec.yFields.join(', '),
    seriesField: spec.seriesField || '', valueFormat: spec.valueFormat || 'number', stack: Boolean(spec.stack),
    sortBy: spec.sortBy || '', sortOrder: spec.sortOrder || 'asc',
  });
  chartPreview.value = undefined;
  chartDialog.value = true;
  if (chartForm.dbConfigId) await changeConnection();
  if (asset?.instanceName) chartForm.instanceName = asset.instanceName;
}

async function doPreviewChart() {
  fillChartSpec();
  chartPreview.value = unwrap(await previewChart(chartForm), undefined as any);
}

async function doSaveChart() {
  fillChartSpec();
  chartSaving.value = true;
  try {
    await saveChartAsset(chartForm);
    ElMessage.success('图表已保存，可直接拖入大屏');
    chartDialog.value = false;
    await loadAll();
  } finally { chartSaving.value = false; }
}

async function removeChart(asset: ChartAsset) {
  await ElMessageBox.confirm(`确定删除图表“${asset.title}”吗？`, '删除图表', { type: 'warning' });
  await deleteChart(asset.id!);
  await loadAll();
}

function newScreen() {
  Object.assign(screenForm, { id: undefined, name: '未命名大屏', description: '', draftRevision: undefined, refreshMode: 'LIVE', refreshIntervalSeconds: 300 });
  Object.assign(screenConfig, emptyConfig());
  selectedWidgetId.value = '';
  Object.keys(results).forEach((key) => delete results[key]);
  dirty.value = false;
  mode.value = 'editor';
}

async function editScreen(id: number | string) {
  const detail: any = unwrap(await getScreen(id), {});
  Object.assign(screenForm, {
    id: detail.id, name: detail.name, description: detail.description || '',
    draftRevision: detail.draftRevision, refreshMode: detail.refreshMode || 'LIVE',
    refreshIntervalSeconds: detail.refreshIntervalSeconds || 300,
  });
  Object.assign(screenConfig, emptyConfig(), detail.config || {});
  selectedWidgetId.value = '';
  Object.keys(results).forEach((key) => delete results[key]);
  dirty.value = false;
  mode.value = 'editor';
}

function assetToWidget(asset: ChartAsset, x = 30, y = 30): ScreenWidget {
  return {
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    chartId: asset.id,
    title: asset.title,
    chartSpec: parseSpec(asset.chartSpec),
    data: {
      dbConfigId: asset.dbConfigId, instanceName: asset.instanceName,
      sqlText: asset.sqlText, maxRows: asset.maxRows || 2000, timeoutSeconds: asset.timeoutSeconds || 30,
    },
    x, y, w: 420, h: 260,
  };
}

async function addChart(asset: ChartAsset, x?: number, y?: number) {
  const widget = assetToWidget(asset, x, y);
  screenConfig.widgets.push(widget);
  selectedWidgetId.value = widget.id;
  dirty.value = true;
  try { results[widget.id] = unwrap(await runChart(asset.id!), {} as QueryResult); }
  catch { /* 图表仍可加入画布，用户可在右侧修正 SQL 后统一预览。 */ }
}

function startAssetDrag(event: DragEvent, asset: ChartAsset) {
  event.dataTransfer?.setData('application/x-dashboard-chart', String(asset.id));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

function dropAsset(event: DragEvent) {
  const id = event.dataTransfer?.getData('application/x-dashboard-chart');
  const asset = charts.value.find((item) => String(item.id) === id);
  if (!asset || !canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  const scale = rect.width / screenConfig.width;
  void addChart(asset,
    Math.max(0, Math.round((event.clientX - rect.left) / scale - 210)),
    Math.max(0, Math.round((event.clientY - rect.top) / scale - 30)));
}

function widgetStyle(widget: ScreenWidget) {
  return {
    left: `${widget.x / screenConfig.width * 100}%`, top: `${widget.y / screenConfig.height * 100}%`,
    width: `${widget.w / screenConfig.width * 100}%`, height: `${widget.h / screenConfig.height * 100}%`,
  };
}

function beginPointer(event: PointerEvent, widget: ScreenWidget, resize = false) {
  event.stopPropagation();
  selectWidget(widget);
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  const scale = (canvasRef.value?.getBoundingClientRect().width || screenConfig.width) / screenConfig.width;
  const move = (moveEvent: PointerEvent) => {
    const dx = (moveEvent.clientX - startX) / scale;
    const dy = (moveEvent.clientY - startY) / scale;
    if (resize) {
      widget.w = Math.max(220, Math.min(screenConfig.width - widget.x, initial.w + dx));
      widget.h = Math.max(140, Math.min(screenConfig.height - widget.y, initial.h + dy));
    } else {
      widget.x = Math.max(0, Math.min(screenConfig.width - widget.w, initial.x + dx));
      widget.y = Math.max(0, Math.min(screenConfig.height - widget.h, initial.y + dy));
    }
    dirty.value = true;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function selectWidget(widget: ScreenWidget) {
  selectedWidgetId.value = widget.id;
  if (!widget.data.dbConfigId) return;
  getInstances(widget.data.dbConfigId).then((response: any) => {
    const trees: any[] = unwrap(response, []);
    instances.value = (trees[0]?.instances || []).map((item: any) => item.instanceName).filter(Boolean);
  }).catch(() => { instances.value = []; });
}

function removeSelectedWidget() {
  const index = screenConfig.widgets.findIndex((item) => item.id === selectedWidgetId.value);
  if (index < 0) return;
  screenConfig.widgets.splice(index, 1);
  selectedWidgetId.value = '';
  dirty.value = true;
}

async function saveDraft(showMessage = true) {
  const detail: any = unwrap(await saveScreenDraft({ ...screenForm, config: screenConfig }), {});
  screenForm.id = detail.id;
  screenForm.draftRevision = detail.draftRevision;
  dirty.value = false;
  if (showMessage) ElMessage.success('草稿已保存');
  return detail;
}

async function previewAll() {
  const bundle: any = unwrap(await previewScreen(screenConfig), {});
  Object.assign(results, bundle.datasets || {});
  ElMessage.success(`已刷新 ${Object.keys(bundle.datasets || {}).length} 个图表`);
}

async function publish() {
  await saveDraft(false);
  await publishScreen(screenForm.id!);
  ElMessage.success('发布成功，查看页已切换到新版本');
  await loadAll();
}

function viewScreen(id: number | string) {
  const target = router.resolve({ name: 'VisualDashboardView', params: { id } });
  window.open(target.href, '_blank', 'noopener');
}

async function manualRefresh(id: number | string) {
  await refreshScreen(id);
  ElMessage.success('数据刷新成功');
  await loadAll();
}

async function removeScreen(row: any) {
  await ElMessageBox.confirm(`确定删除大屏“${row.name}”吗？`, '删除大屏', { type: 'warning' });
  await deleteScreen(row.id);
  await loadAll();
}

async function leaveEditor() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('当前修改尚未保存，确定返回列表吗？', '未保存修改', {
        confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning',
      });
    } catch { return; }
  }
  mode.value = 'screens';
}

onMounted(() => { void loadAll(); void loadConnections(); });
</script>

<template>
  <div class="workbench" v-loading="loading">
    <header class="topbar">
      <div>
        <h2>数据大屏工作台</h2>
        <p>图表资产、自由编排、发布与数据刷新都在这里完成</p>
      </div>
      <div v-if="mode !== 'editor'" class="top-actions">
        <ElButton :type="mode === 'screens' ? 'primary' : ''" @click="mode = 'screens'">我的大屏</ElButton>
        <ElButton :type="mode === 'charts' ? 'primary' : ''" @click="mode = 'charts'">图表库</ElButton>
        <ElButton type="primary" @click="newScreen">新建大屏</ElButton>
      </div>
      <div v-else class="top-actions">
        <span class="save-state">{{ dirty ? '有未保存修改' : '已保存' }}</span>
        <ElButton @click="leaveEditor">返回列表</ElButton>
        <ElButton @click="previewAll">刷新预览</ElButton>
        <ElButton @click="saveDraft()">保存草稿</ElButton>
        <ElButton type="primary" @click="publish">保存并发布</ElButton>
      </div>
    </header>

    <main v-if="mode === 'screens'" class="library">
      <div class="library-head">
        <ElInput v-model="screenKeyword" clearable placeholder="搜索大屏" class="search" />
        <span>{{ filteredScreens.length }} 个大屏</span>
      </div>
      <ElEmpty v-if="!filteredScreens.length" description="还没有大屏，从新建大屏开始" />
      <div v-else class="card-grid">
        <article v-for="row in filteredScreens" :key="row.id" class="asset-card screen-card">
          <div class="screen-cover"><span>{{ row.status === 'PUBLISHED' ? '已发布' : '草稿' }}</span></div>
          <h3>{{ row.name }}</h3><p>{{ row.description || '暂无说明' }}</p>
          <small>{{ row.refreshMode === 'LIVE' ? '每次查看实时查询' : `每 ${row.refreshIntervalSeconds}s 更新快照` }}</small>
          <div class="card-actions">
            <ElButton size="small" type="primary" @click="editScreen(row.id)">编辑</ElButton>
            <ElButton size="small" :disabled="row.status !== 'PUBLISHED'" @click="viewScreen(row.id)">查看</ElButton>
            <ElButton size="small" :disabled="row.status !== 'PUBLISHED'" @click="manualRefresh(row.id)">刷新数据</ElButton>
            <ElButton size="small" type="danger" text @click="removeScreen(row)">删除</ElButton>
          </div>
        </article>
      </div>
    </main>

    <main v-else-if="mode === 'charts'" class="library">
      <div class="library-head">
        <ElInput v-model="chartKeyword" clearable placeholder="搜索图表" class="search" />
        <ElButton type="primary" @click="openChartDialog()">新建图表</ElButton>
      </div>
      <ElEmpty v-if="!filteredCharts.length" description="AI SQL 保存的图表和手工图表会出现在这里" />
      <div v-else class="card-grid">
        <article v-for="asset in filteredCharts" :key="asset.id" class="asset-card">
          <div class="chart-badge">{{ parseSpec(asset.chartSpec).chartType.toUpperCase() }}</div>
          <h3>{{ asset.title }}</h3><p>{{ asset.description || asset.sqlText }}</p>
          <div class="card-actions">
            <ElButton size="small" type="primary" @click="openChartDialog(asset)">编辑</ElButton>
            <ElButton size="small" @click="newScreen(); addChart(asset)">加入新大屏</ElButton>
            <ElButton size="small" type="danger" text @click="removeChart(asset)">删除</ElButton>
          </div>
        </article>
      </div>
    </main>

    <main v-else class="editor">
      <aside class="asset-panel">
        <h3>图表资产</h3>
        <ElInput v-model="chartKeyword" size="small" clearable placeholder="搜索，拖入画布" />
        <div class="asset-list">
          <div v-for="asset in filteredCharts" :key="asset.id" class="drag-asset" draggable="true"
            @dragstart="startAssetDrag($event, asset)" @dblclick="addChart(asset)">
            <b>{{ asset.title }}</b><span>{{ parseSpec(asset.chartSpec).chartType }}</span>
          </div>
        </div>
        <ElButton class="full" @click="openChartDialog()">+ 新建图表</ElButton>
      </aside>

      <section class="canvas-stage" @click="selectedWidgetId = ''">
        <div ref="canvasRef" class="canvas" :style="{ background: screenConfig.background }"
          @dragover.prevent @drop.prevent="dropAsset">
          <div v-if="!screenConfig.widgets.length" class="drop-hint">从左侧拖入图表，或双击图表快速添加</div>
          <article v-for="widget in screenConfig.widgets" :key="widget.id" class="canvas-widget"
            :class="{ selected: selectedWidgetId === widget.id }" :style="widgetStyle(widget)"
            @click.stop="selectWidget(widget)">
            <header @pointerdown="beginPointer($event, widget)"><span>{{ widget.title }}</span><i>拖动</i></header>
            <div class="widget-body"><ChartRenderer :spec="widget.chartSpec" :result="results[widget.id]" /></div>
            <button class="resize" title="拖动调整大小" @pointerdown="beginPointer($event, widget, true)" />
          </article>
        </div>
      </section>

      <aside class="property-panel">
        <template v-if="selectedWidget">
          <div class="panel-title"><h3>图表设置</h3><ElButton type="danger" text @click="removeSelectedWidget">移除</ElButton></div>
          <ElForm label-position="top" size="small">
            <ElFormItem label="标题"><ElInput v-model="selectedWidget.title" @input="dirty = true" /></ElFormItem>
            <ElFormItem label="图表类型">
              <ElSelect v-model="selectedWidget.chartSpec.chartType" @change="dirty = true">
                <ElOption v-for="item in ['bar','line','area','pie','scatter','kpi','table']" :key="item" :value="item" :label="item" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="X 字段"><ElInput v-model="selectedWidget.chartSpec.xField" @input="dirty = true" /></ElFormItem>
            <ElFormItem label="Y 字段（逗号分隔）">
              <ElInput :model-value="selectedWidget.chartSpec.yFields.join(', ')"
                @input="selectedWidget.chartSpec.yFields = String($event).split(',').map(v => v.trim()).filter(Boolean); dirty = true" />
            </ElFormItem>
            <ElFormItem label="系列字段"><ElInput v-model="selectedWidget.chartSpec.seriesField" placeholder="可选：按该字段拆分系列" @input="dirty = true" /></ElFormItem>
            <div class="form-row">
              <ElFormItem label="数值格式"><ElSelect v-model="selectedWidget.chartSpec.valueFormat" @change="dirty = true">
                <ElOption label="普通数字" value="number" /><ElOption label="百分比" value="percent" /><ElOption label="人民币" value="currency" />
              </ElSelect></ElFormItem>
              <ElFormItem label="堆叠"><ElSwitch v-model="selectedWidget.chartSpec.stack" @change="dirty = true" /></ElFormItem>
            </div>
            <div class="form-row">
              <ElFormItem label="排序字段"><ElInput v-model="selectedWidget.chartSpec.sortBy" placeholder="可选" @input="dirty = true" /></ElFormItem>
              <ElFormItem label="顺序"><ElSelect v-model="selectedWidget.chartSpec.sortOrder" @change="dirty = true"><ElOption label="升序" value="asc" /><ElOption label="降序" value="desc" /></ElSelect></ElFormItem>
            </div>
            <ElFormItem label="SQL（支持 :name 参数）">
              <ElInput v-model="selectedWidget.data.sqlText" type="textarea" :rows="9" @input="dirty = true" />
            </ElFormItem>
            <ElFormItem label="数据库连接">
              <ElSelect v-model="selectedWidget.data.dbConfigId" filterable @change="changeWidgetConnection(selectedWidget)">
                <ElOption v-for="item in connections" :key="item.id" :value="item.id" :label="item.dbName || item.name || item.dbHost" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="实例 / Schema">
              <ElSelect v-model="selectedWidget.data.instanceName" filterable allow-create @change="dirty = true">
                <ElOption v-for="item in instances" :key="item" :value="item" :label="item" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="默认参数 JSON">
              <ElInput :model-value="defaultParamsText(selectedWidget)" type="textarea" :rows="3"
                placeholder='{"startDate":"2026-01-01"}' @change="updateDefaultParams(selectedWidget, String($event))" />
            </ElFormItem>
            <div class="form-row">
              <ElFormItem label="最大行数"><ElInputNumber v-model="selectedWidget.data.maxRows" :min="1" :max="5000" @change="dirty = true" /></ElFormItem>
              <ElFormItem label="超时(秒)"><ElInputNumber v-model="selectedWidget.data.timeoutSeconds" :min="1" :max="120" @change="dirty = true" /></ElFormItem>
            </div>
          </ElForm>
        </template>
        <template v-else>
          <h3>大屏设置</h3>
          <ElForm label-position="top" size="small">
            <ElFormItem label="名称"><ElInput v-model="screenForm.name" @input="dirty = true" /></ElFormItem>
            <ElFormItem label="说明"><ElInput v-model="screenForm.description" type="textarea" :rows="2" @input="dirty = true" /></ElFormItem>
            <ElFormItem label="背景"><ElColorPicker v-model="screenConfig.background" @change="dirty = true" /></ElFormItem>
            <ElFormItem label="数据更新策略">
              <ElRadioGroup v-model="screenForm.refreshMode" @change="dirty = true">
                <ElRadio value="LIVE">每次查看实时查询</ElRadio>
                <ElRadio value="INTERVAL_SNAPSHOT">后台定时快照</ElRadio>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="screenForm.refreshMode === 'INTERVAL_SNAPSHOT'" label="更新间隔（秒）">
              <ElInputNumber v-model="screenForm.refreshIntervalSeconds" :min="30" :max="86400" @change="dirty = true" />
            </ElFormItem>
            <ElAlert title="发布后查看页读取冻结版本；继续编辑草稿不会影响线上大屏。" type="info" :closable="false" />
          </ElForm>
        </template>
      </aside>
    </main>

    <ElDialog v-model="chartDialog" title="图表编辑器" width="900px" destroy-on-close>
      <div class="chart-editor">
        <ElForm label-position="top">
          <div class="form-row">
            <ElFormItem label="图表名称"><ElInput v-model="chartForm.title" /></ElFormItem>
            <ElFormItem label="数据库连接"><ElSelect v-model="chartForm.dbConfigId" filterable @change="changeConnection">
              <ElOption v-for="item in connections" :key="item.id" :value="item.id" :label="item.dbName || item.name || item.dbHost" />
            </ElSelect></ElFormItem>
            <ElFormItem label="实例 / Schema"><ElSelect v-model="chartForm.instanceName" filterable allow-create>
              <ElOption v-for="item in instances" :key="item" :value="item" :label="item" />
            </ElSelect></ElFormItem>
          </div>
          <ElFormItem label="只读 SQL"><ElInput v-model="chartForm.sqlText" type="textarea" :rows="7" placeholder="SELECT category, amount FROM ..." /></ElFormItem>
          <div class="form-row">
            <ElFormItem label="图表类型"><ElSelect v-model="chartSpecForm.chartType">
              <ElOption v-for="item in ['bar','line','area','pie','scatter','kpi','table']" :key="item" :value="item" :label="item" />
            </ElSelect></ElFormItem>
            <ElFormItem label="X 字段"><ElInput v-model="chartSpecForm.xField" /></ElFormItem>
            <ElFormItem label="Y 字段（逗号分隔）"><ElInput v-model="chartSpecForm.yFields" /></ElFormItem>
          </div>
          <div class="form-row">
            <ElFormItem label="系列字段"><ElInput v-model="chartSpecForm.seriesField" placeholder="可选" /></ElFormItem>
            <ElFormItem label="数值格式"><ElSelect v-model="chartSpecForm.valueFormat"><ElOption label="普通数字" value="number" /><ElOption label="百分比" value="percent" /><ElOption label="人民币" value="currency" /></ElSelect></ElFormItem>
            <ElFormItem label="排序"><ElInput v-model="chartSpecForm.sortBy" placeholder="字段名（可选）" /></ElFormItem>
            <ElFormItem label="顺序"><ElSelect v-model="chartSpecForm.sortOrder"><ElOption label="升序" value="asc" /><ElOption label="降序" value="desc" /></ElSelect></ElFormItem>
            <ElFormItem label="堆叠"><ElSwitch v-model="chartSpecForm.stack" /></ElFormItem>
          </div>
        </ElForm>
        <div class="dialog-preview"><ChartRenderer v-if="chartPreview" :spec="parseSpec(chartForm.chartSpec)" :result="chartPreview" /><ElEmpty v-else description="点击预览验证 SQL 和字段" /></div>
      </div>
      <template #footer><ElButton @click="doPreviewChart">运行预览</ElButton><ElButton type="primary" :loading="chartSaving" @click="doSaveChart">保存图表</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
.workbench { min-height: calc(100vh - 92px); background: var(--el-bg-color-page); color: var(--el-text-color-primary); }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.topbar h2,.topbar p,.asset-card h3,.asset-card p { margin: 0; }.topbar p { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 13px; }
.top-actions,.card-actions,.library-head,.panel-title,.form-row { display: flex; align-items: center; gap: 10px; }.save-state { color: var(--el-text-color-secondary); font-size: 12px; }
.library { padding: 22px; }.library-head { justify-content: space-between; margin-bottom: 18px; }.search { max-width: 320px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; }.asset-card { position: relative; padding: 18px; min-height: 140px; overflow: hidden; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 10px; box-shadow: var(--el-box-shadow-lighter); }
.asset-card h3 { margin: 12px 0 7px; }.asset-card p { height: 42px; overflow: hidden; color: var(--el-text-color-secondary); font-size: 12px; }.asset-card small { display: block; margin: 7px 0; color: var(--el-text-color-secondary); }.chart-badge { display: inline-block; padding: 2px 8px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); border-radius: 20px; font-size: 11px; }.screen-cover { height: 76px; margin: -18px -18px 0; padding: 12px; background: linear-gradient(135deg,#15223a,#245ea8); color: #fff; }
.editor { display: grid; grid-template-columns: 250px minmax(500px,1fr) 310px; height: calc(100vh - 154px); }.asset-panel,.property-panel { padding: 16px; overflow: auto; background: var(--el-bg-color); }.asset-panel { border-right: 1px solid var(--el-border-color-light); }.property-panel { border-left: 1px solid var(--el-border-color-light); }.asset-list { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }.drag-asset { display: flex; justify-content: space-between; padding: 10px; cursor: grab; border: 1px solid var(--el-border-color); border-radius: 6px; }.drag-asset span { color: var(--el-color-primary); font-size: 11px; }.full { width: 100%; }
.canvas-stage { display: grid; padding: 22px; overflow: auto; place-items: center; background: #d7dce4; }.canvas { position: relative; width: min(100%,1200px); aspect-ratio: 16/9; overflow: hidden; box-shadow: 0 12px 35px #0004; }.drop-hint { display: grid; height: 100%; place-items: center; color: #94a3b8; }.canvas-widget { position: absolute; display: flex; flex-direction: column; overflow: hidden; color: #dbeafe; background: #101b2dcc; border: 1px solid #30435f; border-radius: 5px; }.canvas-widget.selected { outline: 2px solid #409eff; }.canvas-widget header { display: flex; flex: 0 0 32px; align-items: center; justify-content: space-between; padding: 0 10px; cursor: move; background: #16243a; font-size: 12px; }.canvas-widget header i { color: #64748b; font-style: normal; }.widget-body { flex: 1; min-height: 0; padding: 5px; }.resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; background: linear-gradient(135deg,transparent 50%,#409eff 50%); border: 0; }
.property-panel h3,.asset-panel h3 { margin: 0 0 14px; }.property-panel :deep(.el-select),.chart-editor :deep(.el-select) { width: 100%; }.form-row { align-items: flex-start; }.form-row > * { flex: 1; }.dialog-preview { height: 300px; padding: 8px; border: 1px dashed var(--el-border-color); border-radius: 6px; }
@media (max-width: 1100px) { .editor { grid-template-columns: 210px minmax(420px,1fr) 270px; } }
</style>
