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

import { resolveDbType, resolveDialectFamily } from './dbTypes';

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
   * PG 族：instance 是 database（连接层切换）；SQL 表落在 public。
   * qualifyTable 的 schema 参数若未传，默认 public，切勿把库名当 schema。
   */
  qualifyTable: (schema, table) => {
    const sch = schema && schema.trim() ? schema : 'public';
    return `"${escDouble(sch)}"."${escDouble(table)}"`;
  },
  selectAllLimited: (_database, table, limit) =>
    `SELECT * FROM "public"."${escDouble(table)}" LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: (v) => stdLiteral(v, 'truefalse'),
  createDatabaseSql: (name) => `CREATE DATABASE "${escDouble(name)}";`,
  dropDatabaseSql: (name) =>
    `-- 需连接到其它库执行\nDROP DATABASE "${escDouble(name)}";`,
  createTableStubSql: (_database, table) =>
    `CREATE TABLE "public"."${escDouble(table)}" (\n  id BIGSERIAL PRIMARY KEY\n);`,
  dropTableSql: (_database, table) =>
    `DROP TABLE IF EXISTS "public"."${escDouble(table)}" CASCADE;`,
  alterTableStubSql: (_database, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE "public"."${escDouble(table)}"\n  -- ADD COLUMN col_name VARCHAR(64) NULL;\n;`,
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
  qualifyTable: (schema, table) =>
    schema
      ? `"${escDouble(schema)}"."${escDouble(table)}"`
      : `"${escDouble(table)}"`,
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM "${escDouble(schema)}"."${escDouble(table)}" WHERE ROWNUM <= ${limit}`,
  appendLimit: (sql, limit) =>
    `SELECT * FROM (\n${sql.replace(/;?\s*$/, '')}\n) q WHERE ROWNUM <= ${limit}`,
  literal: (v) => stdLiteral(v, '01'),
  createDatabaseSql: (name) =>
    `-- Oracle/达梦：创建用户/Schema\n-- CREATE USER "${escDouble(name)}" IDENTIFIED BY password;\n-- GRANT CONNECT, RESOURCE TO "${escDouble(name)}";`,
  dropDatabaseSql: (name) =>
    `-- 危险操作：确认目标为用户/Schema\n-- DROP USER "${escDouble(name)}" CASCADE;`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE "${escDouble(schema)}"."${escDouble(table)}" (\n  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE "${escDouble(schema)}"."${escDouble(table)}" CASCADE CONSTRAINTS;`,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE "${escDouble(schema)}"."${escDouble(table)}"\n  -- ADD (col_name VARCHAR2(64) NULL);\n;`,
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
    schema
      ? `[${escBracket(schema)}].[dbo].[${escBracket(table)}]`
      : `[dbo].[${escBracket(table)}]`,
  selectAllLimited: (schema, table, limit) =>
    `SELECT TOP (${limit}) * FROM [${escBracket(schema)}].[dbo].[${escBracket(table)}]`,
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
    `CREATE TABLE [${escBracket(schema)}].[dbo].[${escBracket(table)}] (\n  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE IF EXISTS [${escBracket(schema)}].[dbo].[${escBracket(table)}];`,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE [${escBracket(schema)}].[dbo].[${escBracket(table)}]\n  -- ADD col_name NVARCHAR(64) NULL;\n;`,
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
  alterTableStubSql: (_schema, table) =>
    `-- SQLite 的 ALTER 仅支持重命名与加列\nALTER TABLE "${escDouble(table)}"\n  -- ADD COLUMN col_name TEXT;\n;`,
};

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
  qualifyTable: (schema, table) => {
    const sch = schema && schema.trim() ? schema.toUpperCase() : 'PUBLIC';
    return `"${escDouble(sch)}"."${escDouble(table)}"`;
  },
  selectAllLimited: (schema, table, limit) =>
    `SELECT * FROM "${escDouble((schema || 'PUBLIC').toUpperCase())}"."${escDouble(table)}" LIMIT ${limit}`,
  appendLimit: appendLimitKeyword,
  literal: (v) => stdLiteral(v, 'truefalse'),
  createDatabaseSql: (name) => `CREATE SCHEMA "${escDouble(name)}";`,
  dropDatabaseSql: (name) => `DROP SCHEMA "${escDouble(name)}" CASCADE;`,
  createTableStubSql: (schema, table) =>
    `CREATE TABLE "${escDouble((schema || 'PUBLIC').toUpperCase())}"."${escDouble(table)}" (\n  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY\n);`,
  dropTableSql: (schema, table) =>
    `DROP TABLE IF EXISTS "${escDouble((schema || 'PUBLIC').toUpperCase())}"."${escDouble(table)}" CASCADE;`,
  alterTableStubSql: (schema, table) =>
    `-- 改变表结构（请按需修改）\nALTER TABLE "${escDouble((schema || 'PUBLIC').toUpperCase())}"."${escDouble(table)}"\n  -- ADD COLUMN col_name VARCHAR(64) NULL;\n;`,
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
