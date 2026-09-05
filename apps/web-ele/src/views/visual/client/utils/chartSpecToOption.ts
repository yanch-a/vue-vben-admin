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
  const data = Array.isArray(rows) ? rows.slice(0, 2000) : [];
  const x = spec.xField;
  const ys = spec.yFields || [];
  const type = spec.chartType;
  const pieY = ys[0];
  if (type === 'pie') {
    return {
      tooltip: { trigger: 'item' },
      legend: { type: 'scroll' },
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
      tooltip: { trigger: 'item' },
      xAxis: { type: 'value', name: spec.xAxisLabel },
      yAxis: { type: 'value', name: spec.yAxisLabel },
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
  const cats = data.map((r) => (x ? String(r[x] ?? '') : ''));
  const series = ys.map((y) => ({
    name: y,
    type: type === 'area' ? 'line' : type === 'bar' ? 'bar' : 'line',
    stack: spec.stack ? 'total' : undefined,
    areaStyle: type === 'area' ? {} : undefined,
    data: data.map((r) => num(r[y])),
  }));
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll' },
    grid: { containLabel: true, left: 24, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: cats, name: spec.xAxisLabel },
    yAxis: { type: 'value', name: spec.yAxisLabel },
    series,
  };
}
