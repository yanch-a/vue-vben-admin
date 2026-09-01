import { adminUrl } from '#/config';
import request from '#/utils/request';

const bundleUrl = adminUrl + '/vqBundle/';

export type VqBundleSection =
  | 'dbConfigs'
  | 'savedQueryGroups'
  | 'savedQueries'
  | 'queryConfigs';

export type VqBundleConflictStrategy = 'SKIP' | 'OVERWRITE' | 'RENAME';

export interface VqBundleSectionStat {
  total: number;
  imported: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  failed: number;
}

export interface VqBundleImportResult {
  dryRun: boolean;
  conflictStrategy: string;
  formatVersion: number;
  exportTime?: string;
  exporterUserId?: number;
  sectionKeys?: string[];
  stats: Record<string, VqBundleSectionStat>;
  messages?: string[];
}

/** 导出加密配置包（.vqb blob） */
export function exportVqBundle(data: {
  password: string;
  sections?: VqBundleSection[];
  dbConfigIds?: Array<number | string>;
}) {
  return request({
    url: bundleUrl + 'export',
    method: 'post',
    data,
    responseType: 'blob',
  });
}

/** 预览导入（不落库） */
export function previewVqBundleImport(form: FormData) {
  return request({
    url: bundleUrl + 'previewImport',
    method: 'post',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/** 正式导入 */
export function importVqBundle(form: FormData) {
  return request({
    url: bundleUrl + 'import',
    method: 'post',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/** section 展示名 */
export const BUNDLE_SECTION_LABELS: Record<VqBundleSection, string> = {
  dbConfigs: '数据库连接',
  savedQueryGroups: '查询文件分组',
  savedQueries: '已保存 SQL 查询',
  queryConfigs: '可视化查询配置',
};
