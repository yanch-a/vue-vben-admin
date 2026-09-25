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
import { resolveBackendAssetUrl } from '#/config';
import LemonUpload from '#/components/lemon-upload/index.vue';

import ChartRenderer from './components/ChartRenderer.vue';
import ChartAppearanceEditor from './components/ChartAppearanceEditor.vue';
import {
  alignWidgets,
  CANVAS_PRESETS,
  defaultWidgetSize,
  finiteNumber,
  normalizeScreenWidgets,
  normalizeWidgetLayout,
  snapValue,
  type AlignMode,
} from './assemblyTools';
import { CHART_TYPE_OPTIONS, getFieldMappingHint } from './fieldMappingHints';

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
const lastSavedAt = ref('');
const clipboardWidget = ref<ScreenWidget | null>(null);
const draftPreviewVisible = ref(false);
const draftPreviewResults = reactive<Record<string, QueryResult>>({});

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
  textContent: '', valueFormat: 'number', stack: false, sortBy: '', sortOrder: 'asc',
  fontSize: 24 as number | undefined,
});
/** 图表资产通过字符串存储规格，外观编辑器使用对象；只在边界做序列化转换。 */
const editableChartSpec = computed({
  get: () => parseSpec(chartForm.chartSpec),
  set: (spec: ChartSpec) => { chartForm.chartSpec = JSON.stringify(spec); },
});
const selectedWidget = computed(() =>
  screenConfig.widgets.find((item) => item.id === selectedWidgetId.value),
);
/** 当前编辑中的图表类型对应的 SQL/字段映射说明。 */
const chartFieldHint = computed(() => getFieldMappingHint(chartSpecForm.chartType));
const widgetFieldHint = computed(() =>
  selectedWidget.value
    ? getFieldMappingHint(selectedWidget.value.chartSpec.chartType)
    : getFieldMappingHint('bar'),
);
const isTextChartForm = computed(() => chartSpecForm.chartType === 'text');
const isStaticChartForm = computed(() => ['text', 'clock', 'image', 'iframe'].includes(chartSpecForm.chartType));
const isTextWidget = computed(() => selectedWidget.value?.chartSpec.chartType === 'text');
const isStaticWidget = computed(() => ['text', 'clock', 'image', 'iframe'].includes(selectedWidget.value?.chartSpec.chartType || ''));
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
  return {
    schemaVersion: 1,
    width: 1200,
    height: 675,
    background: '#0b1220',
    backgroundImage: '',
    showGrid: true,
    gridSize: 10,
    widgets: [],
  };
}

