/** SQL 顶层关键词扫描：忽略注释、字符串、引用标识符与括号内部内容。
 * 保留位置用于切分外层 SELECT，避免将 CTE 或标量子查询的 FROM 当作目标表。
 * @author yanch
 */
export function topLevelWords(sql: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    const c = sql[i]!;
    if (sql.startsWith('--', i) || c === '#') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; continue; }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\' && c === "'") { i += 2; continue; }
        if (sql[i++] === close) { if (sql[i] === close) i++; else break; }
      }
      continue;
    }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth--; i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i]!)) i++;
      if (depth === 0) out.push({ word: sql.slice(start, i).toUpperCase(), start, end: i });
      continue;
    }
    i++;
  }
  return out;
}
