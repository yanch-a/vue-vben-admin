/**
 * 图表资产与数据大屏 API。
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const chartUrl = `${adminUrl}/aiChart/`;
const screenUrl = `${adminUrl}/biScreen/`;

export type ChartType = 'area' | 'bar' | 'kpi' | 'line' | 'pie' | 'scatter' | 'table';

export interface ChartSpec {
  chartType: ChartType;
  description?: string;
  seriesField?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  stack?: boolean;
  valueFormat?: 'currency' | 'number' | 'percent';
  xAxisLabel?: string;
  xField?: string;
  yAxisLabel?: string;
  yFields: string[];
}

export interface DatasetDefinition {
  dbConfigId?: number | string;
  defaultParams?: Record<string, unknown>;
  instanceName?: string;
  maxRows?: number;
  sqlText: string;
  timeoutSeconds?: number;
}

export interface ChartAsset extends DatasetDefinition {
  chartSpec: string;
  createTime?: string;
  description?: string;
  id?: number | string;
  revision?: number;
  sourceType?: 'AI' | 'MANUAL';
  title: string;
  updateTime?: string;
}

export interface QueryResult {
  columns: string[];
  elapsedMs?: number;
  rowCount: number;
  rows: Array<Record<string, unknown>>;
}

export interface ScreenWidget {
  chartId?: number | string;
  chartSpec: ChartSpec;
  data: DatasetDefinition;
  h: number;
  id: string;
  title: string;
  w: number;
  x: number;
  y: number;
}

export interface ScreenConfig {
  background?: string;
  height: number;
  schemaVersion: number;
  widgets: ScreenWidget[];
  width: number;
}

export function listCharts() {
  return request({ url: `${chartUrl}list`, method: 'get' });
}

export function saveChartAsset(data: ChartAsset) {
  return request({ url: `${chartUrl}save`, method: 'post', data });
}

export function previewChart(data: ChartAsset) {
  return request({ url: `${chartUrl}preview`, method: 'post', data, timeout: 120_000 });
}

export function runChart(id: number | string) {
  return request({ url: `${chartUrl}run/${id}`, method: 'post', timeout: 120_000 });
}

export function deleteChart(id: number | string) {
  return request({ url: `${chartUrl}del/${id}`, method: 'get' });
}

export function listScreens() {
  return request({ url: `${screenUrl}list`, method: 'get' });
}

export function getScreen(id: number | string) {
  return request({ url: `${screenUrl}${id}`, method: 'get' });
}

export function saveScreenDraft(data: Record<string, unknown>) {
  return request({ url: `${screenUrl}saveDraft`, method: 'post', data });
}

export function previewScreen(config: ScreenConfig, params: Record<string, unknown> = {}) {
  return request({ url: `${screenUrl}preview`, method: 'post', data: { config, params }, timeout: 120_000 });
}

export function publishScreen(id: number | string) {
  return request({ url: `${screenUrl}publish/${id}`, method: 'post', timeout: 120_000 });
}

export function runtimeScreen(id: number | string, params: Record<string, unknown> = {}) {
  return request({ url: `${screenUrl}runtime/${id}`, method: 'post', data: { params }, timeout: 120_000 });
}

export function refreshScreen(id: number | string) {
  return request({ url: `${screenUrl}refresh/${id}`, method: 'post', timeout: 120_000 });
}

export function deleteScreen(id: number | string) {
  return request({ url: `${screenUrl}del/${id}`, method: 'get' });
}