function formatSavedAt(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function applyCanvasPreset(width: number, height: number) {
  screenConfig.width = width;
  screenConfig.height = height;
  dirty.value = true;
}

function snap(value: number) {
  return snapValue(value, screenConfig.gridSize || 10, Boolean(screenConfig.showGrid));
}

/** 画布背景：颜色 + 可选背景图（cover 铺满）。 */
function canvasBackgroundStyle(config: ScreenConfig = screenConfig) {
  const style: Record<string, string> = {
    backgroundColor: config.background || '#0b1220',
  };
  const image = resolveBackendAssetUrl(config.backgroundImage);
  if (image) {
    style.backgroundImage = `url("${image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center center';
    style.backgroundRepeat = 'no-repeat';
  }
  return style;
}

/** 背景图上传或清除后同步写入配置并标记未保存。 */
function onBackgroundImageChange(value: string) {
  screenConfig.backgroundImage = value || '';
  dirty.value = true;
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
    return {
      ...defaultSpec(),
      ...parsed,
      yFields: Array.isArray(parsed.yFields) ? parsed.yFields : [],
      textContent: parsed.textContent,
    };
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
  const prev = parseSpec(chartForm.chartSpec);
  const isText = chartSpecForm.chartType === 'text';
  const isStatic = ['text', 'clock', 'image', 'iframe'].includes(chartSpecForm.chartType);
  chartForm.chartSpec = JSON.stringify({
    // 修改字段映射时保留 appearance、optionOverrides，避免保存把外观配置静默丢掉。
    ...prev,
    chartType: chartSpecForm.chartType,
    xField: isStatic ? undefined : (chartSpecForm.xField.trim() || undefined),
    yFields: isStatic
      ? []
      : chartSpecForm.yFields.split(',').map((item) => item.trim()).filter(Boolean),
    seriesField: isStatic ? undefined : (chartSpecForm.seriesField.trim() || undefined),
    textContent: isText ? chartSpecForm.textContent : prev.textContent,
    mediaUrl: prev.mediaUrl,
    valueFormat: chartSpecForm.valueFormat,
    stack: chartSpecForm.stack,
    sortBy: isText ? undefined : (chartSpecForm.sortBy.trim() || undefined),
    sortOrder: chartSpecForm.sortOrder,
    appearance: {
      ...prev.appearance,
      ...(isText && chartSpecForm.fontSize
        ? { fontSize: chartSpecForm.fontSize }
        : {}),
    },
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
    seriesField: spec.seriesField || '', textContent: spec.textContent || '',
    valueFormat: spec.valueFormat || 'number', stack: Boolean(spec.stack),
    sortBy: spec.sortBy || '', sortOrder: spec.sortOrder || 'asc',
    fontSize: spec.appearance?.fontSize || 24,
  });
  chartPreview.value = undefined;
  chartEditorTab.value = 'data';
  chartDialog.value = true;
  if (chartForm.dbConfigId) await changeConnection();
  if (asset?.instanceName) chartForm.instanceName = asset.instanceName;
}

async function doPreviewChart() {
  fillChartSpec();
  if (['text', 'clock', 'image', 'iframe'].includes(chartSpecForm.chartType)) {
    chartPreview.value = { columns: [], rows: [], rowCount: 0 };
    return;
  }
  chartPreview.value = unwrap(await previewChart(chartForm), undefined as any);
}

async function doSaveChart() {
  fillChartSpec();
  if (chartSpecForm.chartType === 'text' && !chartSpecForm.textContent.trim()) {
    ElMessage.warning('请填写文本内容');
    return;
  }
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
  const loaded = detail.config || {};
  Object.assign(screenConfig, emptyConfig(), loaded, {
    showGrid: loaded.showGrid ?? true,
    gridSize: loaded.gridSize || 10,
    width: loaded.width || 1200,
    height: loaded.height || 675,
    widgets: normalizeScreenWidgets(loaded.widgets || []),
  });
  selectedWidgetId.value = '';
  Object.keys(results).forEach((key) => delete results[key]);
  dirty.value = false;
  mode.value = 'editor';
}

function assetToWidget(asset: ChartAsset, x?: number, y?: number): ScreenWidget {
  const spec = parseSpec(asset.chartSpec);
  const isStatic = ['text', 'clock', 'image', 'iframe'].includes(spec.chartType);
  const size = defaultWidgetSize(spec.chartType);
  const widget: ScreenWidget = {
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    chartId: asset.id,
    title: asset.title,
    chartSpec: spec,
    data: {
      dbConfigId: asset.dbConfigId, instanceName: asset.instanceName,
      sqlText: isStatic ? (asset.sqlText?.trim() ? asset.sqlText : 'SELECT 1 AS _static') : asset.sqlText,
      maxRows: asset.maxRows || 2000, timeoutSeconds: asset.timeoutSeconds || 30,
    },
    x: 30, y: 30, w: size.w, h: size.h,
  };
  // 显式传入的坐标可能来自拖放；点击按钮时不要把 MouseEvent 当成 x。
  return normalizeWidgetLayout(widget, { x, y, w: size.w, h: size.h });
}

/** 在画布上直接放置一个文本组件，无需 SQL。 */
function addTextWidget(x?: number, y?: number) {
  const size = defaultWidgetSize('text');
  const widget = normalizeWidgetLayout({
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '文本',
    chartSpec: {
      chartType: 'text',
      yFields: [],
      textContent: '文本标题',
      appearance: { fontSize: 28, showTitle: false, colors: ['#e2e8f0'] },
    },
    data: { sqlText: 'SELECT 1 AS _static', maxRows: 1, timeoutSeconds: 5 },
    x: 40, y: 24, w: size.w, h: size.h,
  } as ScreenWidget, { x, y, w: size.w, h: size.h });
  screenConfig.widgets.push(widget);
  selectedWidgetId.value = widget.id;
  propertyTab.value = 'data';
  dirty.value = true;
}

/** 将组件放到图层栈顶（数组末尾 = 最高 zIndex）。 */
function bringWidgetToFront(widgetId: string) {
  const index = screenConfig.widgets.findIndex((item) => item.id === widgetId);
  if (index < 0 || index === screenConfig.widgets.length - 1) return;
  const [item] = screenConfig.widgets.splice(index, 1);
  if (item) screenConfig.widgets.push(item);
}

function pushStaticWidget(widget: ScreenWidget) {
  normalizeWidgetLayout(widget);
  screenConfig.widgets.push(widget);
  selectedWidgetId.value = widget.id;
  propertyTab.value = 'data';
  dirty.value = true;
}

function addClockWidget(x?: number, y?: number) {
  const size = defaultWidgetSize('clock');
  pushStaticWidget(normalizeWidgetLayout({
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '时钟',
    chartSpec: {
      chartType: 'clock',
      yFields: [],
      appearance: { fontSize: 36, showTitle: false, colors: ['#e2e8f0'] },
    },
    data: { sqlText: 'SELECT 1 AS _static', maxRows: 1, timeoutSeconds: 5 },
    x: 40, y: 24, w: size.w, h: size.h,
  } as ScreenWidget, { x, y, w: size.w, h: size.h }));
}

function addImageWidget(x?: number, y?: number) {
  const size = defaultWidgetSize('image');
  pushStaticWidget(normalizeWidgetLayout({
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '图片',
    chartSpec: {
      chartType: 'image',
      yFields: [],
      mediaUrl: '',
      appearance: { showTitle: false },
    },
    data: { sqlText: 'SELECT 1 AS _static', maxRows: 1, timeoutSeconds: 5 },
    x: 40, y: 80, w: size.w, h: size.h,
  } as ScreenWidget, { x, y, w: size.w, h: size.h }));
}

function addIframeWidget(x?: number, y?: number) {
  const size = defaultWidgetSize('iframe');
  pushStaticWidget(normalizeWidgetLayout({
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '网页',
    chartSpec: {
      chartType: 'iframe',
      yFields: [],
      mediaUrl: '',
      appearance: { showTitle: true },
    },
    data: { sqlText: 'SELECT 1 AS _static', maxRows: 1, timeoutSeconds: 5 },
    x: 40, y: 80, w: size.w, h: size.h,
  } as ScreenWidget, { x, y, w: size.w, h: size.h }));
}

async function addChart(asset: ChartAsset, x?: number, y?: number) {
  const widget = assetToWidget(asset, x, y);
  normalizeWidgetLayout(widget);
  screenConfig.widgets.push(widget);
  selectedWidgetId.value = widget.id;
  dirty.value = true;
  if (widget.chartSpec.chartType === 'text') return;
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
  const scaleX = rect.width / screenConfig.width;
  const scaleY = rect.height / screenConfig.height;
  void addChart(asset,
    Math.max(0, Math.round((event.clientX - rect.left) / scaleX - 210)),
    Math.max(0, Math.round((event.clientY - rect.top) / scaleY - 30)));
}

function widgetStyle(widget: ScreenWidget) {
  normalizeWidgetLayout(widget);
  const index = screenConfig.widgets.findIndex((item) => item.id === widget.id);
  const baseZ = index >= 0 ? index + 1 : 1;
  // 选中时额外抬升 zIndex；selectWidget 会把组件挪到数组末尾持久化顶层。
  const selectedBoost = selectedWidgetId.value === widget.id ? 1000 : 0;
  return {
    left: `${(widget.x / screenConfig.width) * 100}%`,
    top: `${(widget.y / screenConfig.height) * 100}%`,
    width: `${(widget.w / screenConfig.width) * 100}%`,
    height: `${(widget.h / screenConfig.height) * 100}%`,
    zIndex: baseZ + selectedBoost,
  };
}

type PointerMode = 'east' | 'move' | 'south' | 'southeast';

/** 文本组件允许更小区域；普通图表仍保留可操作的最小宽高。 */
function widgetMinSize(widget: ScreenWidget) {
  const type = widget.chartSpec.chartType;
  if (type === 'text' || type === 'clock') return { w: 40, h: 24 };
  if (type === 'image' || type === 'iframe') return { w: 120, h: 80 };
  return { w: 160, h: 110 };
}

/**
 * 统一处理组件移动及右、下、右下三个方向的缩放。
 * 坐标始终换算回逻辑画布尺寸，发布查看页因此能严格复现编辑比例。
 */
function beginPointer(event: PointerEvent, widget: ScreenWidget, pointerMode: PointerMode = 'move') {
  event.preventDefault();
  event.stopPropagation();
  selectWidget(widget);
  if (widget.locked) return;
  // 忽略来自输入框等可编辑控件的拖拽，避免抢焦点。
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, .el-input, .el-textarea, .el-select')) return;

  // 拖拽/缩放前强制有限坐标，避免旧稿缺字段或属性面板清空导致单轴冻结。
  normalizeWidgetLayout(widget);
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = {
    x: finiteNumber(widget.x, 0),
    y: finiteNumber(widget.y, 0),
    w: finiteNumber(widget.w, defaultWidgetSize(widget.chartSpec.chartType).w),
    h: finiteNumber(widget.h, defaultWidgetSize(widget.chartSpec.chartType).h),
  };
  const minSize = widgetMinSize(widget);
  const rect = canvasRef.value?.getBoundingClientRect();
  // 宽高分别换算：画布 CSS 比例与逻辑尺寸不一致时，纵轴不能再用 width scale。
  const scaleX = (rect?.width || screenConfig.width) / screenConfig.width;
  const scaleY = (rect?.height || screenConfig.height) / screenConfig.height;
  const maxX = Math.max(0, screenConfig.width - initial.w);
  const maxY = Math.max(0, screenConfig.height - initial.h);

  try {
    target?.setPointerCapture?.(event.pointerId);
  } catch {
    /* 部分浏览器在 button 上 setPointerCapture 可能失败，忽略即可 */
  }

  const move = (moveEvent: PointerEvent) => {
    const dx = Math.round((moveEvent.clientX - startX) / scaleX);
    const dy = Math.round((moveEvent.clientY - startY) / scaleY);
    if (pointerMode === 'move') {
      widget.x = snap(Math.max(0, Math.min(maxX, initial.x + dx)));
      // 允许贴顶：y 下限为 0；不再被错误纵轴比例「吸」在半空。
      widget.y = snap(Math.max(0, Math.min(maxY, initial.y + dy)));
    } else {
      if (pointerMode === 'east' || pointerMode === 'southeast') {
        widget.w = snap(Math.max(minSize.w, Math.min(screenConfig.width - widget.x, initial.w + dx)));
      }
      if (pointerMode === 'south' || pointerMode === 'southeast') {
        widget.h = snap(Math.max(minSize.h, Math.min(screenConfig.height - widget.y, initial.h + dy)));
      }
    }
    dirty.value = true;
  };
  const up = (upEvent: PointerEvent) => {
    try {
      target?.releasePointerCapture?.(upEvent.pointerId);
    } catch {
      /* ignore */
    }
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** 打开画布组件右键菜单，并把右键目标同步为当前选中组件。 */
function openWidgetContextMenu(event: MouseEvent, widget: ScreenWidget) {
  event.preventDefault();
  event.stopPropagation();
  selectWidget(widget);
  Object.assign(contextMenu, {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - 150),
    y: Math.min(event.clientY, window.innerHeight - 220),
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
  // 选中即置于顶层；右键/工具栏仍可精细调层。仅在顺序变化时标脏。
  const before = screenConfig.widgets.map((item) => item.id).join(',');
  bringWidgetToFront(widget.id);
  const after = screenConfig.widgets.map((item) => item.id).join(',');
  if (before !== after) dirty.value = true;
  if (!widget.data.dbConfigId) return;
  getInstances(widget.data.dbConfigId).then((response: any) => {
    const trees: any[] = unwrap(response, []);
    instances.value = (trees[0]?.instances || []).map((item: any) => item.instanceName).filter(Boolean);
  }).catch(() => { instances.value = []; });
}

/** 切换组件图表类型时，文本组件补齐默认文案并关闭标题栏。 */
function onWidgetChartTypeChange(type: string) {
  dirty.value = true;
  const widget = selectedWidget.value;
  if (!widget) return;
  if (type === 'text' || type === 'clock') {
    if (type === 'text') {
      widget.chartSpec.textContent =
        widget.chartSpec.textContent || widget.title || '文本内容';
    }
    widget.chartSpec.yFields = [];
    widget.chartSpec.appearance = {
      ...widget.chartSpec.appearance,
      showTitle: false,
      fontSize: widget.chartSpec.appearance?.fontSize || (type === 'clock' ? 36 : 24),
      colors: widget.chartSpec.appearance?.colors?.length
        ? widget.chartSpec.appearance.colors
        : ['#e2e8f0'],
    };
  }
  if (type === 'image' || type === 'iframe') {
    widget.chartSpec.yFields = [];
    widget.chartSpec.appearance = {
      ...widget.chartSpec.appearance,
      showTitle: type === 'iframe',
    };
  }
}

function removeSelectedWidget() {
  removeWidget(selectedWidgetId.value);
}

function duplicateWidget(widgetId = selectedWidgetId.value) {
  const source = screenConfig.widgets.find((item) => item.id === widgetId);
  if (!source) return;
  normalizeWidgetLayout(source);
  const clone: ScreenWidget = normalizeWidgetLayout({
    ...JSON.parse(JSON.stringify(source)),
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    x: Math.min(screenConfig.width - source.w, source.x + 24),
    y: Math.min(screenConfig.height - source.h, source.y + 24),
    locked: false,
  });
  screenConfig.widgets.push(clone);
  if (results[source.id]) results[clone.id] = results[source.id];
  selectedWidgetId.value = clone.id;
  contextMenu.visible = false;
  dirty.value = true;
}

function toggleLockWidget(widgetId = selectedWidgetId.value) {
  const widget = screenConfig.widgets.find((item) => item.id === widgetId);
  if (!widget) return;
  widget.locked = !widget.locked;
  contextMenu.visible = false;
  dirty.value = true;
}

function moveWidgetLayer(widgetId: string, direction: 'down' | 'top' | 'up' | 'bottom') {
  const index = screenConfig.widgets.findIndex((item) => item.id === widgetId);
  if (index < 0) return;
  const [item] = screenConfig.widgets.splice(index, 1);
  if (!item) return;
  if (direction === 'top') screenConfig.widgets.push(item);
  else if (direction === 'bottom') screenConfig.widgets.unshift(item);
  else if (direction === 'up') screenConfig.widgets.splice(Math.min(screenConfig.widgets.length, index + 1), 0, item);
  else screenConfig.widgets.splice(Math.max(0, index - 1), 0, item);
  contextMenu.visible = false;
  dirty.value = true;
}

function alignSelected(mode: AlignMode) {
  if (!selectedWidget.value) return;
  alignWidgets([selectedWidget.value], mode, screenConfig);
  dirty.value = true;
}

function copySelectedWidget() {
  if (!selectedWidget.value) return;
  clipboardWidget.value = JSON.parse(JSON.stringify(selectedWidget.value));
  ElMessage.success('已复制组件');
}

function pasteClipboardWidget() {
  if (!clipboardWidget.value) return;
  const source = normalizeWidgetLayout(clipboardWidget.value);
  const clone: ScreenWidget = normalizeWidgetLayout({
    ...JSON.parse(JSON.stringify(source)),
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    x: Math.min(screenConfig.width - source.w, source.x + 24),
    y: Math.min(screenConfig.height - source.h, source.y + 24),
    locked: false,
  });
  screenConfig.widgets.push(clone);
  selectedWidgetId.value = clone.id;
  dirty.value = true;
}

function selectWidgetFromLayer(widget: ScreenWidget) {
  selectWidget(widget);
  propertyTab.value = 'appearance';
}

/**
 * 选中画布组件后可按 Delete 删除。
 * 输入框、文本域、可编辑区域和图表编辑弹窗中不响应，避免正常编辑内容时误删组件。
 */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return Boolean(
    target.closest('[role="dialog"], .el-dialog') ||
      target.isContentEditable ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select',
  );
}

function onWorkbenchKeydown(event: KeyboardEvent) {
  if (mode.value !== 'editor' || chartDialog.value || draftPreviewVisible.value) return;
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'c' && selectedWidgetId.value) {
    event.preventDefault();
    copySelectedWidget();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'v') {
    event.preventDefault();
    pasteClipboardWidget();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'd' && selectedWidgetId.value) {
    event.preventDefault();
    duplicateWidget();
    return;
  }
  if (event.key !== 'Delete' || !selectedWidgetId.value) return;
  if (selectedWidget.value?.locked) {
    ElMessage.warning('组件已锁定，请先解锁再删除');
    return;
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
  lastSavedAt.value = formatSavedAt();
  if (showMessage) ElMessage.success('草稿已保存');
  return detail;
}

/** 草稿预览：不发布，按当前画布配置跑一遍数据后弹层查看。 */
async function previewDraft() {
  Object.keys(draftPreviewResults).forEach((key) => delete draftPreviewResults[key]);
  const dataWidgets = screenConfig.widgets.filter(
    (widget) => !['text', 'clock', 'image', 'iframe'].includes(widget.chartSpec.chartType),
  );
  if (dataWidgets.length) {
    try {
      const bundle: any = unwrap(
        await previewScreen(
          withPreviewSafeConfig({ ...screenConfig, widgets: dataWidgets }),
        ),
        {},
      );
      for (const widget of dataWidgets) {
        const key = bundle.widgetData?.[widget.id] || widget.id;
        if (bundle.datasets?.[key]) draftPreviewResults[widget.id] = bundle.datasets[key];
      }
    } catch (error: any) {
      ElMessage.warning(
        `图表数据预览失败，仍展示布局：${error?.msg || error?.message || '请检查数据源'}`,
      );
    }
  }
  draftPreviewVisible.value = true;
}


/** 静态组件无 SQL；预览接口仍可能校验 sqlText，提交前补占位避免误报。 */
function withPreviewSafeConfig(config: ScreenConfig): ScreenConfig {
  return {
    ...config,
    widgets: config.widgets.map((widget) => {
      const type = widget.chartSpec?.chartType;
      if (!['text', 'clock', 'image', 'iframe'].includes(type)) return widget;
      return {
        ...widget,
        data: {
          ...widget.data,
          sqlText: widget.data?.sqlText?.trim() ? widget.data.sqlText : 'SELECT 1 AS _static',
          maxRows: widget.data?.maxRows || 1,
          timeoutSeconds: widget.data?.timeoutSeconds || 5,
        },
      };
    }),
  };
}

async function previewAll() {
  const bundle: any = unwrap(await previewScreen(withPreviewSafeConfig(screenConfig)), {});
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
        <h2>{{ $tr('数据大屏工作台') }}</h2>
        <p>{{ $tr('图表资产、自由编排、发布与数据刷新都在这里完成') }}</p>
      </div>
      <div v-if="mode !== 'editor'" class="top-actions">
        <ElButton :type="mode === 'screens' ? 'primary' : ''" @click="mode = 'screens'">{{ $tr('我的大屏') }}</ElButton>
        <ElButton :type="mode === 'charts' ? 'primary' : ''" @click="mode = 'charts'">{{ $tr('图表库') }}</ElButton>
        <ElButton type="primary" @click="newScreen">{{ $tr('新建大屏') }}</ElButton>
      </div>
      <div v-else class="top-actions">
        <span class="save-state" :class="{ dirty }">
          {{ dirty ? $tr('有未保存修改') : (lastSavedAt ? ($tr('已保存') + ' ' + (lastSavedAt)) : $tr('已保存')) }}
        </span>
        <ElButton @click="focusCanvas = !focusCanvas">{{ focusCanvas ? $tr('显示侧栏') : $tr('专注画布') }}</ElButton>
        <ElButton @click="leaveEditor">{{ $tr('返回') }}</ElButton>
        <ElButton @click="previewAll">{{ $tr('刷新数据') }}</ElButton>
        <ElButton @click="previewDraft">{{ $tr('预览草稿') }}</ElButton>
        <ElButton @click="saveDraft()">{{ $tr('保存草稿') }}</ElButton>
        <ElButton :disabled="!screenForm.id || screenForm.status !== 'PUBLISHED'" @click="viewScreen(screenForm)">{{ $tr('正式查看') }}</ElButton>
        <ElButton type="primary" @click="publish">{{ $tr('保存并发布') }}</ElButton>
      </div>
    </header>

    <main v-if="mode === 'screens'" class="library">
      <div class="library-head">
        <ElInput v-model="screenKeyword" clearable :placeholder="$tr('搜索大屏')" class="search" />
        <span>{{ filteredScreens.length }} 个大屏</span>
      </div>
      <ElEmpty v-if="!filteredScreens.length" :description="$tr('还没有大屏，从新建大屏开始')" />
      <div v-else class="card-grid">
        <article v-for="row in filteredScreens" :key="row.id" class="asset-card screen-card">
          <div class="screen-cover"><span>{{ row.status === 'PUBLISHED' ? $tr('已发布') : $tr('草稿') }}</span></div>
          <h3>{{ row.name }}</h3><p>{{ row.description || $tr('暂无说明') }}</p>
          <small>{{ row.refreshMode === 'LIVE' ? '每次查看实时查询' : (`${row.refreshIntervalSeconds}s ` + $tr('更新快照')) }}</small>
          <div class="card-actions">
            <ElButton size="small" type="primary" @click="editScreen(row)">{{ $tr('编辑') }}</ElButton>
            <ElButton v-if="row.status === 'PUBLISHED'" size="small" @click="viewScreen(row)">{{ $tr('查看') }}</ElButton>
            <ElButton v-if="row.status === 'PUBLISHED'" size="small" @click="manualRefresh(row)">{{ $tr('刷新数据') }}</ElButton>
            <ElButton size="small" type="danger" text @click="removeScreen(row)">{{ $tr('删除') }}</ElButton>
          </div>
        </article>
      </div>
    </main>

    <main v-else-if="mode === 'charts'" class="library">
      <div class="library-head">
        <ElInput v-model="chartKeyword" clearable :placeholder="$tr('搜索图表')" class="search" />
        <ElButton type="primary" @click="openChartDialog()">{{ $tr('新建图表') }}</ElButton>
      </div>
      <ElEmpty v-if="!filteredCharts.length" :description="$tr('AI SQL 保存的图表和手工图表会出现在这里')" />
      <div v-else class="card-grid">
        <article v-for="asset in filteredCharts" :key="asset.id" class="asset-card">
          <div class="chart-badge">{{ parseSpec(asset.chartSpec).chartType.toUpperCase() }}</div>
          <h3>{{ asset.title }}</h3><p>{{ asset.description || asset.sqlText }}</p>
          <div class="card-actions">
            <ElButton size="small" type="primary" @click="openChartDialog(asset)">{{ $tr('编辑') }}</ElButton>
            <ElButton size="small" @click="newScreen(); addChart(asset)">{{ $tr('加入新大屏') }}</ElButton>
            <ElButton size="small" type="danger" text @click="removeChart(asset)">{{ $tr('删除') }}</ElButton>
          </div>
        </article>
      </div>
    </main>

    <main v-else class="editor" :class="{ 'focus-canvas': focusCanvas }">
      <aside v-show="!focusCanvas" class="asset-panel">
        <h3>{{ $tr('图表资产') }}</h3>
        <ElInput v-model="chartKeyword" size="small" clearable :placeholder="$tr('搜索，拖入画布')" />
        <div class="asset-list">
          <div v-for="asset in filteredCharts" :key="asset.id" class="drag-asset"
            :class="{ used: usedChartCounts.has(String(asset.id)) }" draggable="true"
            @dragstart="startAssetDrag($event, asset)" @dblclick="addChart(asset)">
            <div><b>{{ asset.title }}</b><small v-if="usedChartCounts.has(String(asset.id))">{{ $tr('画布中已使用') }} {{ usedChartCounts.get(String(asset.id))  }} {{ $tr('次') }}</small></div>
            <span>{{ parseSpec(asset.chartSpec).chartType }}</span>
          </div>
        </div>
        <div class="asset-actions">
          <ElButton class="full" type="primary" plain @click="openChartDialog()">{{ $tr('+ 新建图表') }}</ElButton>
          <div class="quick-widgets">
            <ElButton size="small" @click="() => addTextWidget()">{{ $tr('文本') }}</ElButton>
            <ElButton size="small" @click="() => addClockWidget()">{{ $tr('时钟') }}</ElButton>
            <ElButton size="small" @click="() => addImageWidget()">{{ $tr('图片') }}</ElButton>
            <ElButton size="small" @click="() => addIframeWidget()">{{ $tr('网页') }}</ElButton>
          </div>
        </div>
        <div v-if="screenConfig.widgets.length" class="layer-panel">
          <h4>{{ $tr('图层') }} <small>{{ $tr('上=顶层') }}</small></h4>
          <div
            v-for="widget in [...screenConfig.widgets].reverse()"
            :key="widget.id"
            class="layer-item"
            :class="{ active: selectedWidgetId === widget.id, locked: widget.locked }"
            @click="selectWidgetFromLayer(widget)"
          >
            <span>{{ widget.title || widget.chartSpec.chartType }}</span>
            <i>{{ widget.locked ? $tr('锁') : widget.chartSpec.chartType }}</i>
          </div>
        </div>
      </aside>

      <section class="canvas-stage" @click="selectedWidgetId = ''">
        <div class="canvas-toolbar" @click.stop>
          <div class="canvas-toolbar-group">
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('left')">{{ $tr('左齐') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('hcenter')">{{ $tr('水平居中') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('right')">{{ $tr('右齐') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('top')">{{ $tr('顶齐') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('vcenter')">{{ $tr('垂直居中') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="alignSelected('bottom')">{{ $tr('底齐') }}</ElButton>
          </div>
          <div class="canvas-toolbar-group">
            <ElButton size="small" :disabled="!selectedWidget" @click="duplicateWidget()">{{ $tr('复制') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="toggleLockWidget()">
              {{ selectedWidget?.locked ? $tr('解锁') : $tr('锁定') }}
            </ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="moveWidgetLayer(selectedWidgetId, 'top')">{{ $tr('置顶') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="moveWidgetLayer(selectedWidgetId, 'up')">{{ $tr('上移') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="moveWidgetLayer(selectedWidgetId, 'down')">{{ $tr('下移') }}</ElButton>
            <ElButton size="small" :disabled="!selectedWidget" @click="moveWidgetLayer(selectedWidgetId, 'bottom')">{{ $tr('置底') }}</ElButton>
            <ElSwitch v-model="screenConfig.showGrid" inline-prompt :active-text="$tr('网格')" :inactive-text="$tr('网格')" @change="dirty = true" />
          </div>
        </div>
        <div
          ref="canvasRef"
          class="canvas"
          :class="{ 'show-grid': screenConfig.showGrid }"
          :style="{
            ...canvasBackgroundStyle(),
            aspectRatio: `${screenConfig.width} / ${screenConfig.height}`,
            ['--canvas-w' as any]: String(screenConfig.width),
            ['--canvas-h' as any]: String(screenConfig.height),
            ['--grid-size' as any]: `${((screenConfig.gridSize || 10) / screenConfig.width) * 100}%`,
          }"
          @dragover.prevent
          @drop.prevent="dropAsset"
        >
          <div v-if="!screenConfig.widgets.length" class="drop-hint">
            <p>{{ $tr('从左侧拖入图表，或使用快捷组件开始组装') }}</p>
            <div class="drop-actions">
              <ElButton type="primary" @click.stop="() => addTextWidget()">{{ $tr('添加文本') }}</ElButton>
              <ElButton @click.stop="() => addClockWidget()">{{ $tr('添加时钟') }}</ElButton>
              <ElButton @click.stop="openChartDialog()">{{ $tr('新建图表') }}</ElButton>
            </div>
          </div>
          <article v-for="widget in screenConfig.widgets" :key="widget.id" class="canvas-widget"
            :class="{
              selected: selectedWidgetId === widget.id,
              locked: widget.locked,
              'text-widget-card': ['text', 'clock'].includes(widget.chartSpec.chartType),
              'media-widget-card': ['image', 'iframe'].includes(widget.chartSpec.chartType),
            }"
            :style="widgetStyle(widget)"
            @pointerdown="beginPointer($event, widget)"
            @click.stop="selectWidget(widget)" @contextmenu="openWidgetContextMenu($event, widget)">
            <header
              v-if="!['text', 'clock', 'image', 'iframe'].includes(widget.chartSpec.chartType) && widget.chartSpec.appearance?.showTitle !== false"
              @pointerdown="beginPointer($event, widget)"
            ><span>{{ widget.title }}</span><i>{{ widget.locked ? $tr('已锁定') : $tr('拖动') }}</i></header>
            <button
              v-else-if="selectedWidgetId === widget.id || ['text', 'clock', 'image', 'iframe'].includes(widget.chartSpec.chartType)"
              class="widget-move-handle"
              @pointerdown="beginPointer($event, widget)"
            >{{ widget.locked ? $tr('锁定') : $tr('拖动') }}</button>
            <div class="widget-body"><ChartRenderer :spec="widget.chartSpec" :result="results[widget.id]" /></div>
            <template v-if="!widget.locked">
              <button class="resize-handle east" :title="$tr('向右调整宽度')" @pointerdown="beginPointer($event, widget, 'east')" />
              <button class="resize-handle south" :title="$tr('向下调整高度')" @pointerdown="beginPointer($event, widget, 'south')" />
              <button class="resize-handle southeast" :title="$tr('拖动调整宽高')" @pointerdown="beginPointer($event, widget, 'southeast')" />
            </template>
          </article>
        </div>
      </section>

      <aside v-show="!focusCanvas" class="property-panel">
        <template v-if="selectedWidget">
          <div class="panel-title">
            <h3>{{ $tr('组件设置') }}</h3>
            <div class="panel-title-actions">
              <ElButton text @click="duplicateWidget()">{{ $tr('复制') }}</ElButton>
              <ElButton text @click="toggleLockWidget()">{{ selectedWidget.locked ? $tr('解锁') : $tr('锁定') }}</ElButton>
              <ElButton type="danger" text @click="removeSelectedWidget">{{ $tr('移除') }}</ElButton>
            </div>
          </div>
          <ElForm label-position="top" size="small">
            <ElFormItem :label="$tr('标题')"><ElInput v-model="selectedWidget.title" @input="dirty = true" /></ElFormItem>
            <div class="layout-fields">
              <ElFormItem label="X"><ElInputNumber v-model="selectedWidget.x" :min="0" :max="screenConfig.width - selectedWidget.w" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem label="Y"><ElInputNumber v-model="selectedWidget.y" :min="0" :max="screenConfig.height - selectedWidget.h" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem :label="$tr('宽')"><ElInputNumber v-model="selectedWidget.w" :min="widgetMinSize(selectedWidget).w" :max="screenConfig.width - selectedWidget.x" controls-position="right" @change="dirty = true" /></ElFormItem>
              <ElFormItem :label="$tr('高')"><ElInputNumber v-model="selectedWidget.h" :min="widgetMinSize(selectedWidget).h" :max="screenConfig.height - selectedWidget.y" controls-position="right" @change="dirty = true" /></ElFormItem>
            </div>
            <template v-if="selectedWidget.chartSpec.chartType === 'image' || selectedWidget.chartSpec.chartType === 'iframe'">
              <ElFormItem :label="selectedWidget.chartSpec.chartType === 'image' ? $tr('图片地址') : $tr('网页地址')">
                <ElInput
                  v-model="selectedWidget.chartSpec.mediaUrl"
                  :placeholder="$tr('https://... 或上传后的相对路径')"
                  @input="dirty = true"
                />
              </ElFormItem>
              <ElFormItem v-if="selectedWidget.chartSpec.chartType === 'image'" :label="$tr('上传图片')">
                <LemonUpload
                  :model-value="selectedWidget.chartSpec.mediaUrl || ''"
                  :image-url="selectedWidget.chartSpec.mediaUrl || ''"
                  attach-code="BiScreenWidgetImage"
                  :limit="1"
                  @update:model-value="selectedWidget.chartSpec.mediaUrl = $event || ''; dirty = true"
                />
              </ElFormItem>
            </template>
            <ElTabs v-model="propertyTab">
              <ElTabPane :label="$tr('外观与 option')" name="appearance">
                <ChartAppearanceEditor :key="selectedWidget.id" :spec="selectedWidget.chartSpec" :result="results[selectedWidget.id]"
                  :preview-width="selectedWidget.w" :preview-height="selectedWidget.h"
                  @update:spec="selectedWidget.chartSpec = $event; dirty = true" />
              </ElTabPane>
              <ElTabPane :label="$tr('数据与字段')" name="data">
            <ElAlert class="field-hint" type="info" :closable="false" :title="$tr(widgetFieldHint.summary)">
              <p>SQL 示例：{{ $tr(widgetFieldHint.sqlExample) }}</p>
              <ul>
                <li v-for="item in widgetFieldHint.fields" :key="item.name">
                  <b>{{ $tr(item.name) }}</b>{{ item.required ? $tr('（必填）') : $tr('（可选）') }}：{{ $tr(item.desc) }}
                </li>
              </ul>
            </ElAlert>
            <ElFormItem :label="$tr('图表类型')">
              <ElSelect v-model="selectedWidget.chartSpec.chartType" @change="onWidgetChartTypeChange">
                <ElOption v-for="item in CHART_TYPE_OPTIONS" :key="item.value" :value="item.value" :label="$tr(item.label)" />
              </ElSelect>
            </ElFormItem>
            <template v-if="isTextWidget || selectedWidget.chartSpec.chartType === 'clock'">
              <ElFormItem v-if="isTextWidget" :label="$tr('文本内容')">
                <ElInput
                  v-model="selectedWidget.chartSpec.textContent"
                  type="textarea"
                  :rows="5"
                  @input="dirty = true"
                />
              </ElFormItem>
              <ElFormItem :label="$tr('字号')">
                <ElInputNumber
                  :model-value="selectedWidget.chartSpec.appearance?.fontSize ?? (selectedWidget.chartSpec.chartType === 'clock' ? 36 : 24)"
                  :min="12"
                  :max="120"
                  controls-position="right"
                  @change="selectedWidget.chartSpec.appearance = { ...selectedWidget.chartSpec.appearance, fontSize: $event || 24 }; dirty = true"
                />
              </ElFormItem>
            </template>
            <template v-else-if="selectedWidget.chartSpec.chartType === 'image' || selectedWidget.chartSpec.chartType === 'iframe'">
              <ElAlert type="success" :closable="false" :title="$tr('媒体地址已在上方设置')" :description="$tr('切换图表类型后可在此配置其它字段；图片/网页 URL 与上传控件固定显示在标题与布局下方。')" />
            </template>
            <template v-else>
            <ElFormItem :label="$tr('X 字段')"><ElInput v-model="selectedWidget.chartSpec.xField" @input="dirty = true" /></ElFormItem>
            <ElFormItem :label="$tr('Y 字段（逗号分隔）')">
              <ElInput :model-value="selectedWidget.chartSpec.yFields.join(', ')"
                @input="selectedWidget.chartSpec.yFields = String($event).split(',').map(v => v.trim()).filter(Boolean); dirty = true" />
            </ElFormItem>
            <ElFormItem :label="$tr('系列字段')"><ElInput v-model="selectedWidget.chartSpec.seriesField" :placeholder="$tr('可选：按该字段拆分系列')" @input="dirty = true" /></ElFormItem>
            <div class="form-row">
              <ElFormItem :label="$tr('数值格式')"><ElSelect v-model="selectedWidget.chartSpec.valueFormat" @change="dirty = true">
                <ElOption :label="$tr('普通数字')" value="number" /><ElOption :label="$tr('百分比')" value="percent" /><ElOption :label="$tr('人民币')" value="currency" />
              </ElSelect></ElFormItem>
              <ElFormItem :label="$tr('堆叠')"><ElSwitch v-model="selectedWidget.chartSpec.stack" @change="dirty = true" /></ElFormItem>
            </div>
            <div class="form-row">
              <ElFormItem :label="$tr('排序字段')"><ElInput v-model="selectedWidget.chartSpec.sortBy" :placeholder="$tr('可选')" @input="dirty = true" /></ElFormItem>
              <ElFormItem :label="$tr('顺序')"><ElSelect v-model="selectedWidget.chartSpec.sortOrder" @change="dirty = true"><ElOption :label="$tr('升序')" value="asc" /><ElOption :label="$tr('降序')" value="desc" /></ElSelect></ElFormItem>
            </div>
            <ElFormItem :label="$tr('SQL（支持 :name 参数）')">
              <ElInput v-model="selectedWidget.data.sqlText" type="textarea" :rows="9" @input="dirty = true" />
            </ElFormItem>
            <ElFormItem :label="$tr('数据库连接')">
              <ElSelect v-model="selectedWidget.data.dbConfigId" filterable @change="changeWidgetConnection(selectedWidget)">
                <ElOption v-for="item in connections" :key="item.id" :value="item.id" :label="item.dbName || item.name || item.dbHost" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem :label="$tr('实例 / Schema')">
              <ElSelect v-model="selectedWidget.data.instanceName" filterable allow-create @change="dirty = true">
                <ElOption v-for="item in instances" :key="item" :value="item" :label="item" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem :label="$tr('默认参数 JSON')">
              <ElInput :model-value="defaultParamsText(selectedWidget)" type="textarea" :rows="3"
                placeholder='{"startDate":"2026-01-01"}' @change="updateDefaultParams(selectedWidget, String($event))" />
            </ElFormItem>
            <div class="form-row">
              <ElFormItem :label="$tr('最大行数')"><ElInputNumber v-model="selectedWidget.data.maxRows" :min="1" :max="5000" @change="dirty = true" /></ElFormItem>
              <ElFormItem :label="$tr('超时(秒)')"><ElInputNumber v-model="selectedWidget.data.timeoutSeconds" :min="1" :max="120" @change="dirty = true" /></ElFormItem>
            </div>
            </template>
              </ElTabPane>
            </ElTabs>
          </ElForm>
        </template>
        <template v-else>
          <h3>{{ $tr('大屏设置') }}</h3>
          <ElForm label-position="top" size="small">
            <ElFormItem :label="$tr('名称')"><ElInput v-model="screenForm.name" @input="dirty = true" /></ElFormItem>
            <ElFormItem :label="$tr('说明')"><ElInput v-model="screenForm.description" type="textarea" :rows="2" @input="dirty = true" /></ElFormItem>
            <ElFormItem :label="$tr('画布尺寸（16:9）')">
              <div class="preset-row">
                <ElButton
                  v-for="preset in CANVAS_PRESETS"
                  :key="preset.label"
                  size="small"
                  :type="screenConfig.width === preset.width && screenConfig.height === preset.height ? 'primary' : 'default'"
                  @click="applyCanvasPreset(preset.width, preset.height)"
                >{{ preset.label }}</ElButton>
              </div>
              <div class="form-row size-row">
                <ElFormItem :label="$tr('宽')"><ElInputNumber v-model="screenConfig.width" :min="640" :max="3840" controls-position="right" @change="dirty = true" /></ElFormItem>
                <ElFormItem :label="$tr('高')"><ElInputNumber v-model="screenConfig.height" :min="360" :max="2160" controls-position="right" @change="dirty = true" /></ElFormItem>
              </div>
            </ElFormItem>
            <ElFormItem :label="$tr('网格吸附')">
              <div class="form-row">
                <ElSwitch v-model="screenConfig.showGrid" @change="dirty = true" />
                <ElInputNumber v-model="screenConfig.gridSize" :min="4" :max="40" controls-position="right" @change="dirty = true" />
              </div>
            </ElFormItem>
            <ElFormItem :label="$tr('背景色')"><ElColorPicker v-model="screenConfig.background" @change="dirty = true" /></ElFormItem>
            <ElFormItem :label="$tr('背景图')">
              <LemonUpload
                :model-value="screenConfig.backgroundImage || ''"
                :image-url="screenConfig.backgroundImage || ''"
                attach-code="BiScreenBackground"
                :limit="1"
                @update:model-value="onBackgroundImageChange"
              />
              <p class="bg-hint">{{ $tr('建议 16:9 图片，上传后铺满画布；清除图片后仅显示背景色。') }}</p>
            </ElFormItem>
            <ElFormItem :label="$tr('数据更新策略')">
              <ElRadioGroup v-model="screenForm.refreshMode" @change="dirty = true">
                <ElRadio value="LIVE">{{ $tr('每次查看实时查询') }}</ElRadio>
                <ElRadio value="INTERVAL_SNAPSHOT">{{ $tr('后台定时快照') }}</ElRadio>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem v-if="screenForm.refreshMode === 'INTERVAL_SNAPSHOT'" :label="$tr('更新间隔（秒）')">
              <ElInputNumber v-model="screenForm.refreshIntervalSeconds" :min="30" :max="86400" @change="dirty = true" />
            </ElFormItem>
            <ElAlert :title="$tr('发布后查看页读取冻结版本；继续编辑草稿不会影响线上大屏。')" type="info" :closable="false" />
          </ElForm>
        </template>
      </aside>
    </main>

    <div v-if="contextMenu.visible" class="widget-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button @click="duplicateWidget(contextMenu.widgetId)">{{ $tr('复制组件') }}</button>
      <button @click="toggleLockWidget(contextMenu.widgetId)">{{ $tr('锁定 / 解锁') }}</button>
      <button @click="moveWidgetLayer(contextMenu.widgetId, 'top')">{{ $tr('置于顶层') }}</button>
      <button @click="moveWidgetLayer(contextMenu.widgetId, 'bottom')">{{ $tr('置于底层') }}</button>
      <button @click="moveWidgetLayer(contextMenu.widgetId, 'up')">{{ $tr('上移一层') }}</button>
      <button @click="moveWidgetLayer(contextMenu.widgetId, 'down')">{{ $tr('下移一层') }}</button>
      <button class="danger" @click="removeWidget(contextMenu.widgetId)">{{ $tr('删除组件') }}</button>
    </div>

    <ElDialog v-model="chartDialog" :title="$tr('图表编辑器')" width="min(1100px, 94vw)" destroy-on-close>
      <div class="chart-editor">
        <ElTabs v-model="chartEditorTab">
          <ElTabPane :label="$tr('数据与字段')" name="data">
        <ElForm label-position="top">
          <div class="form-row">
            <ElFormItem :label="$tr('图表名称')"><ElInput v-model="chartForm.title" /></ElFormItem>
            <ElFormItem v-if="!isStaticChartForm" :label="$tr('数据库连接')"><ElSelect v-model="chartForm.dbConfigId" filterable @change="changeConnection">
              <ElOption v-for="item in connections" :key="item.id" :value="item.id" :label="item.dbName || item.name || item.dbHost" />
            </ElSelect></ElFormItem>
            <ElFormItem v-if="!isStaticChartForm" :label="$tr('实例 / Schema')"><ElSelect v-model="chartForm.instanceName" filterable allow-create>
              <ElOption v-for="item in instances" :key="item" :value="item" :label="item" />
            </ElSelect></ElFormItem>
          </div>
          <ElAlert class="field-hint" type="info" :closable="false" :title="$tr(chartFieldHint.summary)">
            <p>SQL 示例：{{ $tr(chartFieldHint.sqlExample) }}</p>
            <ul>
              <li v-for="item in chartFieldHint.fields" :key="item.name">
                <b>{{ $tr(item.name) }}</b>{{ item.required ? $tr('（必填）') : $tr('（可选）') }}：{{ $tr(item.desc) }}
              </li>
            </ul>
          </ElAlert>
          <ElFormItem v-if="!isStaticChartForm" :label="$tr('只读 SQL')"><ElInput v-model="chartForm.sqlText" type="textarea" :rows="7" placeholder="SELECT category, amount FROM ..." /></ElFormItem>
          <ElFormItem :label="$tr('图表类型')">
            <div class="type-gallery">
              <button
                v-for="item in CHART_TYPE_OPTIONS"
                :key="item.value"
                type="button"
                class="type-chip"
                :class="{ active: chartSpecForm.chartType === item.value }"
                @click="chartSpecForm.chartType = item.value"
              >{{ $tr(item.label) }}</button>
            </div>
          </ElFormItem>
          <div class="form-row">
            <ElFormItem v-if="false" :label="$tr('图表类型')"><ElSelect v-model="chartSpecForm.chartType">
              <ElOption v-for="item in CHART_TYPE_OPTIONS" :key="item.value" :value="item.value" :label="$tr(item.label)" />
            </ElSelect></ElFormItem>
            <template v-if="isTextChartForm">
              <ElFormItem :label="$tr('字号')"><ElInputNumber v-model="chartSpecForm.fontSize" :min="12" :max="120" controls-position="right" /></ElFormItem>
            </template>
            <template v-else>
              <ElFormItem :label="$tr('X 字段')"><ElInput v-model="chartSpecForm.xField" /></ElFormItem>
              <ElFormItem :label="$tr('Y 字段（逗号分隔）')"><ElInput v-model="chartSpecForm.yFields" /></ElFormItem>
            </template>
          </div>
          <ElFormItem v-if="isTextChartForm" :label="$tr('文本内容')">
            <ElInput v-model="chartSpecForm.textContent" type="textarea" :rows="5" :placeholder="$tr('显示在大屏上的文案')" />
          </ElFormItem>
          <div v-if="!isStaticChartForm" class="form-row">
            <ElFormItem :label="$tr('系列字段')"><ElInput v-model="chartSpecForm.seriesField" :placeholder="$tr('可选')" /></ElFormItem>
            <ElFormItem :label="$tr('数值格式')"><ElSelect v-model="chartSpecForm.valueFormat"><ElOption :label="$tr('普通数字')" value="number" /><ElOption :label="$tr('百分比')" value="percent" /><ElOption :label="$tr('人民币')" value="currency" /></ElSelect></ElFormItem>
            <ElFormItem :label="$tr('排序')"><ElInput v-model="chartSpecForm.sortBy" :placeholder="$tr('字段名（可选）')" /></ElFormItem>
            <ElFormItem :label="$tr('顺序')"><ElSelect v-model="chartSpecForm.sortOrder"><ElOption :label="$tr('升序')" value="asc" /><ElOption :label="$tr('降序')" value="desc" /></ElSelect></ElFormItem>
            <ElFormItem :label="$tr('堆叠')"><ElSwitch v-model="chartSpecForm.stack" /></ElFormItem>
          </div>
        </ElForm>
          </ElTabPane>
          <ElTabPane :label="$tr('外观与 option')" name="appearance">
            <ElForm label-position="top"><ChartAppearanceEditor v-model:spec="editableChartSpec" :result="chartPreview" /></ElForm>
          </ElTabPane>
        </ElTabs>
        <div class="dialog-preview">
          <div class="dialog-preview-title">{{ $tr('实时预览') }}</div>
          <ChartRenderer
            v-if="chartPreview || chartSpecForm.chartType === 'text' || chartSpecForm.chartType === 'clock' || chartSpecForm.chartType === 'image' || chartSpecForm.chartType === 'iframe'"
            :spec="parseSpec(chartForm.chartSpec)"
            :result="chartPreview || { columns: [], rows: [], rowCount: 0 }"
          />
          <ElEmpty v-else :description="$tr('填写 SQL 后点「运行预览」；文本/时钟/图片可直接看效果')" />
        </div>
      </div>
      <template #footer><ElButton @click="doPreviewChart">{{ $tr('运行预览') }}</ElButton><ElButton type="primary" :loading="chartSaving" @click="doSaveChart">{{ $tr('保存图表') }}</ElButton></template>
    </ElDialog>

    <ElDialog v-model="draftPreviewVisible" :title="$tr('草稿预览（未发布）')" width="min(1100px, 96vw)" destroy-on-close>
      <div class="draft-preview-stage">
        <div class="draft-preview-canvas" :style="canvasBackgroundStyle()">
          <article
            v-for="widget in screenConfig.widgets"
            :key="widget.id"
            class="draft-preview-widget"
            :style="widgetStyle(widget)"
          >
            <header v-if="widget.chartSpec.appearance?.showTitle !== false && !['text', 'clock', 'image', 'iframe'].includes(widget.chartSpec.chartType)">
              {{ widget.title }}
            </header>
            <div class="widget-body">
              <ChartRenderer :spec="widget.chartSpec" :result="draftPreviewResults[widget.id]" />
            </div>
          </article>
        </div>
      </div>
      <template #footer>
        <ElButton @click="draftPreviewVisible = false">{{ $tr('关闭') }}</ElButton>
        <ElButton type="primary" @click="publish">{{ $tr('满意则发布') }}</ElButton>
      </template>
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
.editor { display: grid; grid-template-columns: 210px minmax(0,1fr) 286px; height: calc(100dvh - 126px); min-height: 560px; }.editor.focus-canvas { grid-template-columns: minmax(0,1fr); }.asset-panel,.property-panel { padding: 12px; overflow: auto; background: var(--el-bg-color); }.asset-panel { border-right: 1px solid var(--el-border-color-light); }.property-panel { border-left: 1px solid var(--el-border-color-light); }.asset-list { display: flex; flex-direction: column; gap: 7px; margin: 10px 0; }.drag-asset { display: flex; min-height: 43px; align-items: center; justify-content: space-between; padding: 7px 9px; cursor: grab; border: 1px solid var(--el-border-color); border-radius: 6px; }.drag-asset.used { border-color: var(--el-color-success); background: var(--el-color-success-light-9); }.drag-asset div { min-width: 0; }.drag-asset b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.drag-asset small { display: block; margin-top: 2px; color: var(--el-color-success); font-size: 10px; }.drag-asset span { flex: 0 0 auto; margin-left: 6px; color: var(--el-color-primary); font-size: 11px; }
.asset-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.asset-actions .full,
.full { width: 100%; margin-left: 0 !important; }
.canvas-stage { display: grid; padding: 6px; overflow: auto; place-items: center; background: #cbd2dc; }.canvas { position: relative; width: min(100%, calc((100dvh - 142px) * (var(--canvas-w, 16) / var(--canvas-h, 9)))); overflow: hidden; box-shadow: 0 5px 18px #0005; }.drop-hint { display: grid; height: 100%; place-items: center; color: #94a3b8; }.canvas-widget { position: absolute; display: flex; flex-direction: column; overflow: hidden; color: #dbeafe; cursor: move; touch-action: none; user-select: none; background: #101b2dcc; border: 1px solid #30435f; border-radius: 5px; }.canvas-widget.locked { cursor: default; }.canvas-widget .widget-body { pointer-events: none; }.canvas-widget.selected { outline: 2px solid #409eff; outline-offset: -1px; }.canvas-widget header { display: flex; flex: 0 0 30px; align-items: center; justify-content: space-between; padding: 0 9px; cursor: move; touch-action: none; background: #16243a; font-size: 12px; }.canvas-widget header i { color: #64748b; font-style: normal; }.widget-body { flex: 1; min-height: 0; padding: 4px; }.resize-handle { position: absolute; z-index: 4; padding: 0; touch-action: none; background: transparent; border: 0; }.resize-handle.east { top: 25%; right: -1px; width: 8px; height: 50%; cursor: ew-resize; border-right: 3px solid #409eff; }.resize-handle.south { bottom: -1px; left: 25%; width: 50%; height: 8px; cursor: ns-resize; border-bottom: 3px solid #409eff; }.resize-handle.southeast { right: 0; bottom: 0; width: 24px; height: 24px; cursor: nwse-resize; background: linear-gradient(135deg,transparent 52%,#409eff 53%); }
.property-panel h3,.asset-panel h3 { margin: 0 0 10px; }.property-panel :deep(.el-select),.chart-editor :deep(.el-select) { width: 100%; }.form-row { align-items: flex-start; }.form-row > * { flex: 1; }.layout-fields { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 5px; }.layout-fields :deep(.el-input-number) { width: 100%; }.dialog-preview { height: 300px; padding: 8px; border: 1px dashed var(--el-border-color); border-radius: 6px; }
.widget-context-menu { position: fixed; z-index: 4000; min-width: 136px; padding: 5px; background: var(--el-bg-color-overlay); border: 1px solid var(--el-border-color); border-radius: 6px; box-shadow: var(--el-box-shadow-light); }.widget-context-menu button { width: 100%; padding: 7px 10px; color: var(--el-color-danger); text-align: left; cursor: pointer; background: transparent; border: 0; border-radius: 4px; }.widget-context-menu button:hover { background: var(--el-color-danger-light-9); }
.widget-move-handle { position: absolute; top: 3px; right: 3px; z-index: 3; padding: 2px 8px; cursor: move; color: #dbeafe; background: #16243acc; border: 1px solid #409eff; border-radius: 4px; font-size: 11px; }
.canvas-widget.text-widget-card { background: transparent; border-style: dashed; }
.canvas-widget.text-widget-card .widget-body { padding: 0; }
.canvas-widget.text-widget-card .widget-move-handle { top: 1px; right: 1px; padding: 1px 6px; font-size: 10px; opacity: 0.85; }
.canvas-widget.media-widget-card { background: #0f172acc; border-style: dashed; border-color: #64748b; }
.canvas-widget.media-widget-card .widget-body { padding: 0; }
.field-hint { margin-bottom: 12px; }
.field-hint p, .field-hint ul { margin: 6px 0 0; padding: 0; font-size: 12px; line-height: 1.6; }
.field-hint li { margin-left: 1.1em; list-style: disc; }
.bg-hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.property-panel :deep(.el-upload--picture-card),
.property-panel :deep(.el-upload-list--picture-card .el-upload-list__item) {
  width: 96px;
  height: 72px;
}
.chart-editor { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: 18px; max-height: 65vh; overflow: auto; }.chart-editor > * { min-width: 0; }.chart-editor .form-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }.chart-editor .dialog-preview { position: sticky; top: 10px; margin-top: 40px; background: #101b2d; }
@media (max-width: 760px) { .chart-editor { grid-template-columns: minmax(0,1fr); }.chart-editor .dialog-preview { position: static; margin-top: 0; } }
@media (max-width: 1100px) { .editor { grid-template-columns: 180px minmax(390px,1fr) 250px; }.top-actions { flex-wrap: wrap; justify-content: flex-end; } }

.quick-widgets { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 100%; }
.quick-widgets :deep(.el-button) { margin: 0; width: 100%; }
.layer-panel { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--el-border-color-light); }
.layer-panel h4 { margin: 0 0 8px; font-size: 13px; }
.layer-panel small { margin-left: 6px; color: var(--el-text-color-secondary); font-weight: 400; }
.layer-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; margin-bottom: 4px; cursor: pointer; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; font-size: 12px; }
.layer-item.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.layer-item.locked { opacity: 0.75; }
.layer-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-item i { flex: 0 0 auto; color: var(--el-text-color-secondary); font-style: normal; font-size: 11px; }
.canvas-stage { grid-template-rows: auto minmax(0, 1fr); align-content: stretch; }
.canvas-toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; width: min(100%, calc((100dvh - 142px) * 1.7778)); margin: 0 auto 6px; padding: 4px 2px; }
.canvas-toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.canvas-toolbar-group :deep(.el-button + .el-button) { margin-left: 0; }
.canvas.show-grid::before {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(to right, rgb(148 163 184 / 22%) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(148 163 184 / 22%) 1px, transparent 1px);
  background-size: var(--grid-size, 2%) var(--grid-size, 2%);
}
/* 网格 ::before 已 z-index:0；切勿给子元素强制 position:relative，否则会覆盖 .canvas-widget 的 absolute，导致组件按文档流上下堆叠、无法拖到画布顶部。 */
.canvas > .drop-hint { position: absolute; inset: 0; z-index: 0; }
.drop-hint { display: flex; flex-direction: column; gap: 14px; height: 100%; align-items: center; justify-content: center; color: #94a3b8; text-align: center; }
.drop-hint p { margin: 0; max-width: 360px; line-height: 1.5; }
.drop-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.canvas-widget.locked { outline-style: dashed; }
.panel-title-actions { display: flex; gap: 2px; }
.preset-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.preset-row :deep(.el-button) { margin: 0; }
.size-row { margin-top: 4px; }
.save-state.dirty { color: var(--el-color-warning); }
.widget-context-menu button.danger { color: var(--el-color-danger); }
.type-gallery { display: flex; flex-wrap: wrap; gap: 6px; }
.type-chip { padding: 6px 10px; cursor: pointer; color: var(--el-text-color-regular); background: var(--el-fill-color-light); border: 1px solid var(--el-border-color); border-radius: 999px; font-size: 12px; }
.type-chip.active { color: #fff; background: var(--el-color-primary); border-color: var(--el-color-primary); }
.dialog-preview-title { margin-bottom: 6px; color: var(--el-text-color-secondary); font-size: 12px; }
.draft-preview-stage { display: grid; place-items: center; min-height: 420px; padding: 8px; background: #cbd2dc; border-radius: 8px; }
.draft-preview-canvas { position: relative; width: min(100%, 960px); aspect-ratio: 16 / 9; overflow: hidden; box-shadow: 0 5px 18px #0005; }
.draft-preview-widget { position: absolute; display: flex; flex-direction: column; overflow: hidden; color: #dbeafe; background: #101b2dcc; border: 1px solid #30435f; border-radius: 5px; }
.draft-preview-widget header { display: flex; flex: 0 0 28px; align-items: center; padding: 0 8px; background: #16243a; font-size: 12px; }
</style>
