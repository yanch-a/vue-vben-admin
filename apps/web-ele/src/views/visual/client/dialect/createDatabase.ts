/**
 * 按方言族拼「创建数据库 / Schema / 用户」SQL。
 * 选项尽量覆盖常用客户端能力；留空的字段不写入子句。
 *
 * @author yanch
 */
import type { SqlDialectFamily } from './dbTypes';

export interface CreateDatabaseForm {
  name: string;
  /** MySQL */
  charset?: string;
  collation?: string;
  ifNotExists?: boolean;
  /** PostgreSQL */
  owner?: string;
  encoding?: string;
  lcCollate?: string;
  lcCtype?: string;
  template?: string;
  tablespace?: string;
  connectionLimit?: null | number | undefined;
  /** Oracle / 达梦：创建用户 */
  password?: string;
  defaultTablespace?: string;
  temporaryTablespace?: string;
  quota?: string;
  grantConnect?: boolean;
  grantResource?: boolean;
  /** SQL Server */
  sqlServerCollation?: string;
  /** H2 */
  authorization?: string;
}

export interface CreateDatabaseStatement {
  /** 主语句（CREATE DATABASE / SCHEMA / USER） */
  sql: string;
  /** 主语句成功后追加执行（如 Oracle GRANT） */
  followUps?: string[];
  /** 表单标题 */
  title: string;
  /** 名称字段标签 */
  nameLabel: string;
}

function escBacktick(n: string) {
  return String(n || '').replaceAll('`', '``');
}
function escDouble(n: string) {
  return String(n || '').replaceAll('"', '""');
}
function escBracket(n: string) {
  return String(n || '').replaceAll(']', ']]');
}

/** MySQL 常用字符集 */
export const MYSQL_CHARSETS = [
  'utf8mb4',
  'utf8mb3',
  'utf8',
  'latin1',
  'gbk',
  'gb2312',
  'big5',
  'ascii',
  'binary',
] as const;

/** 字符集 → 常用排序规则 */
export const MYSQL_COLLATIONS: Record<string, string[]> = {
  utf8mb4: [
    'utf8mb4_general_ci',
    'utf8mb4_unicode_ci',
    'utf8mb4_0900_ai_ci',
    'utf8mb4_bin',
    'utf8mb4_unicode_520_ci',
  ],
  utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  gb2312: ['gb2312_chinese_ci', 'gb2312_bin'],
  big5: ['big5_chinese_ci', 'big5_bin'],
  ascii: ['ascii_general_ci', 'ascii_bin'],
  binary: ['binary'],
};

export const PG_ENCODINGS = [
  'UTF8',
  'LATIN1',
  'SQL_ASCII',
  'WIN1252',
  'EUC_CN',
  'GBK',
] as const;

export const PG_TEMPLATES = ['template0', 'template1'] as const;

export const SQLSERVER_COLLATIONS = [
  'Chinese_PRC_CI_AS',
  'Chinese_PRC_CS_AS',
  'SQL_Latin1_General_CP1_CI_AS',
  'Latin1_General_CI_AS',
  'Japanese_CI_AS',
] as const;

export function defaultCreateDatabaseForm(
  family: SqlDialectFamily,
): CreateDatabaseForm {
  switch (family) {
    case 'MYSQL_LIKE':
      return {
        name: '',
        charset: 'utf8mb4',
        collation: 'utf8mb4_general_ci',
        ifNotExists: true,
      };
    case 'POSTGRES_LIKE':
      return {
        name: '',
        encoding: 'UTF8',
        template: 'template0',
        connectionLimit: undefined,
      };
    case 'ORACLE_LIKE':
      return {
        name: '',
        password: '',
        defaultTablespace: 'USERS',
        temporaryTablespace: 'TEMP',
        quota: 'UNLIMITED',
        grantConnect: true,
        grantResource: true,
      };
    case 'SQLSERVER_LIKE':
      return {
        name: '',
        sqlServerCollation: '',
      };
    case 'H2_LIKE':
      return { name: '', authorization: '' };
    case 'SQLITE_LIKE':
    default:
      return { name: '' };
  }
}

export function createDatabaseMeta(family: SqlDialectFamily): {
  title: string;
  nameLabel: string;
  unsupportedHint?: string;
} {
  switch (family) {
    case 'MYSQL_LIKE':
      return { title: '创建数据库', nameLabel: '数据库名' };
    case 'POSTGRES_LIKE':
      return { title: '创建数据库', nameLabel: '数据库名' };
    case 'ORACLE_LIKE':
      return { title: '创建用户 / 模式', nameLabel: '用户名' };
    case 'SQLSERVER_LIKE':
      return { title: '创建数据库', nameLabel: '数据库名' };
    case 'H2_LIKE':
      return { title: '创建 Schema', nameLabel: 'Schema 名' };
    case 'SQLITE_LIKE':
      return {
        title: '创建数据库',
        nameLabel: '数据库名',
        unsupportedHint:
          'SQLite 一个文件即一个库，请通过「新建连接」指定新的数据库文件路径。',
      };
    default:
      return { title: '创建数据库', nameLabel: '名称' };
  }
}

