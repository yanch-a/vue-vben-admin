/**
 * SQL 写操作 / 危险语句检测（前端确认框用，与后端 SqlReadOnlyValidator 对齐思路）
 * @author yanch
 */

/** 去掉注释后取首关键字与全文大写文本 */
/** 去掉注释后取首关键字与全文大写文本；扫描关键字时忽略字符串字面量 */
function normalizeForCheck(sql: string): { first: string; upper: string } {
  const raw = String(sql || '').trim();
  let s = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .replace(/^[ \t]*#[^\n]*$/gm, ' ')
    .trim();
  if (s.endsWith(';')) s = s.slice(0, -1).trim();
  const masked = s.replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`[^`]*`)/g, ' ');
  const upper = masked.toUpperCase();
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
  'RENAME',
  'COMMENT',
  'REFRESH',
  'OPTIMIZE',
  'ANALYZE',
  'REPAIR',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
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

/** 是否单条自由 DML（走 executeDml）：行数据写入，不含 DDL */
export function isFreeDmlSql(sql: string): boolean {
  const { first, upper } = normalizeForCheck(sql);
  if (
    first === 'INSERT' ||
    first === 'UPDATE' ||
    first === 'DELETE' ||
    first === 'REPLACE' ||
    first === 'MERGE'
  ) {
    return true;
  }
  // WITH ... INSERT/UPDATE/DELETE：CTE 写入走 DML，不能落到只读 executeSql
  return first === 'WITH' && /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/.test(upper);
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
              : first === 'REPLACE'
                ? 'REPLACE 覆盖写入'
                : first === 'MERGE'
                  ? 'MERGE 合并写入'
                  : first === 'RENAME'
                    ? 'RENAME 重命名'
                    : first === 'REVOKE'
                      ? 'REVOKE 收回权限'
                      : first === 'ALTER' || first === 'CREATE'
                        ? `${first} 结构变更`
                        : first
                          ? `${first} 写操作`
                          : '写操作';
  return `即将执行【${kind}】语句，可能修改或删除数据/结构。确认继续？`;
}

/** 是否为 Lemon 客户端策略/授权报错（不是目标库语法错误） */
export function isClientPolicyError(message: string): boolean {
  const s = String(message || '');
  if (!s) return false;
  return [
    '仅允许执行 SELECT',
    '仅允许执行单条',
    '不支持多语句',
    '仅允许单条 SQL',
    '禁止的写操作',
    '危险关键字',
    '无权新增或修改数据',
    '无权修改表结构',
    '无权执行建库',
    '需要连接管理权限',
    '无权使用该数据库连接',
    '无权使用该连接',
    '仅允许 INSERT',
    '仅允许受控 DDL',
  ].some((token) => s.includes(token));
}

/** 「问 AI」预填：策略报错走说明通道，库报错才修语法 */
export function askAiPrefillForError(message: string): string {
  return isClientPolicyError(message)
    ? '刚才的报错是客户端执行限制，不是 SQL 语法错误。请按系统规则告诉我该怎么处理。'
    : '请根据报错修复 SQL。';
}
