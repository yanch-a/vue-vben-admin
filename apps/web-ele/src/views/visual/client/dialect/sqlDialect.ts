/**
 * SQL 方言设计（前端）
 *
 * ## 结论：SQL 编辑器不需要按库拆多个 Vue 组件
 * Monaco 壳、快捷键、Tab、结果联动都相同；差异只在：
 * - 标识符引用 / 限行语法 / DDL 模板 / 字面量 / 补全触发字符
 * 因此采用「单 SqlEditor + resolveSqlDialect(dbType)」即可。
 *
 * ## 扩展策略：产品类型 → 方言族（Family）
 * 绝大多数国产/云数据库都兼容四大方言族之一，不必一开始就写全新 Handler：
 * - MYSQL_LIKE：MySQL、OceanBase(MySQL 模式)、TDSQL、PolarDB-MySQL
 * - POSTGRES_LIKE：PostgreSQL、人大金仓、GaussDB、PolarDB-PG
 * - ORACLE_LIKE：Oracle、达梦、OceanBase(Oracle 模式)
 * - SQLSERVER_LIKE：SQL Server
 *
 * 新库接入步骤：
 * 1. 在 PRODUCT_FAMILY_MAP 增加枚举码 → family
 * 2. 若 JDBC/元数据与族内差异大，再新增后端 *DataBaseOperateService
 * 3. 仅当对象树/权限模型特殊时，才新增独立 ObjectTree 组件
 *
 * @author yanch
 */

/** 方言族：决定 quote / LIMIT / 布尔字面量等核心语法 */
export type SqlDialectFamily =
  | 'MYSQL_LIKE'
  | 'POSTGRES_LIKE'
  | 'ORACLE_LIKE'
  | 'SQLSERVER_LIKE';

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
  return String(n || '').replace(/`/g, '``');
}
function escDouble(n: string) {
  return String(n || '').replace(/"/g, '""');
}
function escBracket(n: string) {
  return String(n || '').replace(/]/g, ']]');
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
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
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
  return `'${String(value).replace(/'/g, "''")}'`;
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
  appendLimit: (sql, limit) => `${sql.replace(/;?\s*$/, '')}\nLIMIT ${limit}`,
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
  appendLimit: (sql, limit) => `${sql.replace(/;?\s*$/, '')}\nLIMIT ${limit}`,
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
  dumpFkOptionLabel: '（Oracle/达梦：请手工 DISABLE CONSTRAINT，无 FOREIGN_KEY_CHECKS）',
  dumpUseOptionLabel: '包含 "ALTER SESSION SET CURRENT_SCHEMA"',
  instanceKind: 'schema',
  quoteIdent: (name) => `"${escDouble(name)}"`,
  qualifyTable: (schema, table) =>
    schema ? `"${escDouble(schema)}"."${escDouble(table)}"` : `"${escDouble(table)}"`,
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
      return `N'${v.replace(/'/g, "''")}'`;
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

const FAMILY_PROFILE: Record<SqlDialectFamily, SqlDialectProfile> = {
  MYSQL_LIKE,
  POSTGRES_LIKE,
  ORACLE_LIKE,
  SQLSERVER_LIKE,
};

/**
 * 产品类型码 → 方言族。
 * 新增国产/云库时优先只加映射；元数据差异大再写独立后端 Handler。
 */
const PRODUCT_FAMILY_MAP: Record<string, SqlDialectFamily> = {
  // 基础四件套
  MY_SQL: 'MYSQL_LIKE',
  POSTGRE_SQL: 'POSTGRES_LIKE',
  ORACLE: 'ORACLE_LIKE',
  SQL_SERVER: 'SQLSERVER_LIKE',
  // 国产
  DM: 'ORACLE_LIKE',
  DAMENG: 'ORACLE_LIKE',
  KINGBASE: 'POSTGRES_LIKE',
  KINGBASE_ES: 'POSTGRES_LIKE',
  OCEANBASE: 'MYSQL_LIKE',
  OCEANBASE_MYSQL: 'MYSQL_LIKE',
  OCEANBASE_ORACLE: 'ORACLE_LIKE',
  // 云原生
  GAUSSDB: 'POSTGRES_LIKE',
  TDSQL: 'MYSQL_LIKE',
  POLARDB: 'MYSQL_LIKE',
  POLARDB_MYSQL: 'MYSQL_LIKE',
  POLARDB_PG: 'POSTGRES_LIKE',
};

/** 归一化 dbType 字符串（兼容别名） */
export function normalizeDbTypeCode(dbType?: string | null): string {
  const raw = String(dbType || 'MY_SQL').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (raw.includes('POSTGRES') || raw === 'PG') return 'POSTGRE_SQL';
  if (raw.includes('SQLSERVER') || raw === 'MSSQL') return 'SQL_SERVER';
  if (raw.includes('MARIA')) return 'MY_SQL';
  if (raw.includes('达梦') || raw === 'DM' || raw.includes('DAMENG')) return 'DM';
  if (raw.includes('KINGBASE')) return 'KINGBASE';
  if (raw.includes('OCEANBASE') && raw.includes('ORACLE')) return 'OCEANBASE_ORACLE';
  if (raw.includes('OCEANBASE')) return 'OCEANBASE';
  if (raw.includes('GAUSS')) return 'GAUSSDB';
  if (raw.includes('TDSQL')) return 'TDSQL';
  if (raw.includes('POLAR') && (raw.includes('PG') || raw.includes('POSTGRE'))) {
    return 'POLARDB_PG';
  }
  if (raw.includes('POLAR')) return 'POLARDB_MYSQL';
  return raw;
}

export function resolveDialectFamily(dbType?: string | null): SqlDialectFamily {
  const code = normalizeDbTypeCode(dbType);
  return PRODUCT_FAMILY_MAP[code] || 'MYSQL_LIKE';
}

/** 解析完整方言配置（编辑器 / 模板 / 结果行 DML 统一入口） */
export function resolveSqlDialect(dbType?: string | null): SqlDialectProfile {
  return FAMILY_PROFILE[resolveDialectFamily(dbType)];
}

/** 对象树：MySQL 族用完整树，其余先 Generic（后续可按产品加专用树） */
export function useMysqlStyleObjectTree(dbType?: string | null): boolean {
  return resolveDialectFamily(dbType) === 'MYSQL_LIKE';
}
