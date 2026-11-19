/**
 * 「改变数据库」：读取并修改库级字符集、排序规则。
 *
 * MySQL 族的 ALTER DATABASE 只改以后新建对象的默认值，已有表和字段保持原样。
 * SQL Server 的库没有单独字符集，只能改默认排序规则；语句要在 master 上执行，
 * 否则目标库会被当前会话占用而改失败。
 * 字符集和排序规则会直接拼进 SQL，因此只接受字母、数字和下划线。
 *
 * @author yanch
 */
import { resolveDialectFamily, type SqlDialectFamily } from './dbTypes';

/** 未加引号拼进 DDL 的字符集 / 排序规则。 */
const CHARSET_TOKEN = /^[A-Za-z0-9_]+$/;

export interface DatabaseCharsetSetting {
  charset: string;
  collation: string;
}

/** MySQL 族改字符集和排序规则；SQL Server 只改排序规则。 */
export function supportsAlterDatabase(dbType?: null | string): boolean {
  const family = resolveDialectFamily(dbType);
  return family === 'MYSQL_LIKE' || family === 'SQLSERVER_LIKE';
}

/**
 * 字符集或排序规则不合法时返回原因；空字符串表示可以不填。
 */
export function charsetTokenError(value?: null | string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!CHARSET_TOKEN.test(text)) return '只能包含字母、数字和下划线';
  return '';
}

/** 查询当前库的字符集和排序规则。库名放在字符串字面量里。 */
export function buildDatabaseCharsetQuery(
  dbType: null | string | undefined,
  databaseName: string,
): string {
  const family = resolveDialectFamily(dbType);
  const name = databaseName.trim();
  if (!name || !supportsAlterDatabase(dbType)) return '';
  if (family === 'SQLSERVER_LIKE') {
    return `SELECT collation_name AS collation FROM sys.databases WHERE name = ${sqlStringLiteral(family, name)}`;
  }
  return (
    'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation ' +
    `FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${sqlStringLiteral(family, name)}`
  );
}

/** 从查询结果里取出字符集和排序规则；MySQL 统一成小写，方便和下拉项对齐。 */
export function readCharsetRow(
  dbType: null | string | undefined,
  row?: null | Record<string, unknown>,
): DatabaseCharsetSetting {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(row || {})) {
    values.set(key.toLowerCase(), value == null ? '' : String(value).trim());
  }
  let charset =
    values.get('charset') || values.get('default_character_set_name') || '';
  let collation =
    values.get('collation') ||
    values.get('default_collation_name') ||
    values.get('collation_name') ||
    '';
  if (resolveDialectFamily(dbType) === 'MYSQL_LIKE') {
    charset = charset.toLowerCase();
    collation = collation.toLowerCase();
  }
  return { charset, collation };
}

/**
 * 生成 ALTER DATABASE。字符集或排序规则不合法时返回空串，调用方不要执行。
 * 库名用各自的标识符引号，避免名称里的分号被拆成第二条语句。
 */
export function buildAlterDatabaseSql(
  dbType: null | string | undefined,
  databaseName: string,
  charset?: null | string,
  collation?: null | string,
): string {
  const family = resolveDialectFamily(dbType);
  const name = databaseName.trim();
  const characterSet = String(charset || '').trim();
  const collate = String(collation || '').trim();
  if (!name || !supportsAlterDatabase(dbType)) return '';
  if (charsetTokenError(characterSet) || charsetTokenError(collate)) return '';

  if (family === 'SQLSERVER_LIKE') {
    if (!collate) return '';
    return `ALTER DATABASE [${escapeBracket(name)}] COLLATE ${collate};`;
  }
  if (!characterSet && !collate) return '';
  const parts = [`ALTER DATABASE \`${escapeBacktick(name)}\``];
  if (characterSet) parts.push(`CHARACTER SET ${characterSet}`);
  if (collate) parts.push(`COLLATE ${collate}`);
  return `${parts.join(' ')};`;
}

/**
 * 执行 ALTER 时实际连上的库。
 * SQL Server 若仍连着被修改的库，会因库正在使用而失败，所以改连 master。
 */
export function alterDatabaseExecuteInstance(
  dbType: null | string | undefined,
  databaseName: string,
): string {
  if (resolveDialectFamily(dbType) === 'SQLSERVER_LIKE') return 'master';
  return databaseName.trim();
}

function escapeBacktick(name: string): string {
  return name.replaceAll('`', '``');
}

function escapeBracket(name: string): string {
  return name.replaceAll(']', ']]');
}

function sqlStringLiteral(family: SqlDialectFamily, value: string): string {
  if (family === 'SQLSERVER_LIKE') {
    return `N'${value.replaceAll("'", "''")}'`;
  }
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}
