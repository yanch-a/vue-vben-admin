/**
 * 判断当前编辑器 SQL 是否应走受控 DDL/CALL（executeDdl）而非只读 executeSql。
 * 需与后端 SqlDdlValidator 允许范围对齐。
 * @author yanch
 */

/** 去掉块/行注释与 MySQL DELIMITER 行，避免干扰首关键字 */
function stripSqlNoise(sql: string): string {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--[^\n]*$/gm, ' ')
    .replace(/^[ \t]*#[^\n]*$/gm, ' ')
    .replace(/^[ \t]*DELIMITER\s+\S+[ \t]*$/gim, ' ')
    .trim();
}

/**
 * 表/库/索引/序列/物化视图及维护类语句；与 SqlDdlValidator 白名单对齐。
 * LOAD DATA / DROP USER / SET / 事务控制不在此放行。
 */
const CONTROLLED_DDL_HEAD =
  /^(CREATE\s+(OR\s+REPLACE\s+)?((GLOBAL\s+)?(TEMPORARY|TEMP)\s+|UNLOGGED\s+)?TABLE\b|CREATE\s+(OR\s+REPLACE\s+|OR\s+ALTER\s+)?(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|ALIAS|DATABASE|SCHEMA|USER|SEQUENCE|TYPE)\b|CREATE\s+(OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b|CREATE\s+(UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?INDEX\b|DROP\s+(TEMPORARY\s+)?TABLE\b|DROP\s+(IF\s+EXISTS\s+)?(VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|ALIAS|TABLE|DATABASE|SCHEMA|INDEX|SEQUENCE|TYPE)\b|DROP\s+(IF\s+EXISTS\s+)?MATERIALIZED\s+VIEW\b|ALTER\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT|INDEX|DATABASE|SCHEMA|USER|SEQUENCE|TYPE)\b|ALTER\s+MATERIALIZED\s+VIEW\b|TRUNCATE\s+(TABLE\s+)?|RENAME\b|REVOKE\b|GRANT\b|COMMENT\s+ON\b|REFRESH\s+MATERIALIZED\s+VIEW\b|OPTIMIZE(\s+TABLE)?\b|ANALYZE(\s+TABLE)?\b|REPAIR\s+TABLE\b|CHECK\s+TABLE\b|VACUUM\b|REINDEX\b|CLUSTER\b|CALL\b|EXEC\b|EXECUTE\b)/i;

export function looksLikeControlledDdl(sql: string): boolean {
  const s = stripSqlNoise(sql);
  if (!s) return false;
  return CONTROLLED_DDL_HEAD.test(s);
}

export function isDestructiveDdl(sql: string): boolean {
  const s = stripSqlNoise(sql);
  return /^\s*(DROP|TRUNCATE|REVOKE)\b/i.test(s);
}
