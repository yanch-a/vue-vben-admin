/**
 * SQL 格式化（基于 sql-formatter，按连接方言族选择 language）
 *
 * @author yanch
 */
import { format } from 'sql-formatter';

import { resolveSqlDialect, type SqlDialectFamily } from '../dialect/sqlDialect';

/** sql-formatter 支持的语言标识 */
type FormatterLanguage =
  | 'mariadb'
  | 'mysql'
  | 'plsql'
  | 'postgresql'
  | 'sql'
  | 'sqlite'
  | 'transactsql';

const FAMILY_LANGUAGE: Record<SqlDialectFamily, FormatterLanguage> = {
  MYSQL_LIKE: 'mysql',
  POSTGRES_LIKE: 'postgresql',
  ORACLE_LIKE: 'plsql',
  SQLSERVER_LIKE: 'transactsql',
  SQLITE_LIKE: 'sqlite',
  // sql-formatter 无 H2 专属规则，标准 SQL 最接近
  H2_LIKE: 'sql',
};

/**
 * 按当前数据源方言格式化一段 SQL。
 * 失败时抛出，由调用方决定是否提示用户。
 */
export function formatSqlByDialect(sql: string, dbType?: string): string {
  const raw = (sql || '').trim();
  if (!raw) return '';

  const dialect = resolveSqlDialect(dbType);
  const language = FAMILY_LANGUAGE[dialect.family] || 'sql';

  // 原语句末尾若有分号，格式化后保留，避免多语句编辑时丢分隔符
  const hadTrailingSemi = /;\s*$/.test(raw);
  const input = hadTrailingSemi ? raw.replace(/;\s*$/, '').trim() : raw;

  const formatted = format(input, {
    language,
    tabWidth: 2,
    useTabs: false,
    keywordCase: 'upper',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    // 与 Monaco tabSize=2 对齐，可读性优先
    expressionWidth: 80,
    linesBetweenQueries: 1,
  });

  const out = formatted.trimEnd();
  if (hadTrailingSemi) {
    return `${out};`;
  }
  return out;
}
