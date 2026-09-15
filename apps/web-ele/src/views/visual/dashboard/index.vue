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

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import ChartAppearanceEditor from './components/ChartAppearanceEditor.vue';

defineOptions({ name: 'VisualDashboardWorkbench' });

type WorkMode = 'charts' | 'editor' | 'screens';

const router = useRouter();
const route = useRoute();
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
const focusCanvas = ref(false);
const propertyTab = ref('appearance');
const contextMenu = reactive({ visible: false, x: 0, y: 0, widgetId: '' });

const screenForm = reactive({
  id: undefined as number | string | undefined,
  name: '未命名大屏',
  description: '',
  status: 'DRAFT',
  draftRevision: undefined as number | undefined,
  refreshMode: 'LIVE',
  refreshIntervalSeconds: 300,
});
const screenConfig = reactive<ScreenConfig>(emptyConfig());

const chartDialog = ref(false);
const chartEditorTab = ref('data');
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
/** 图表资产通过字符串存储规格，外观编辑器使用对象；只在边界做序列化转换。 */
const editableChartSpec = computed({
  get: () => parseSpec(chartForm.chartSpec),
  set: (spec: ChartSpec) => { chartForm.chartSpec = JSON.stringify(spec); },
});

const selectedWidget = computed(() =>
  screenConfig.widgets.find((item) => item.id === selectedWidgetId.value),
);
/** 统计每个图表资产在当前画布中的使用次数，允许复用但必须给用户明确反馈。 */
const usedChartCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const widget of screenConfig.widgets) {
    if (widget.chartId == null) continue;
    const key = String(widget.chartId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
});
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

/** 兼容历史接口可能返回的 id、ID 或 screenId，入口处统一为稳定字符串。 */
function screenIdOf(value: any): string {
  const raw = typeof value === 'object' && value !== null
    ? (value.id ?? value.ID ?? value.screenId)
    : value;
  return raw == null || String(raw).trim() === '' ? '' : String(raw);
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
    charts.value = unwrap<ChartAsset[]>(chartRes, []).map((item: any) => ({
      ...item,
      id: item.id ?? item.ID ?? item.chartId,
    }));
    screens.value = unwrap<any[]>(screenRes, []).map((item: any) => ({
      ...item,
      id: screenIdOf(item),
    }));
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
    // 修改字段映射时保留 appearance、optionOverrides，避免保存把外观配置静默丢掉。
    ...parseSpec(chartForm.chartSpec),
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
  chartEditorTab.value = 'data';
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
  Object.assign(screenForm, { id: undefined, name: '未命名大屏', description: '', status: 'DRAFT', draftRevision: undefined, refreshMode: 'LIVE', refreshIntervalSeconds: 300 });
  Object.assign(screenConfig, emptyConfig());
  selectedWidgetId.value = '';
  Object.keys(results).forEach((key) => delete results[key]);
  dirty.value = false;
  mode.value = 'editor';
}

