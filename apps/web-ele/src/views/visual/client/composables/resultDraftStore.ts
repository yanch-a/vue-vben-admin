import type { QueryResultSet, QueryResultState } from './useQueryTabs';

/** 按结果对象保存编辑草稿；弱引用允许关闭的查询释放数据，不写入浏览器持久存储。
 * @author yanch
 */
export interface ResultDraft {
  rows: Record<string, any>[];
  original: Record<string, unknown>[];
  dirty: Set<number>;
  added: Set<number>;
  editingCell: { row: number; col: string } | null;
  editDraft: string;
}
const drafts = new WeakMap<QueryResultState, ResultDraft>();
const savingResults = new WeakSet<QueryResultState>();
const batchResults = new WeakMap<QueryResultSet, QueryResultState>();

/** 写入回调更新原结果后，同步分步展示的数据引用，避免隐藏表格仍显示已删除的行。 */
export function syncBatchResult(result: QueryResultState | null) {
  const set = result?.sets?.[result.activeSet ?? 0];
  if (!result || !set) return;
  set.rows = result.rows;
  set.rowCount = result.rowCount;
  set.columnMetadata = result.columnMetadata;
}

/** 每条分步结果拥有独立身份，切换集合/字段时不能混用上一条结果的草稿。 */
export function focusBatchResult(current: QueryResultState, index: number): QueryResultState {
  const set = current.sets?.[index];
  if (!set || current.activeSet === index) return current;
  const previous = current.sets?.[current.activeSet ?? 0];
  if (previous) { syncBatchResult(current); batchResults.set(previous, current); }
  const next = batchResults.get(set) || {
    ...current, columns: set.columns, columnTables: set.columnTables, columnMetadata: set.columnMetadata,
    rows: set.rows, rowCount: set.rowCount, elapsedMs: set.elapsedMs, message: set.message,
    error: set.error, sourceSql: set.sql, readOnlyReason: set.readOnlyReason, sourceConnectionFingerprint: set.sourceConnectionFingerprint || current.sourceConnectionFingerprint, sourceInstanceName: set.sourceInstanceName || current.sourceInstanceName,
  };
  next.sets = current.sets; next.activeSet = index;
  batchResults.set(set, next);
  return next;
}

/** 关闭/离开检查包含暂时隐藏的分步结果，弱引用随整个查询释放。 */
export function allResultStates(result: QueryResultState | null): QueryResultState[] {
  if (!result) return [];
  const states = new Set<QueryResultState>([result]);
  for (const set of result.sets || []) {
    const state = batchResults.get(set); if (state) states.add(state);
  }
  return [...states];
}

/** 保存状态跟随结果对象，切换页签后仍阻止关闭正在写入的原结果。 */
export function setResultSaving(result: QueryResultState | null, saving: boolean) {
  if (!result) return;
  if (saving) savingResults.add(result); else savingResults.delete(result);
}

/** 不持久化敏感数据，仅记录请求尚未结束的结果身份。 */
export function isResultSaving(result: QueryResultState | null) {
  return !!result && savingResults.has(result);
}

/** 草稿按结果身份隔离，切换连接和标签时可以恢复。 */
export function putResultDraft(result: QueryResultState | null, draft: ResultDraft | null) {
  if (!result) return;
  if (draft) drafts.set(result, draft); else drafts.delete(result);
}
export function getResultDraft(result: QueryResultState | null) { return result ? drafts.get(result) : undefined; }
export function hasResultDraft(result: QueryResultState | null) { return !!getResultDraft(result); }
