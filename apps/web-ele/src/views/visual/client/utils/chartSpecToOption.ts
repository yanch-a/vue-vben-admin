/**
 * ChartSpec + rows → ECharts option
 * @author yanch
 */
import type { ChartSpec } from '../../../../api/visual/dashboard';

export type { ChartSpec } from '../../../../api/visual/dashboard';

/** 阻止自定义 JSON 通过特殊属性污染配置对象的原型。 */
function assertSafeOption(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error(`option 不允许包含 ${key} 属性`);
    }
    assertSafeOption(child);
  }
}

/** 验证高级配置是 JSON 对象；不执行用户输入的 JavaScript。@author yanch */
export function parseOptionOverrides(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text.trim() || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('option 必须是 JSON 对象，不能是数组或字符串');
  }
  assertSafeOption(value);
  return value as Record<string, unknown>;
}

/**
 * 深度合并 option。series 按索引合并，局部修改颜色/标签不会抹掉 SQL 数据；
 * 其余数组（例如 color、data、radius）完整替换，支持显式指定全部数据。
 */
export function mergeChartOption(
  base: any,
  overrides: Record<string, unknown>,
): any {
  assertSafeOption(overrides);
  const merge = (target: any, patch: any, key = ''): any => {
    if (Array.isArray(patch)) {
      if (key === 'series' && Array.isArray(target)) {
        return Array.from(
          { length: Math.max(target.length, patch.length) },
          (_, index) =>
            index < patch.length
              ? merge(target[index], patch[index])
              : target[index],
        );
      }
      return patch.map((item) => merge(undefined, item));
    }
    if (patch && typeof patch === 'object') {
      // ECharts 也允许 series: {}，等价于配置第一个系列。
      if (key === 'series' && Array.isArray(target))
        return merge(target, [patch], key);
      const result =
        target && typeof target === 'object' && !Array.isArray(target)
          ? { ...target }
          : {};
      for (const [childKey, child] of Object.entries(patch)) {
        result[childKey] = merge(result[childKey], child, childKey);
      }
      return result;
    }
    return patch;
  };
  return merge(base, overrides);
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 将字段映射、尺寸自适应外观和高级覆盖合成为最终 ECharts option。 */
export function chartSpecToOption(
  spec: ChartSpec,
  _columns: string[],
  rows: any[],
  size?: { height: number; width: number },
) {
  const appearance = spec.appearance || {};
  const compact = Boolean(size && (size.height < 180 || size.width < 260));
  const fontSize = appearance.fontSize ?? (compact ? 10 : 12);
  const groupCount = spec.seriesField
    ? new Set(
        (Array.isArray(rows) ? rows : []).map((row) => row[spec.seriesField!]),
      ).size
    : 1;
  const hasMultipleSeries =
    spec.chartType === 'pie' || groupCount * (spec.yFields?.length || 0) > 1;
  const legendMode = appearance.legend || 'auto';
  const showLegend =
    legendMode !== 'hidden' &&
    (legendMode !== 'auto' || (!compact && hasMultipleSeries));
  const legendBottom = legendMode === 'bottom';
  const legend = {
    show: showLegend,
    type: 'scroll',
    top: legendBottom ? undefined : 0,
    bottom: legendBottom ? 0 : undefined,
    itemWidth: 12,
    itemHeight: 8,
    textStyle: { color: '#94a3b8', fontSize },
  };
  const grid = {
    containLabel: true,
    left: 8,
    right: 8,
    top: showLegend && !legendBottom ? fontSize + 18 : 8,
    bottom: showLegend && legendBottom ? fontSize + 18 : 6,
    ...appearance.grid,
  };
  const finish = (option: any) =>
    mergeChartOption(
      {
        backgroundColor: 'transparent',
        ...(appearance.colors?.length ? { color: appearance.colors } : {}),
        ...option,
      },
      spec.optionOverrides || {},
    );
  let data = Array.isArray(rows) ? rows.slice(0, 2000) : [];
  const x = spec.xField;
  const ys = spec.yFields || [];
  const type = spec.chartType;
  const pieY = ys[0];
  if (spec.sortBy) {
    const direction = spec.sortOrder === 'desc' ? -1 : 1;
    data = [...data].sort((a, b) => {
      const av = a?.[spec.sortBy!];
      const bv = b?.[spec.sortBy!];
      const an = num(av);
      const bn = num(bv);
      if (an !== null && bn !== null) return (an - bn) * direction;
      return String(av ?? '').localeCompare(String(bv ?? '')) * direction;
    });
  }
  const format = (value: any) => {
    const n = num(value);
    if (n === null) return value;
    if (spec.valueFormat === 'percent') return `${(n * 100).toFixed(2)}%`;
    if (spec.valueFormat === 'currency') return `¥${n.toLocaleString()}`;
    return n.toLocaleString();
  };
  if (type === 'pie') {
    return finish({
      textStyle: { color: '#94a3b8', fontSize },
      tooltip: { trigger: 'item', valueFormatter: format },
      legend,
      series: [
        {
          type: 'pie',
          radius: `${appearance.pieRadius ?? 78}%`,
          top: showLegend && !legendBottom ? fontSize + 18 : 0,
          bottom: showLegend && legendBottom ? fontSize + 18 : 0,
          label: {
            show: appearance.showLabels ?? !compact,
            position: 'inside',
            fontSize,
          },
          labelLine: { show: false },
          data: data.map((r) => ({
            name: x ? String(r[x] ?? '') : '',
            value: pieY ? (num(r[pieY]) ?? 0) : 0,
          })),
        },
      ],
    });
  }
  if (type === 'scatter') {
    const sx = x || ys[0];
    const sy = ys[0] || ys[1];
    return finish({
      textStyle: { color: '#94a3b8', fontSize },
      grid,
      tooltip: { trigger: 'item' },
      xAxis: {
        type: 'value',
        name: spec.xAxisLabel,
        axisLabel: { color: '#94a3b8', fontSize },
      },
      yAxis: {
        type: 'value',
        name: spec.yAxisLabel,
        axisLabel: { color: '#94a3b8', fontSize },
      },
      series: [
        {
          type: 'scatter',
          label: { show: appearance.showLabels ?? false, fontSize },
          data: data.map((r) => [
            sx ? num(r[sx]) : null,
            sy ? num(r[sy]) : null,
          ]),
        },
      ],
    });
  }
  const cats = [...new Set(data.map((r) => (x ? String(r[x] ?? '') : '')))];
  const makeSeries = (name: string, y: string, subset: any[]) => ({
    name,
    type: type === 'area' ? 'line' : type === 'bar' ? 'bar' : 'line',
    stack: spec.stack ? 'total' : undefined,
    areaStyle: type === 'area' ? {} : undefined,
    smooth: appearance.smooth ?? false,
    showSymbol: !compact,
    label: { show: appearance.showLabels ?? false, fontSize },
    data: cats.map((category) => {
      const row = subset.find(
        (item) => String(x ? (item[x] ?? '') : '') === category,
      );
      return row ? num(row[y]) : null;
    }),
  });
  const groups = spec.seriesField
    ? [...new Set(data.map((row) => String(row[spec.seriesField!] ?? '')))]
    : [];
  const series = groups.length
    ? groups.flatMap((group) =>
        ys.map((y) =>
          makeSeries(
            ys.length > 1 ? `${group} · ${y}` : group,
            y,
            data.filter(
              (row) => String(row[spec.seriesField!] ?? '') === group,
            ),
          ),
        ),
      )
    : ys.map((y) => makeSeries(y, y, data));
  return finish({
    textStyle: { color: '#94a3b8', fontSize },
    tooltip: { trigger: 'axis' },
    legend,
    grid,
    xAxis: {
      type: 'category',
      data: cats,
      name: spec.xAxisLabel,
      axisLabel: { color: '#94a3b8', fontSize, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: spec.yAxisLabel,
      axisLabel: { color: '#94a3b8', fontSize, formatter: format },
    },
    series,
  });
}
