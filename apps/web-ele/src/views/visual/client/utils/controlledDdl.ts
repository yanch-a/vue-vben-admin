/**
 * 判断当前编辑器 SQL 是否应走受控 DDL/CALL（executeDdl）而非只读 executeSql
 * @author yanch
 */
export function looksLikeControlledDdl(sql: string): boolean {
  const raw = String(sql || '').trim();
  if (!raw) return false;

  // 粗去掉块/行注释，避免前导注释干扰首关键字
  let s = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .replace(/^[ \t]*#[^\n]*$/gm, ' ')
    .replace(/^[ \t]*DELIMITER\s+\S+[ \t]*$/gim, ' ')
    .trim();
  if (!s) return false;

  return /^(CREATE\s+(OR\s+REPLACE\s+|OR\s+ALTER\s+)?(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|ALIAS|DATABASE|SCHEMA|USER)\b|DROP\s+(IF\s+EXISTS\s+)?(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|ALIAS|TABLE|DATABASE|SCHEMA)\b|ALTER\s+(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b|GRANT\b|CALL\b|EXEC\b|EXECUTE\b)/i.test(
    s,
  );
}

export function isDestructiveDdl(sql: string): boolean {
  const s = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .trim();
  return /^\s*DROP\b/i.test(s);
}
