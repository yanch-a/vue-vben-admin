/**
 * 大屏画布组装工具：对齐、分布、吸附、布局归一化。
 * @author yanch
 */
import type { ChartType, ScreenWidget } from '#/api/visual/dashboard';

export type AlignMode =
  | 'bottom'
  | 'hcenter'
  | 'left'
  | 'right'
  | 'top'
  | 'vcenter';

export type WidgetSize = { w: number; h: number };

/** 各组件类型的默认宽高；缺字段或非法值时回退到此。 */
export const DEFAULT_WIDGET_SIZES: Record<string, WidgetSize> = {
  text: { w: 220, h: 48 },
  clock: { w: 320, h: 64 },
  image: { w: 360, h: 200 },
  iframe: { w: 480, h: 280 },
  kpi: { w: 280, h: 160 },
  table: { w: 480, h: 300 },
  bar: { w: 420, h: 260 },
  line: { w: 420, h: 260 },
  area: { w: 420, h: 260 },
  pie: { w: 360, h: 280 },
  scatter: { w: 420, h: 260 },
};

export const FALLBACK_WIDGET_SIZE: WidgetSize = { w: 420, h: 260 };
export const DEFAULT_WIDGET_ORIGIN = { x: 40, y: 24 };

export function snapValue(value: number, gridSize: number, enabled: boolean) {
  if (!enabled || gridSize <= 1) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** 仅接受有限数字；Event / null / NaN / 字符串一律回退。 */
export function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function defaultWidgetSize(chartType?: ChartType | string): WidgetSize {
  if (!chartType) return { ...FALLBACK_WIDGET_SIZE };
  return { ...(DEFAULT_WIDGET_SIZES[chartType] || FALLBACK_WIDGET_SIZE) };
}

export type LayoutPatch = {
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  chartType?: ChartType | string;
};

/**
 * 保证组件具备有限的 x/y/w/h。
 * 用于新建、加载旧稿、拖拽/缩放开始前；避免缺字段导致单轴拖不动。
 */
export function normalizeWidgetLayout<T extends LayoutPatch>(
  widget: T,
  patch: LayoutPatch = {},
): T & { x: number; y: number; w: number; h: number } {
  const chartType =
    patch.chartType ||
    (widget as { chartSpec?: { chartType?: string } }).chartSpec?.chartType ||
    widget.chartType;
  const defaults = defaultWidgetSize(chartType);
  const x = finiteNumber(
    patch.x !== undefined ? patch.x : widget.x,
    DEFAULT_WIDGET_ORIGIN.x,
  );
  const y = finiteNumber(
    patch.y !== undefined ? patch.y : widget.y,
    DEFAULT_WIDGET_ORIGIN.y,
  );
  const w = Math.max(
    1,
    finiteNumber(patch.w !== undefined ? patch.w : widget.w, defaults.w),
  );
  const h = Math.max(
    1,
    finiteNumber(patch.h !== undefined ? patch.h : widget.h, defaults.h),
  );
  widget.x = x;
  widget.y = y;
  widget.w = w;
  widget.h = h;
  return widget as T & { x: number; y: number; w: number; h: number };
}

/** 批量归一化；编辑器加载旧大屏时调用。 */
export function normalizeScreenWidgets<T extends LayoutPatch>(
  widgets: T[] | undefined | null,
): Array<T & { x: number; y: number; w: number; h: number }> {
  if (!Array.isArray(widgets)) return [];
  return widgets.map((item) => normalizeWidgetLayout(item));
}

/** 单选时相对画布对齐；多选时相对选区包围盒对齐。 */
export function alignWidgets(
  widgets: ScreenWidget[],
  mode: AlignMode,
  canvas: { width: number; height: number },
) {
  if (!widgets.length) return;
  widgets.forEach((item) => normalizeWidgetLayout(item));
  if (widgets.length === 1) {
    const w = widgets[0]!;
    if (mode === 'left') w.x = 0;
    if (mode === 'right') w.x = Math.max(0, canvas.width - w.w);
    if (mode === 'top') w.y = 0;
    if (mode === 'bottom') w.y = Math.max(0, canvas.height - w.h);
    if (mode === 'hcenter') w.x = Math.max(0, Math.round((canvas.width - w.w) / 2));
    if (mode === 'vcenter') w.y = Math.max(0, Math.round((canvas.height - w.h) / 2));
    return;
  }
  const minX = Math.min(...widgets.map((item) => item.x));
  const minY = Math.min(...widgets.map((item) => item.y));
  const maxX = Math.max(...widgets.map((item) => item.x + item.w));
  const maxY = Math.max(...widgets.map((item) => item.y + item.h));
  for (const w of widgets) {
    if (mode === 'left') w.x = minX;
    if (mode === 'right') w.x = maxX - w.w;
    if (mode === 'top') w.y = minY;
    if (mode === 'bottom') w.y = maxY - w.h;
    if (mode === 'hcenter') w.x = Math.round((minX + maxX - w.w) / 2);
    if (mode === 'vcenter') w.y = Math.round((minY + maxY - w.h) / 2);
  }
}

export function distributeWidgets(
  widgets: ScreenWidget[],
  axis: 'horizontal' | 'vertical',
) {
  if (widgets.length < 3) return;
  widgets.forEach((item) => normalizeWidgetLayout(item));
  const sorted = [...widgets].sort((a, b) =>
    axis === 'horizontal' ? a.x - b.x : a.y - b.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (axis === 'horizontal') {
    const span = last.x + last.w - first.x;
    const totalSize = sorted.reduce((sum, item) => sum + item.w, 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = first.x;
    for (const item of sorted) {
      item.x = Math.round(cursor);
      cursor += item.w + gap;
    }
  } else {
    const span = last.y + last.h - first.y;
    const totalSize = sorted.reduce((sum, item) => sum + item.h, 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = first.y;
    for (const item of sorted) {
      item.y = Math.round(cursor);
      cursor += item.h + gap;
    }
  }
}

export const CANVAS_PRESETS = [
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1600×900', width: 1600, height: 900 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1200×675', width: 1200, height: 675 },
] as const;
