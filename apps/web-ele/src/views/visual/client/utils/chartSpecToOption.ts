/**
 * ChartSpec + rows → ECharts option
 * @author yanch
 */
export interface ChartSpec {
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'kpi' | 'table';
  xField?: string;
  yFields: string[];
  seriesField?: string;
  stack?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  valueFormat?: 'number' | 'percent' | 'currency';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  description?: string;
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function chartSpecToOption(spec: ChartSpec, _columns: string[], rows: any[]) {
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
    return {
      textStyle: { color: '#94a3b8' },
      tooltip: { trigger: 'item', valueFormatter: format },
      legend: { type: 'scroll', textStyle: { color: '#94a3b8' } },
      series: [
        {
          type: 'pie',
          radius: '65%',
          data: data.map((r) => ({
            name: x ? String(r[x] ?? '') : '',
            value: pieY ? (num(r[pieY]) ?? 0) : 0,
          })),
        },
      ],
    };
  }
  if (type === 'scatter') {
    const sx = x || ys[0];
    const sy = ys[0] || ys[1];
    return {
      textStyle: { color: '#94a3b8' },
      tooltip: { trigger: 'item' },
      xAxis: { type: 'value', name: spec.xAxisLabel, axisLabel: { color: '#94a3b8' } },
      yAxis: { type: 'value', name: spec.yAxisLabel, axisLabel: { color: '#94a3b8' } },
      series: [
        {
          type: 'scatter',
          data: data.map((r) => [
            sx ? num(r[sx]) : null,
            sy ? num(r[sy]) : null,
          ]),
        },
      ],
    };
  }
  const cats = [...new Set(data.map((r) => (x ? String(r[x] ?? '') : '')))];
  const makeSeries = (name: string, y: string, subset: any[]) => ({
    name,
    type: type === 'area' ? 'line' : type === 'bar' ? 'bar' : 'line',
    stack: spec.stack ? 'total' : undefined,
    areaStyle: type === 'area' ? {} : undefined,
    data: cats.map((category) => {
      const row = subset.find((item) => String(x ? item[x] ?? '' : '') === category);
      return row ? num(row[y]) : null;
    }),
  });
  const groups = spec.seriesField
    ? [...new Set(data.map((row) => String(row[spec.seriesField!] ?? '')))]
    : [];
  const series = groups.length
    ? groups.flatMap((group) =>
        ys.map((y) => makeSeries(ys.length > 1 ? `${group} · ${y}` : group, y,
          data.filter((row) => String(row[spec.seriesField!] ?? '') === group))),
      )
    : ys.map((y) => makeSeries(y, y, data));
  return {
    textStyle: { color: '#94a3b8' },
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', textStyle: { color: '#94a3b8' } },
    grid: { containLabel: true, left: 24, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: cats, name: spec.xAxisLabel, axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: spec.yAxisLabel, axisLabel: { color: '#94a3b8', formatter: format } },
    series,
  };
}
