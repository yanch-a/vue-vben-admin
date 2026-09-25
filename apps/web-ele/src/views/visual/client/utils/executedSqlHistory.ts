/**
 * 连接上最近执行过的 SQL，只放在前端内存里。
 * 每个数据库连接最多保留 200 条，新的在最前。刷新页面或切换用户后自然清空。
 *
 * @author yanch
 */
import { reactive } from 'vue';

export const EXECUTED_SQL_LIMIT = 200;

export interface ExecutedSqlEntry {
  id: string;
  dbConfigId: string;
  instanceName: string;
  sql: string;
  executedAt: number;
  success: boolean;
}

const buckets = reactive<Record<string, ExecutedSqlEntry[]>>({});
let seq = 0;

export function rememberExecutedSql(input: {
  dbConfigId: string | number;
  instanceName?: string;
  sql: string;
  success: boolean;
  executedAt?: number;
}) {
  const dbConfigId = String(input.dbConfigId ?? '').trim();
  const sql = String(input.sql || '').trim();
  if (!dbConfigId || !sql) return;
  const prev = buckets[dbConfigId] || [];
  const entry: ExecutedSqlEntry = {
    id: `${input.executedAt ?? Date.now()}-${++seq}`,
    dbConfigId,
    instanceName: String(input.instanceName || ''),
    sql,
    executedAt: input.executedAt ?? Date.now(),
    success: !!input.success,
  };
  buckets[dbConfigId] = [entry, ...prev].slice(0, EXECUTED_SQL_LIMIT);
}

export function listExecutedSql(dbConfigId: string | number | null | undefined) {
  const key = String(dbConfigId ?? '').trim();
  if (!key) return [];
  return buckets[key] || [];
}

/** 按 SQL 正文或库名检索，大小写不敏感 */
export function filterExecutedSql(entries: ExecutedSqlEntry[], keyword: string) {
  const q = String(keyword || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (item) =>
      item.sql.toLowerCase().includes(q) ||
      item.instanceName.toLowerCase().includes(q),
  );
}
