/**
 * SQL 方言设计（前端）
 *
 * ## 结论：SQL 编辑器不需要按库拆多个 Vue 组件
 * Monaco 壳、快捷键、Tab、结果联动都相同；差异只在：
 * - 标识符引用 / 限行语法 / DDL 模板 / 字面量 / 补全触发字符
 * 因此采用「单 SqlEditor + resolveSqlDialect(dbType)」即可。
 *
 * ## 与 dbTypes.ts 的分工
 * - dbTypes.ts：产品 → 方言族 / 连接形态 / 对象树能力（新增数据库改这里）
 * - 本文件：族 → 具体语法（新增语法族才改这里）
 *
 * @author yanch
 */

import type { SqlDialectFamily } from './dbTypes';

import {
  normalizeDbTypeCode,
  resolveDbType,
  resolveDialectFamily,
} from './dbTypes';

export type { SqlDialectFamily } from './dbTypes';
export {
  normalizeDbTypeCode,
  resolveCapabilities,
  resolveDialectFamily,
} from './dbTypes';

export interface SqlDialectProfile {
  family: SqlDialectFamily;
  /** 展示名 */
  label: string;
  /** Monaco 补全触发字符 */
  completionTriggers: string[];
  /** 行注释前缀（补全/提示用） */
  lineComment: string;
  /** dump 对话框：关闭外键检查类选项的文案 */
  dumpFkOptionLabel: string;
  /** dump：切换库/schema 选项文案 */
  dumpUseOptionLabel: string;
  quoteIdent(name: string): string;
  qualifyTable(schema: string | undefined, table: string): string;
  /** SELECT * 并限行（打开表 / 导出） */
  selectAllLimited(schema: string, table: string, limit: number): string;
  /** 追加限行（已有 SQL 末尾）——简单场景 */
  appendLimit(sql: string, limit: number): string;
  literal(value: unknown): string;
  createDatabaseSql(name: string): string;
  dropDatabaseSql(name: string): string;
  createTableStubSql(schema: string, table: string): string;
  dropTableSql(schema: string, table: string): string;
  /**
   * 清空表数据、保留结构。
   * 多数库用 TRUNCATE；SQLite 无 TRUNCATE，返回 DELETE FROM。
   */
  truncateTableSql(schema: string, table: string): string;
  /** SQLite 等只能 DELETE，需走 executeDml；其余 TRUNCATE 走 executeDdl */
  truncateViaDml: boolean;
  alterTableStubSql(schema: string, table: string): string;
  /** 实例节点语义：database / schema */
  instanceKind: 'database' | 'schema';
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

function mysqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `'${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}'`;
  }
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

function stdLiteral(value: unknown, boolStyle: '01' | 'truefalse'): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') {
    if (boolStyle === 'truefalse') return value ? 'TRUE' : 'FALSE';
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `'${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}'`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** LIMIT 系方言共用的尾部追加 */
function appendLimitKeyword(sql: string, limit: number): string {
  return `${sql.replace(/;?\s*$/, '')}\nLIMIT ${limit}`;
}