async function editScreen(value: any) {
  const id = screenIdOf(value);
  if (!id) {
    ElMessage.error('大屏 ID 缺失，请刷新列表后重试');
    return;
  }
  const detail: any = unwrap(await getScreen(id), {});
  Object.assign(screenForm, {
    id: detail.id, name: detail.name, description: detail.description || '',
    status: detail.status || 'DRAFT',
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

type PointerMode = 'east' | 'move' | 'south' | 'southeast';

/**
 * 统一处理组件移动及右、下、右下三个方向的缩放。
 * 坐标始终换算回逻辑画布尺寸，发布查看页因此能严格复现编辑比例。
 */
function beginPointer(event: PointerEvent, widget: ScreenWidget, pointerMode: PointerMode = 'move') {
  event.preventDefault();
  event.stopPropagation();
  selectWidget(widget);
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  const scale = (canvasRef.value?.getBoundingClientRect().width || screenConfig.width) / screenConfig.width;
  const move = (moveEvent: PointerEvent) => {
    const dx = Math.round((moveEvent.clientX - startX) / scale);
    const dy = Math.round((moveEvent.clientY - startY) / scale);
    if (pointerMode === 'move') {
      widget.x = Math.max(0, Math.min(screenConfig.width - widget.w, initial.x + dx));
      widget.y = Math.max(0, Math.min(screenConfig.height - widget.h, initial.y + dy));
    } else {
      if (pointerMode === 'east' || pointerMode === 'southeast') {
        widget.w = Math.max(160, Math.min(screenConfig.width - widget.x, initial.w + dx));
      }
      if (pointerMode === 'south' || pointerMode === 'southeast') {
        widget.h = Math.max(110, Math.min(screenConfig.height - widget.y, initial.h + dy));
      }
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

/** 打开画布组件右键菜单，并把右键目标同步为当前选中组件。 */
function openWidgetContextMenu(event: MouseEvent, widget: ScreenWidget) {
  event.preventDefault();
  event.stopPropagation();
  selectWidget(widget);
  Object.assign(contextMenu, {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - 150),
    y: Math.min(event.clientY, window.innerHeight - 56),
    widgetId: widget.id,
  });
}

/** 删除指定画布组件；右键菜单和属性面板共用，避免两套删除逻辑不一致。 */
function removeWidget(widgetId: string) {
  const index = screenConfig.widgets.findIndex((item) => item.id === widgetId);
  if (index < 0) return;
  screenConfig.widgets.splice(index, 1);
  delete results[widgetId];
  if (selectedWidgetId.value === widgetId) selectedWidgetId.value = '';
  contextMenu.visible = false;
  dirty.value = true;
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
  removeWidget(selectedWidgetId.value);
}

/**
 * 选中画布组件后可按 Delete 删除。
 * 输入框、文本域、可编辑区域和图表编辑弹窗中不响应，避免正常编辑内容时误删组件。
 */
function onWorkbenchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete' || mode.value !== 'editor' || chartDialog.value || !selectedWidgetId.value) return;
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName.toLowerCase();
    // option 弹窗挂载到 body，不在画布 DOM 内；弹窗中任何控件都不应触发画布删除。
    if (target.closest('[role="dialog"], .el-dialog') || target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') return;
  }
  event.preventDefault();
  removeSelectedWidget();
}

async function saveDraft(showMessage = true) {
  const detail: any = unwrap(await saveScreenDraft({ ...screenForm, config: screenConfig }), {});
  const savedId = screenIdOf(detail);
  if (!savedId) throw new Error('草稿保存接口未返回大屏 ID');
  screenForm.id = savedId;
  screenForm.draftRevision = detail.draftRevision;
  screenForm.status = detail.status || screenForm.status;
  dirty.value = false;
  if (showMessage) ElMessage.success('草稿已保存');
  return detail;
}

async function previewAll() {
  const bundle: any = unwrap(await previewScreen(screenConfig), {});
  // 后台对相同 SQL 去重，datasets 的键未必是组件 ID，按 widgetData 映射回画布。
  for (const widget of screenConfig.widgets) {
    const key = bundle.widgetData?.[widget.id] || widget.id;
    if (bundle.datasets?.[key]) results[widget.id] = bundle.datasets[key];
  }
  ElMessage.success(`已刷新 ${Object.keys(bundle.datasets || {}).length} 个图表`);
}

async function publish() {
  await saveDraft(false);
  await publishScreen(screenForm.id!);
  screenForm.status = 'PUBLISHED';
  ElMessage.success('发布成功，查看页已切换到新版本');
  await loadAll();
}

function viewScreen(value: any) {
  const id = screenIdOf(value);
  if (!id) {
    ElMessage.error('大屏 ID 缺失，无法打开查看页，请刷新列表后重试');
    return;
  }
  // 查看路由是静态路径，大屏 ID 统一放入 query，避免将 ID 拼入 pathname 后无法匹配路由。
  const target = router.resolve({
    path: '/visual/dashboard/view',
    query: { screenId: id },
  });
  window.open(target.href, '_blank', 'noopener');
}

async function manualRefresh(value: any) {
  const resolvedId = screenIdOf(value);
  if (!resolvedId) {
    ElMessage.error('大屏 ID 缺失，无法刷新');
    return;
  }
  await refreshScreen(resolvedId);
  ElMessage.success('数据刷新成功');
  await loadAll();
}

async function removeScreen(row: any) {
  const id = screenIdOf(row);
  if (!id) {
    ElMessage.error('大屏 ID 缺失，无法删除');
    return;
  }
  await ElMessageBox.confirm(`确定删除大屏“${row.name}”吗？`, '删除大屏', { type: 'warning' });
  await deleteScreen(id);
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

watch(() => route.query.tab, (tab) => {
  if (tab === 'charts' && mode.value !== 'editor') mode.value = 'charts';
}, { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', onWorkbenchKeydown);
  void loadAll();
  void loadConnections();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onWorkbenchKeydown));
// 字段映射改变后只重绘现有预览，不重复执行 SQL。
watch(chartSpecForm, fillChartSpec, { deep: true });
</script>

<template>
  <div class="workbench" v-loading="loading" @click="contextMenu.visible = false">
    <header class="topbar" :class="{ compact: mode === 'editor' }">
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
        <ElButton @click="focusCanvas = !focusCanvas">{{ focusCanvas ? '显示侧栏' : '专注画布' }}</ElButton>
        <ElButton @click="leaveEditor">返回列表</ElButton>
        <ElButton @click="previewAll">刷新预览</ElButton>
        <ElButton @click="saveDraft()">保存草稿</ElButton>
        <ElButton :disabled="!screenForm.id || screenForm.status !== 'PUBLISHED'" @click="viewScreen(screenForm)">查看大屏</ElButton>
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
            <ElButton size="small" type="primary" @click="editScreen(row)">编辑</ElButton>
            <ElButton size="small" :disabled="row.status !== 'PUBLISHED'" @click="viewScreen(row)">查看</ElButton>
            <ElButton size="small" :disabled="row.status !== 'PUBLISHED'" @click="manualRefresh(row)">刷新数据</ElButton>
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

    <main v-else class="editor" :class="{ 'focus-canvas': focusCanvas }">
      <aside v-show="!focusCanvas" class="asset-panel">
        <h3>图表资产</h3>
        <ElInput v-model="chartKeyword" size="small" clearable placeholder="搜索，拖入画布" />
        <div class="asset-list">
          <div v-for="asset in filteredCharts" :key="asset.id" class="drag-asset"
            :class="{ used: usedChartCounts.has(String(asset.id)) }" draggable="true"
            @dragstart="startAssetDrag($event, asset)" @dblclick="addChart(asset)">
            <div><b>{{ asset.title }}</b><small v-if="usedChartCounts.has(String(asset.id))">画布中已使用 {{ usedChartCounts.get(String(asset.id)) }} 次</small></div>
            <span>{{ parseSpec(asset.chartSpec).chartType }}</span>
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
            @click.stop="selectWidget(widget)" @contextmenu="openWidgetContextMenu($event, widget)">
            <header v-if="widget.chartSpec.appearance?.showTitle !== false" @pointerdown="beginPointer($event, widget)"><span>{{ widget.title }}</span><i>拖动</i></header>
            <button v-else-if="selectedWidgetId === widget.id" class="widget-move-handle" @pointerdown="beginPointer($event, widget)">拖动</button>
            <div class="widget-body"><ChartRenderer :spec="widget.chartSpec" :result="results[widget.id]" /></div>
            <button class="resize-handle east" title="向右调整宽度" @pointerdown="beginPointer($event, widget, 'east')" />
            <button class="resize-handle south" title="向下调整高度" @pointerdown="beginPointer($event, widget, 'south')" />
            <button class="resize-handle southeast" title="拖动调整宽高" @pointerdown="beginPointer($event, widget, 'southeast')" />
          </article>
        </div>
      </section>

      <aside v-show="!focusCanvas" class="property-panel">
        <template v-if="selectedWidget">
          <div class="panel-title"><h3>图表设置</h3><ElButton type="danger" text @click="removeSelectedWidget">移除</ElButton></div>
          <ElForm label-position="top" size="small">
            <ElFormItem label="标题"><ElInput v-model="selectedWidget.title" @input="dirty = true" /></ElFormItem>
            <div class="layout-fields">
              <ElFormItem label="X"><ElInputNumber v-model="selectedWidget.x" :min="0" :max="screenConfig.width - selectedWidget.w" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem label="Y"><ElInputNumber v-model="selectedWidget.y" :min="0" :max="screenConfig.height - selectedWidget.h" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem label="宽"><ElInputNumber v-model="selectedWidget.w" :min="160" :max="screenConfig.width - selectedWidget.x" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem label="高"><ElInputNumber v-model="selectedWidget.h" :min="110" :max="screenConfig.height - selectedWidget.y" controls-position="right" @change="dirty = true" /></ElFormItem>
            </div>
            <ElTabs v-model="propertyTab">
              <ElTabPane label="外观与 option" name="appearance">
                <ChartAppearanceEditor :key="selectedWidget.id" :spec="selectedWidget.chartSpec" :result="results[selectedWidget.id]"
                  :preview-width="selectedWidget.w" :preview-height="selectedWidget.h"
                  @update:spec="selectedWidget.chartSpec = $event; dirty = true" />
              </ElTabPane>
              <ElTabPane label="数据与字段" name="data">
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
              </ElTabPane>
            </ElTabs>
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

    <div v-if="contextMenu.visible" class="widget-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button @click="removeWidget(contextMenu.widgetId)">删除组件</button>
    </div>

    <ElDialog v-model="chartDialog" title="图表编辑器" width="min(1100px, 94vw)" destroy-on-close>
      <div class="chart-editor">
        <ElTabs v-model="chartEditorTab">
          <ElTabPane label="数据与字段" name="data">
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
          </ElTabPane>
          <ElTabPane label="外观与 option" name="appearance">
            <ElForm label-position="top"><ChartAppearanceEditor v-model:spec="editableChartSpec" :result="chartPreview" /></ElForm>
          </ElTabPane>
        </ElTabs>
        <div class="dialog-preview"><ChartRenderer v-if="chartPreview" :spec="parseSpec(chartForm.chartSpec)" :result="chartPreview" /><ElEmpty v-else description="点击预览验证 SQL 和字段" /></div>
      </div>
      <template #footer><ElButton @click="doPreviewChart">运行预览</ElButton><ElButton type="primary" :loading="chartSaving" @click="doSaveChart">保存图表</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
.workbench { min-height: calc(100vh - 92px); background: var(--el-bg-color-page); color: var(--el-text-color-primary); }
.topbar { display: flex; min-height: 68px; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.topbar.compact { min-height: 54px; padding-block: 6px; }.topbar.compact p { display: none; }.topbar.compact h2 { font-size: 17px; }
.topbar h2,.topbar p,.asset-card h3,.asset-card p { margin: 0; }.topbar p { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 13px; }
.top-actions,.card-actions,.library-head,.panel-title,.form-row { display: flex; align-items: center; gap: 8px; }.top-actions :deep(.el-button + .el-button),.card-actions :deep(.el-button + .el-button) { margin-left: 0; }.save-state { color: var(--el-text-color-secondary); font-size: 12px; }
.library { padding: 22px; }.library-head { justify-content: space-between; margin-bottom: 18px; }.search { max-width: 320px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; }.asset-card { position: relative; padding: 18px; min-height: 140px; overflow: hidden; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 10px; box-shadow: var(--el-box-shadow-lighter); }
.asset-card h3 { margin: 12px 0 7px; }.asset-card p { height: 42px; overflow: hidden; color: var(--el-text-color-secondary); font-size: 12px; }.asset-card small { display: block; margin: 7px 0; color: var(--el-text-color-secondary); }.chart-badge { display: inline-block; padding: 2px 8px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); border-radius: 20px; font-size: 11px; }.screen-cover { height: 76px; margin: -18px -18px 0; padding: 12px; background: linear-gradient(135deg,#15223a,#245ea8); color: #fff; }
.screen-card .card-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); margin-top: 10px; }.screen-card .card-actions :deep(.el-button) { width: 100%; margin: 0; }
.editor { display: grid; grid-template-columns: 210px minmax(0,1fr) 286px; height: calc(100dvh - 126px); min-height: 560px; }.editor.focus-canvas { grid-template-columns: minmax(0,1fr); }.asset-panel,.property-panel { padding: 12px; overflow: auto; background: var(--el-bg-color); }.asset-panel { border-right: 1px solid var(--el-border-color-light); }.property-panel { border-left: 1px solid var(--el-border-color-light); }.asset-list { display: flex; flex-direction: column; gap: 7px; margin: 10px 0; }.drag-asset { display: flex; min-height: 43px; align-items: center; justify-content: space-between; padding: 7px 9px; cursor: grab; border: 1px solid var(--el-border-color); border-radius: 6px; }.drag-asset.used { border-color: var(--el-color-success); background: var(--el-color-success-light-9); }.drag-asset div { min-width: 0; }.drag-asset b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.drag-asset small { display: block; margin-top: 2px; color: var(--el-color-success); font-size: 10px; }.drag-asset span { flex: 0 0 auto; margin-left: 6px; color: var(--el-color-primary); font-size: 11px; }.full { width: 100%; }
.canvas-stage { display: grid; padding: 6px; overflow: auto; place-items: center; background: #cbd2dc; }.canvas { position: relative; width: min(100%,calc((100dvh - 142px) * 1.7778)); aspect-ratio: 16/9; overflow: hidden; box-shadow: 0 5px 18px #0005; }.drop-hint { display: grid; height: 100%; place-items: center; color: #94a3b8; }.canvas-widget { position: absolute; display: flex; flex-direction: column; overflow: hidden; color: #dbeafe; touch-action: none; user-select: none; background: #101b2dcc; border: 1px solid #30435f; border-radius: 5px; }.canvas-widget.selected { z-index: 2; outline: 2px solid #409eff; outline-offset: -1px; }.canvas-widget header { display: flex; flex: 0 0 30px; align-items: center; justify-content: space-between; padding: 0 9px; cursor: move; touch-action: none; background: #16243a; font-size: 12px; }.canvas-widget header i { color: #64748b; font-style: normal; }.widget-body { flex: 1; min-height: 0; padding: 4px; }.resize-handle { position: absolute; z-index: 4; padding: 0; touch-action: none; background: transparent; border: 0; }.resize-handle.east { top: 25%; right: -1px; width: 8px; height: 50%; cursor: ew-resize; border-right: 3px solid #409eff; }.resize-handle.south { bottom: -1px; left: 25%; width: 50%; height: 8px; cursor: ns-resize; border-bottom: 3px solid #409eff; }.resize-handle.southeast { right: 0; bottom: 0; width: 24px; height: 24px; cursor: nwse-resize; background: linear-gradient(135deg,transparent 52%,#409eff 53%); }
.property-panel h3,.asset-panel h3 { margin: 0 0 10px; }.property-panel :deep(.el-select),.chart-editor :deep(.el-select) { width: 100%; }.form-row { align-items: flex-start; }.form-row > * { flex: 1; }.layout-fields { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 5px; }.layout-fields :deep(.el-input-number) { width: 100%; }.dialog-preview { height: 300px; padding: 8px; border: 1px dashed var(--el-border-color); border-radius: 6px; }
.widget-context-menu { position: fixed; z-index: 4000; min-width: 136px; padding: 5px; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color); border-radius: 6px; box-shadow: var(--el-box-shadow-light); }.widget-context-menu button { width: 100%; padding: 7px 10px; color: var(--el-color-danger); text-align: left; cursor: pointer; background: transparent; border: 0; border-radius: 4px; }.widget-context-menu button:hover { background: var(--el-color-danger-light-9); }
.widget-move-handle { position: absolute; top: 3px; right: 3px; z-index: 3; padding: 2px 8px; cursor: move; color: #dbeafe; background: #16243acc; border: 1px solid #409eff; border-radius: 4px; font-size: 11px; }
.chart-editor { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: 18px; max-height: 65vh; overflow: auto; }.chart-editor > * { min-width: 0; }.chart-editor .form-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }.chart-editor .dialog-preview { position: sticky; top: 10px; margin-top: 40px; background: #101b2d; }
@media (max-width: 760px) { .chart-editor { grid-template-columns: minmax(0,1fr); }.chart-editor .dialog-preview { position: static; margin-top: 0; } }
@media (max-width: 1100px) { .editor { grid-template-columns: 180px minmax(390px,1fr) 250px; }.top-actions { flex-wrap: wrap; justify-content: flex-end; } }
</style>
