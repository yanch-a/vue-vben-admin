/**
 * 左侧工作区列表排序：自定义顺序（后端按用户保存的拖动结果）、名称、更新时间、创建时间。
 *
 * @author yanch
 */
import type { EtlWorkspaceRow } from '#/api/visual/etl';

export type EtlWorkspaceSortMode = 'created' | 'custom' | 'name' | 'updated';

export interface EtlWorkspaceSort {
  desc: boolean;
  mode: EtlWorkspaceSortMode;
}

export const ETL_WORKSPACE_SORT_KEY = 'lemon-etl-workspace-sort';
export const ETL_WORKSPACE_SORT_OPTIONS: { label: string; value: EtlWorkspaceSortMode }[] = [
  { label: '自定义顺序', value: 'custom' },
  { label: '名称', value: 'name' },
  { label: '更新时间', value: 'updated' },
  { label: '创建时间', value: 'created' },
];

/** 读取记住的排序方式，坏值回到自定义顺序。 */
export function parseEtlWorkspaceSort(raw: null | string): EtlWorkspaceSort {
  try {
    const value = JSON.parse(raw || '{}');
    const mode = ETL_WORKSPACE_SORT_OPTIONS.some((item) => item.value === value?.mode) ? value.mode : 'custom';
    return { mode, desc: value?.desc === true };
  } catch {
    return { mode: 'custom', desc: false };
  }
}

function time(value?: string) {
  const parsed = value ? Date.parse(value.replace(' ', 'T')) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 返回排好序的新数组，不改原列表；自定义顺序就是后端返回的顺序。 */
export function sortEtlWorkspaces(rows: EtlWorkspaceRow[], sort: EtlWorkspaceSort, displayName: (row: EtlWorkspaceRow) => string = (row) => row.workspaceName): EtlWorkspaceRow[] {
  const list = [...rows];
  if (sort.mode === 'custom') return sort.desc ? list.reverse() : list;
  const collator = new Intl.Collator(['zh-CN', 'en'], { numeric: true, sensitivity: 'base' });
  const compare =
    sort.mode === 'name'
      ? (left: EtlWorkspaceRow, right: EtlWorkspaceRow) => collator.compare(displayName(left) || '', displayName(right) || '')
      : sort.mode === 'updated'
        ? (left: EtlWorkspaceRow, right: EtlWorkspaceRow) => time(left.updateTime) - time(right.updateTime)
        : (left: EtlWorkspaceRow, right: EtlWorkspaceRow) => time(left.createTime) - time(right.createTime);
  // 相同时保持自定义顺序，结果稳定。
  const index = new Map(rows.map((row, position) => [String(row.id), position]));
  return list.sort((left, right) => {
    const result = compare(left, right) * (sort.desc ? -1 : 1);
    return result || (index.get(String(left.id)) || 0) - (index.get(String(right.id)) || 0);
  });
}

/** 拖动：把 sourceId 移到 targetId 之前或之后，返回新的 ID 顺序；无效拖动返回 null。 */
export function moveEtlWorkspace(ids: string[], sourceId: string, targetId: string, after: boolean): null | string[] {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return null;
  const next = ids.filter((id) => id !== sourceId);
  next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  return next.join('\n') === ids.join('\n') ? null : next;
}