/** 根据族与表单生成可执行语句（含 follow-up GRANT） */
export function buildCreateDatabaseStatements(
  family: SqlDialectFamily,
  form: CreateDatabaseForm,
): CreateDatabaseStatement {
  const meta = createDatabaseMeta(family);
  const name = form.name.trim();
  if (!name) {
    return { sql: '', title: meta.title, nameLabel: meta.nameLabel };
  }

  switch (family) {
    case 'MYSQL_LIKE':
      return {
        title: meta.title,
        nameLabel: meta.nameLabel,
        sql: buildMysql(form, name),
      };
    case 'POSTGRES_LIKE':
      return {
        title: meta.title,
        nameLabel: meta.nameLabel,
        sql: buildPostgres(form, name),
      };
    case 'ORACLE_LIKE':
      return buildOracle(form, name, meta);
    case 'SQLSERVER_LIKE':
      return {
        title: meta.title,
        nameLabel: meta.nameLabel,
        sql: buildSqlServer(form, name),
      };
    case 'H2_LIKE':
      return {
        title: meta.title,
        nameLabel: meta.nameLabel,
        sql: buildH2(form, name),
      };
    case 'SQLITE_LIKE':
    default:
      return {
        title: meta.title,
        nameLabel: meta.nameLabel,
        sql: '',
      };
  }
}

function buildMysql(form: CreateDatabaseForm, name: string): string {
  const q = `\`${escBacktick(name)}\``;
  const parts = [
    `CREATE DATABASE${form.ifNotExists ? ' IF NOT EXISTS' : ''} ${q}`,
  ];
  if (form.charset?.trim()) {
    parts.push(`CHARACTER SET ${form.charset.trim()}`);
  }
  if (form.collation?.trim()) {
    parts.push(`COLLATE ${form.collation.trim()}`);
  }
  return `${parts.join(' ')};`;
}

function buildPostgres(form: CreateDatabaseForm, name: string): string {
  const q = `"${escDouble(name)}"`;
  const clauses: string[] = [];
  if (form.owner?.trim()) {
    clauses.push(`OWNER = "${escDouble(form.owner.trim())}"`);
  }
  // TEMPLATE 须在 ENCODING/LC 之前；用 template0 才能自定义 encoding/locale
  if (form.template?.trim()) {
    clauses.push(`TEMPLATE = ${form.template.trim()}`);
  }
  if (form.encoding?.trim()) {
    clauses.push(`ENCODING = '${form.encoding.trim().replaceAll("'", "''")}'`);
  }
  if (form.lcCollate?.trim()) {
    clauses.push(
      `LC_COLLATE = '${form.lcCollate.trim().replaceAll("'", "''")}'`,
    );
  }
  if (form.lcCtype?.trim()) {
    clauses.push(`LC_CTYPE = '${form.lcCtype.trim().replaceAll("'", "''")}'`);
  }
  if (form.tablespace?.trim()) {
    clauses.push(`TABLESPACE = "${escDouble(form.tablespace.trim())}"`);
  }
  if (
    form.connectionLimit !== null &&
    form.connectionLimit !== undefined &&
    Number.isFinite(Number(form.connectionLimit))
  ) {
    clauses.push(`CONNECTION LIMIT = ${Number(form.connectionLimit)}`);
  }
  if (clauses.length === 0) {
    return `CREATE DATABASE ${q};`;
  }
  return `CREATE DATABASE ${q}\n  WITH\n    ${clauses.join('\n    ')};`;
}

function buildOracle(
  form: CreateDatabaseForm,
  name: string,
  meta: { title: string; nameLabel: string },
): CreateDatabaseStatement {
  const q = `"${escDouble(name)}"`;
  const pwd = (form.password || '').replaceAll('"', '""');
  const lines = [`CREATE USER ${q} IDENTIFIED BY "${pwd}"`];
  if (form.defaultTablespace?.trim()) {
    lines.push(
      `  DEFAULT TABLESPACE "${escDouble(form.defaultTablespace.trim())}"`,
    );
  }
  if (form.temporaryTablespace?.trim()) {
    lines.push(
      `  TEMPORARY TABLESPACE "${escDouble(form.temporaryTablespace.trim())}"`,
    );
  }
  if (form.quota?.trim()) {
    const quota = form.quota.trim().toUpperCase();
    const ts = form.defaultTablespace?.trim() || 'USERS';
    if (quota === 'UNLIMITED') {
      lines.push(`  QUOTA UNLIMITED ON "${escDouble(ts)}"`);
    } else {
      lines.push(`  QUOTA ${quota} ON "${escDouble(ts)}"`);
    }
  }
  const followUps: string[] = [];
  if (form.grantConnect) {
    followUps.push(`GRANT CONNECT TO ${q}`);
  }
  if (form.grantResource) {
    followUps.push(`GRANT RESOURCE TO ${q}`);
  }
  return {
    title: meta.title,
    nameLabel: meta.nameLabel,
    sql: `${lines.join('\n')};`,
    followUps,
  };
}

function buildSqlServer(form: CreateDatabaseForm, name: string): string {
  const q = `[${escBracket(name)}]`;
  if (form.sqlServerCollation?.trim()) {
    return `CREATE DATABASE ${q} COLLATE ${form.sqlServerCollation.trim()};`;
  }
  return `CREATE DATABASE ${q};`;
}

function buildH2(form: CreateDatabaseForm, name: string): string {
  const q = `"${escDouble(name)}"`;
  if (form.authorization?.trim()) {
    return `CREATE SCHEMA ${q} AUTHORIZATION "${escDouble(form.authorization.trim())}";`;
  }
  return `CREATE SCHEMA ${q};`;
}
