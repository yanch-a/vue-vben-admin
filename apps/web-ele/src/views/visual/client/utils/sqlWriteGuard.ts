/**
 * SQL 写操作 / 危险语句检测（前端确认框用，与后端 SqlReadOnlyValidator 对齐思路）
 * @author yanch
 */

/** 去掉注释后取首关键字与全文大写文本 */
function normalizeForCheck(sql: string): { first: string; upper: string } {
  const raw = String(sql || '').trim();
  let s = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .replace(/^[ \t]*#[^\n]*$/gm, ' ')
    .trim();
  if (s.endsWith(';')) s = s.slice(0, -1).trim();
  const upper = s.toUpperCase();
  const m = upper.match(/[A-Z]+/);
  return { first: m?.[0] || '', upper };
}

const WRITE_PREFIXES = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'DROP',
  'CREATE',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'CALL',
  'EXEC',
  'EXECUTE',
  'MERGE',
]);

/**
 * 是否属于写操作或危险语句（非纯查询）
 * SELECT / SHOW / DESC / DESCRIBE / EXPLAIN / WITH 视为只读
 */
export function isWriteOrDangerousSql(sql: string): boolean {
  const { first, upper } = normalizeForCheck(sql);
  if (!first) return false;
  if (WRITE_PREFIXES.has(first)) return true;
  // SELECT ... INTO OUTFILE / INSERT 嵌套等
  if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|MERGE)\b/.test(upper)) {
    // WITH ... SELECT 里不应误伤；仅当首词不是 WITH/SELECT/SHOW/... 时已在上面处理
    // SELECT 中带 INTO OUTFILE
    if (first === 'SELECT' || first === 'WITH') {
      return /\bINTO\s+(OUTFILE|DUMPFILE)\b|\bFOR\s+UPDATE\b/.test(upper);
    }
    return true;
  }
  return false;
}

/** 是否单条自由 DML（走 executeDml） */
export function isFreeDmlSql(sql: string): boolean {
  const { first } = normalizeForCheck(sql);
  return first === 'INSERT' || first === 'UPDATE' || first === 'DELETE';
}

/** 确认框文案 */
export function describeSqlWriteRisk(sql: string): string {
  const { first } = normalizeForCheck(sql);
  const kind =
    first === 'UPDATE'
      ? 'UPDATE 更新'
      : first === 'DELETE'
        ? 'DELETE 删除'
        : first === 'DROP'
          ? 'DROP 删除对象'
          : first === 'TRUNCATE'
            ? 'TRUNCATE 清空表'
            : first === 'INSERT'
              ? 'INSERT 插入'
              : first === 'ALTER' || first === 'CREATE'
                ? `${first} 结构变更`
                : first
                  ? `${first} 写操作`
                  : '写操作';
  return `即将执行【${kind}】语句，可能修改或删除数据/结构。确认继续？`;
}
