/**
 * 结果区删除目标。
 * 有勾选时只删勾选行，右键所在行若未勾选绝不带上；
 * 没有勾选时只删右键那一行。
 *
 * 勾选行放进 ref 后会变成响应式代理，和结果数组里的原始行不是同一个引用。
 * 比对前先取原始对象，避免把仍在结果里的勾选行误判成过期。
 *
 * @author yanch
 */
import { toRaw } from 'vue';

/** 与后台 executeDmlBatch 单次事务上限一致，超出则整批取消，避免拆开后删一半 */
export const MAX_DELETE_STATEMENTS = 50;

export type DeleteTargetPlan<T> =
  | { ok: true; mode: 'checked' | 'context'; rows: T[] }
  | { ok: false; reason: 'empty' | 'stale' };

/** 去掉 Vue 代理，保证和结果行用的是同一个对象 */
function unwrapRow<T>(row: T): T {
  return toRaw(row as object) as T;
}

function uniqueRefs<T>(rows: T[] | null | undefined): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const row of rows || []) {
    if (row == null) continue;
    const raw = unwrapRow(row);
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/**
 * 在点击删除的那一刻计算目标。
 * 勾选行必须全部还在当前结果里，否则视为过期，一条都不删。
 */
export function planDeleteTargets<T>(
  checkedRows: T[] | null | undefined,
  contextRow: T | null | undefined,
  currentRows: T[] | null | undefined,
): DeleteTargetPlan<T> {
  const current = new Set((currentRows || []).map((row) => unwrapRow(row)));
  const checked = uniqueRefs(checkedRows);
  if (checked.length > 0) {
    if (checked.some((row) => !current.has(row))) {
      return { ok: false, reason: 'stale' };
    }
    return { ok: true, mode: 'checked', rows: checked };
  }
  if (contextRow != null) {
    const rawContext = unwrapRow(contextRow);
    if (current.has(rawContext)) {
      return { ok: true, mode: 'context', rows: [rawContext] };
    }
  }
  return { ok: false, reason: 'empty' };
}

/** 两条计划是否仍是同一批行（引用和顺序都一致） */
export function sameDeletePlan<T>(
  left: DeleteTargetPlan<T>,
  right: DeleteTargetPlan<T>,
): boolean {
  if (!left.ok || !right.ok) return false;
  if (left.mode !== right.mode || left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, index) => row === right.rows[index]);
}

/**
 * SQL DELETE 相同语句只留一条。
 * 无主键时一条 DELETE 已按全部列匹配，再发一次不会多删到新行，但重复执行没有意义。
 * MongoDB deleteOne 不能走这里：相同条件的第二条会再删下一个文档。
 */
export function dedupeDeleteSql(sqls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sql of sqls) {
    const key = String(sql || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sql);
  }
  return out;
}