function firstNonBlank(...vals: Array<string | undefined>): string {
  for (const v of vals) {
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** PG 族：SQL schema，默认 public。切勿把数据库名写进来。 */
function pgSchemaName(schema?: string) {
  return firstNonBlank(schema, 'public');
}

/** SQL Server：表所在 schema，默认 dbo。切勿把库名写进来。 */
function ssSchemaName(schema?: string) {
  return firstNonBlank(schema, 'dbo');
}

/** Oracle/达梦：有 schema 才写成 "schema"."table"，避免空引号或把服务名硬拼进去。 */
function oracleQualify(schema: string | undefined, table: string) {
  const sch = (schema || '').trim();
  const tbl = `"${escDouble(table)}"`;
  return sch ? `"${escDouble(sch)}".${tbl}` : tbl;
}

/** 把 schema.table 展示名拆开；没有点则整段当表名。 */
function splitSchemaTable(name: string): { schema: string; table: string } {
  const raw = String(name || '').trim();
  const dot = raw.indexOf('.');
  if (dot > 0 && dot < raw.length - 1) {
    return { schema: raw.slice(0, dot), table: raw.slice(dot + 1) };
  }
  return { schema: '', table: raw };
}

export interface TableIdentInput {
  instanceName?: string;
  schemaName?: string;
  tableName: string;
}

export interface TableIdent {
  /** SQL 里引用的 schema（MySQL 则是库名） */
  schema: string;
  table: string;
}

/**
 * 对象树节点 → SQL 限定名用的 schema + 裸表名。
 * instance 含义：MySQL/PG/SS=库，H2/达梦=schema，Oracle=服务名（连接级数据库，不能当 schema）。
 */
export function resolveTableIdent(
  dbType: string | undefined | null,
  input: TableIdentInput,
): TableIdent {
  const family = resolveDialectFamily(dbType);
  const split = splitSchemaTable(input.tableName);
  const schemaName = (input.schemaName || '').trim();
  const instanceName = (input.instanceName || '').trim();
  const table = split.table || String(input.tableName || '').trim();

  switch (family) {
    case 'MYSQL_LIKE':
      return { schema: firstNonBlank(instanceName, schemaName), table };
    case 'POSTGRES_LIKE':
      return {
        schema: firstNonBlank(schemaName, split.schema, 'public'),
        table,
      };
    case 'SQLSERVER_LIKE':
      return { schema: firstNonBlank(schemaName, split.schema, 'dbo'), table };
    case 'SQLITE_LIKE':
      return { schema: '', table };
    case 'H2_LIKE':
      // 实例就是 schema；优先树上的实例名（DATABASE_TO_LOWER 下是 public）
      return {
        schema: firstNonBlank(instanceName, schemaName, split.schema, 'PUBLIC'),
        table,
      };
    case 'ORACLE_LIKE': {
      const code = normalizeDbTypeCode(dbType);
      // 达梦一级节点就是用户；Oracle 一级节点是服务名，必须用表上的 schemaName
      if (code === 'DM') {
        return {
          schema: firstNonBlank(schemaName, split.schema, instanceName),
          table,
        };
      }
      return { schema: firstNonBlank(schemaName, split.schema), table };
    }
    default:
      return {
        schema: firstNonBlank(schemaName, instanceName, split.schema),
        table,
      };
  }
}

const MYSQL_LIKE: SqlDialectProfile = {
  family: 'MYSQL_LIKE',
  label: 'MySQL-like',
  completionTriggers: ['.', ' ', '`'],
  lineComment: '--',
  dumpFkOptionLabel: '设置 FOREIGN_KEY_CHECKS=0',
  dumpUseOptionLabel: '包含 "USE database" 语句',
  instanceKind: 'database',
  quoteIdent: (name) => `\`${escBacktick(name)}\``,
  qualifyTable: (schema, table) =>
    schema
      ? `\`${escBacktick(schema)}\`.\`${escBacktick(table)}\``
      : `\`${escBacktick(table)}\``,
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM \`${escBacktick(schema)}\`.\`${escBacktick(table)}\` LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: mysqlLiteral,
  createDatabaseSql: (name) =>
    `CREATE DATABASE \`${escBacktick(name)}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`,
  dropDatabaseSql: (name) => `DROP DATABASE \`${escBacktick(name)}\`;`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE \`${escBacktick(schema)}\`.\`${escBacktick(table)}\` (\n  id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',\n  PRIMARY KEY (id)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  dropTableSql: (schema, table) =>
    `DROP TABLE \`${escBacktick(schema)}\`.\`${escBacktick(table)}\`;`,
  truncateTableSql: (schema, table) =>
    `TRUNCATE TABLE \`${escBacktick(schema)}\`.\`${escBacktick(table)}\`;`,
  truncateViaDml: false,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE \`${escBacktick(schema)}\`.\`${escBacktick(table)}\`\n  -- ADD COLUMN col_name VARCHAR(64) NULL COMMENT '';\n;`,
};

const POSTGRES_LIKE: SqlDialectProfile = {
  family: 'POSTGRES_LIKE',
  label: 'PostgreSQL-like',
  completionTriggers: ['.', ' ', '"'],
  lineComment: '--',
  dumpFkOptionLabel: '设置 session_replication_role=replica（近似关闭触发器）',
  dumpUseOptionLabel: '包含 "SET search_path TO public"',
  instanceKind: 'database',
  quoteIdent: (name) => `"${escDouble(name)}"`,
  /**
   * PG 族：instance 是 database（连接层切换）；表在 schema 下，默认 public。
   * qualifyTable 的第一参是 schema，切勿把库名传进来。
   */
  qualifyTable: (schema, table) =>
    `"${escDouble(pgSchemaName(schema))}"."${escDouble(table)}"`,
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM "${escDouble(pgSchemaName(schema))}"."${escDouble(table)}" LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: (v) => stdLiteral(v, 'truefalse'),
  createDatabaseSql: (name) => `CREATE DATABASE "${escDouble(name)}";`,
  dropDatabaseSql: (name) =>
    `-- 需连接到其它库执行\nDROP DATABASE "${escDouble(name)}";`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE "${escDouble(pgSchemaName(schema))}"."${escDouble(table)}" (\n  id BIGSERIAL PRIMARY KEY\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE IF EXISTS "${escDouble(pgSchemaName(schema))}"."${escDouble(table)}" CASCADE;`,
  // 不清 CASCADE，避免把有外键的子表一并清空
  truncateTableSql: (schema, table) =>
    `TRUNCATE TABLE "${escDouble(pgSchemaName(schema))}"."${escDouble(table)}" RESTART IDENTITY;`,
  truncateViaDml: false,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE "${escDouble(pgSchemaName(schema))}"."${escDouble(table)}"\n  -- ADD COLUMN col_name VARCHAR(64) NULL;\n;`,
};

const ORACLE_LIKE: SqlDialectProfile = {
  family: 'ORACLE_LIKE',
  label: 'Oracle-like',
  completionTriggers: ['.', ' ', '"'],
  lineComment: '--',
  dumpFkOptionLabel:
    '（Oracle/达梦：请手工 DISABLE CONSTRAINT，无 FOREIGN_KEY_CHECKS）',
  dumpUseOptionLabel: '包含 "ALTER SESSION SET CURRENT_SCHEMA"',
  instanceKind: 'schema',
  quoteIdent: (name) => `"${escDouble(name)}"`,
  qualifyTable: (schema, table) => oracleQualify(schema, table),
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM ${oracleQualify(schema, table)} WHERE ROWNUM <= ${limit}`,
  appendLimit: (sql, limit) =>
    `SELECT * FROM (\n${sql.replace(/;?\s*$/, '')}\n) q WHERE ROWNUM <= ${limit}`,
  literal: (v) => stdLiteral(v, '01'),
  createDatabaseSql: (name) =>
    `-- Oracle/达梦：创建用户/Schema\n-- CREATE USER "${escDouble(name)}" IDENTIFIED BY password;\n-- GRANT CONNECT, RESOURCE TO "${escDouble(name)}";`,
  dropDatabaseSql: (name) =>
    `-- 危险操作：确认目标为用户/Schema\n-- DROP USER "${escDouble(name)}" CASCADE;`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE ${oracleQualify(schema, table)} (\n  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n  name VARCHAR2(64)\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE ${oracleQualify(schema, table)} CASCADE CONSTRAINTS;`,
  truncateTableSql: (schema, table) =>
    `TRUNCATE TABLE ${oracleQualify(schema, table)};`,
  truncateViaDml: false,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE ${oracleQualify(schema, table)}\n  -- ADD (col_name VARCHAR2(64) NULL);\n;`,
};

const SQLSERVER_LIKE: SqlDialectProfile = {
  family: 'SQLSERVER_LIKE',
  label: 'SQL Server-like',
  completionTriggers: ['.', ' ', '['],
  lineComment: '--',
  dumpFkOptionLabel: 'NOCHECK CONSTRAINT（近似关闭外键检查）',
  dumpUseOptionLabel: '包含 "USE [database]" 语句',
  instanceKind: 'database',
  quoteIdent: (name) => `[${escBracket(name)}]`,
  qualifyTable: (schema, table) =>
    `[${escBracket(ssSchemaName(schema))}].[${escBracket(table)}]`,
  selectAllLimited: (schema, table, limit) =>
    `SELECT TOP (${limit}) * FROM [${escBracket(ssSchemaName(schema))}].[${escBracket(table)}]`,
  appendLimit: (sql, limit) => {
    // 简单场景：若以 SELECT 开头插入 TOP
    const trimmed = sql.replace(/;?\s*$/, '').trim();
    if (/^SELECT\s+/i.test(trimmed) && !/^SELECT\s+TOP\s*\(/i.test(trimmed)) {
      return trimmed.replace(/^SELECT\s+/i, `SELECT TOP (${limit}) `);
    }
    return trimmed;
  },
  literal: (v) => {
    if (typeof v === 'string') {
      return `N'${v.replaceAll("'", "''")}'`;
    }
    return stdLiteral(v, '01');
  },
  createDatabaseSql: (name) => `CREATE DATABASE [${escBracket(name)}];`,
  dropDatabaseSql: (name) => `DROP DATABASE [${escBracket(name)}];`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE [${escBracket(ssSchemaName(schema))}].[${escBracket(table)}] (\n  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,\n  name NVARCHAR(64) NULL\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE IF EXISTS [${escBracket(ssSchemaName(schema))}].[${escBracket(table)}];`,
  truncateTableSql: (schema, table) =>
    `TRUNCATE TABLE [${escBracket(ssSchemaName(schema))}].[${escBracket(table)}];`,
  truncateViaDml: false,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE [${escBracket(ssSchemaName(schema))}].[${escBracket(table)}]\n  -- ADD col_name NVARCHAR(64) NULL;\n;`,
};

/**
 * SQLite：单文件单命名空间，表名不能加库前缀（会被当成 attached database）。
 */
const SQLITE_LIKE: SqlDialectProfile = {
  family: 'SQLITE_LIKE',
  label: 'SQLite',
  completionTriggers: ['.', ' ', '"'],
  lineComment: '--',
  dumpFkOptionLabel: '设置 PRAGMA foreign_keys=OFF',
  dumpUseOptionLabel: '（SQLite 单库，无需切换语句）',
  instanceKind: 'database',
  quoteIdent: (name) => `"${escDouble(name)}"`,
  qualifyTable: (_schema, table) => `"${escDouble(table)}"`,
  selectAllLimited: (_schema, table, limit) =>
    `SELECT * FROM "${escDouble(table)}" LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: (v) => stdLiteral(v, '01'),
  createDatabaseSql: () =>
    `-- SQLite 一个文件即一个库，新建库请创建新的连接并指定文件路径`,
  dropDatabaseSql: () => `-- SQLite 删除库 = 删除数据库文件，请在文件系统中操作`,
  createTableStubSql: (_schema, table) =>
    `CREATE TABLE "${escDouble(table)}" (\n  id INTEGER PRIMARY KEY AUTOINCREMENT\n);`,
  dropTableSql: (_schema, table) =>
    `DROP TABLE IF EXISTS "${escDouble(table)}";`,
  // SQLite 没有 TRUNCATE，只能 DELETE；自增计数在 sqlite_sequence，此处不额外清
  truncateTableSql: (_schema, table) =>
    `DELETE FROM "${escDouble(table)}";`,
  truncateViaDml: true,
  alterTableStubSql: (_schema, table) =>
    `-- SQLite 的 ALTER 仅支持重命名与加列\nALTER TABLE "${escDouble(table)}"\n  -- ADD COLUMN col_name TEXT;\n;`,
};

/**
 * H2 schema 必须保持对象树/JDBC 返回的原样大小写。
 * Regular 默认是 PUBLIC；DATABASE_TO_LOWER / PG 模式是 public。
 * 加双引号后大小写敏感，不能再 toUpperCase。
 */
function h2SchemaName(schema?: string) {
  const s = (schema || '').trim();
  return s || 'PUBLIC';
}

/**
 * H2：实例节点是 schema（库由 jdbcUrl 决定，连接内无法切换）。
 */
const H2_LIKE: SqlDialectProfile = {
  family: 'H2_LIKE',
  label: 'H2',
  completionTriggers: ['.', ' ', '"'],
  lineComment: '--',
  dumpFkOptionLabel: '设置 REFERENTIAL_INTEGRITY FALSE',
  dumpUseOptionLabel: '包含 "SET SCHEMA" 语句',
  instanceKind: 'schema',
  quoteIdent: (name) => `"${escDouble(name)}"`,
  qualifyTable: (schema, table) =>
    `"${escDouble(h2SchemaName(schema))}"."${escDouble(table)}"`,
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM "${escDouble(h2SchemaName(schema))}"."${escDouble(table)}" LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: (v) => stdLiteral(v, 'truefalse'),
  createDatabaseSql: (name) => `CREATE SCHEMA "${escDouble(name)}";`,
  dropDatabaseSql: (name) => `DROP SCHEMA "${escDouble(name)}" CASCADE;`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE "${escDouble(h2SchemaName(schema))}"."${escDouble(table)}" (\n  ID BIGINT NOT NULL AUTO_INCREMENT,\n  NAME VARCHAR(64),\n  PRIMARY KEY (ID)\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE IF EXISTS "${escDouble(h2SchemaName(schema))}"."${escDouble(table)}" CASCADE;`,
  truncateTableSql: (schema, table) =>
    `TRUNCATE TABLE "${escDouble(h2SchemaName(schema))}"."${escDouble(table)}";`,
  truncateViaDml: false,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE "${escDouble(h2SchemaName(schema))}"."${escDouble(table)}"\n  -- ADD COLUMN col_name VARCHAR(64) NULL;\n;`,
};

const FAMILY_PROFILE: Record<SqlDialectFamily, SqlDialectProfile> = {
  MYSQL_LIKE,
  POSTGRES_LIKE,
  ORACLE_LIKE,
  SQLSERVER_LIKE,
  SQLITE_LIKE,
  H2_LIKE,
};

/** 解析完整方言配置（编辑器 / 模板 / 结果行 DML 统一入口） */
export function resolveSqlDialect(dbType?: null | string): SqlDialectProfile {
  return FAMILY_PROFILE[resolveDialectFamily(dbType)];
}

/** 对象树一级节点的界面称呼，随产品在「数据库 / 模式」间切换 */
export function instanceKindLabel(dbType?: null | string): string {
  return resolveDbType(dbType).instanceKind === 'SCHEMA' ? '模式' : '数据库';
}
