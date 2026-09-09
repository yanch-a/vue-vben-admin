/**
 * 查询结果行 → INSERT / UPDATE / DELETE SQL 生成
 * 标识符与字面量统一走 resolveSqlDialect(dbType)，避免各库硬编码。
 *
 * @author yanch
 */
import { resolveDialectFamily, resolveSqlDialect } from '../dialect/sqlDialect';

export interface TableRef {
  /** 两段名时的 schema；三段名时是中间段（SQL Server 的 schema） */
  schema?: string;
  table: string;
}

const IDENT =
  '(?:`([^`]+)`|"([^"]+)"|\\[([^\\]]+)\\]|([\\p{L}_][\\p{L}\\p{N}_$#]*))';

function pickIdent(m: RegExpMatchArray, offset: number): string | undefined {
  return m[offset] || m[offset + 1] || m[offset + 2] || m[offset + 3] || undefined;
}

/** 从 SELECT SQL 解析主表（简单 FROM，支持 schema.table / db.schema.table） */
export function parseTableFromSql(sql: string): TableRef | null {
  if (!sql) return null;
  const cleaned = sql
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');
  const m = cleaned.match(
    new RegExp(
      `\\bFROM\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?(?:\\s*\\.\\s*${IDENT})?`,
      'iu',
    ),
  );
  if (!m) return null;
  const a = pickIdent(m, 1);
  const b = pickIdent(m, 5);
  const c = pickIdent(m, 9);
  if (a && b && c) {
    // db.schema.table → 用 schema.table，库名由当前连接实例决定
    return { schema: b, table: c };
  }
  if (a && b) return { schema: a, table: b };
  if (a) return { table: a };
  return null;
}

/**
 * 拉表元数据时用的表名：PG/SS/H2 非默认 schema 写成 schema.table；
 * MySQL 的 FROM db.t 里 db 是实例不是 schema。
 */
export function metadataTableName(
  ref: TableRef,
  dbType?: string | null,
): string {
  const family = resolveDialectFamily(dbType);
  if (!ref.schema) {
    return ref.table;
  }
  if (family === 'MYSQL_LIKE' || family === 'ORACLE_LIKE' || family === 'SQLITE_LIKE') {
    return ref.table;
  }
  const def = family === 'SQLSERVER_LIKE' ? 'dbo' : 'public';
  if (ref.schema.toLowerCase() === def.toLowerCase()) {
    return ref.table;
  }
  return `${ref.schema}.${ref.table}`;
}

export function quoteIdent(name: string, dbType = 'MY_SQL'): string {
  return resolveSqlDialect(dbType).quoteIdent(name);
}

export function quoteTable(ref: TableRef, dbType = 'MY_SQL'): string {
  return resolveSqlDialect(dbType).qualifyTable(ref.schema, ref.table);
}

/** SQL 字面量（按方言） */
export function sqlLiteral(value: unknown, dbType = 'MY_SQL'): string {
  return resolveSqlDialect(dbType).literal(value);
}

function buildWhere(
  row: Record<string, any>,
  columns: string[],
  whereColumns: string[],
  dbType: string,
): string {
  const d = resolveSqlDialect(dbType);
  const keys = (whereColumns.length ? whereColumns : columns).filter((c) =>
    Object.prototype.hasOwnProperty.call(row, c),
  );
  if (!keys.length) {
    throw new Error('无法构建 WHERE：没有可用字段');
  }
  return keys
    .map((col) => {
      const v = row[col];
      if (v === null || v === undefined) {
        return `${d.quoteIdent(col)} IS NULL`;
      }
      return `${d.quoteIdent(col)} = ${d.literal(v)}`;
    })
    .join(' AND ');
}

/** 生成 INSERT */
export function buildInsertSql(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
  dbType = 'MY_SQL',
): string {
  const d = resolveSqlDialect(dbType);
  const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
  const colList = cols.map((c) => d.quoteIdent(c)).join(', ');
  const valList = cols.map((c) => d.literal(row[c])).join(', ');
  return `INSERT INTO ${d.qualifyTable(ref.schema, ref.table)} (${colList}) VALUES (${valList});`;
}

/**
 * 批量生成 INSERT（每行一条），用于结果集导出 .sql
 * @author yanch
 */
export function buildInsertSqlBatch(
  ref: TableRef,
  rows: Record<string, any>[],
  columns: string[],
  dbType = 'MY_SQL',
): string {
  if (!rows?.length) {
    throw new Error('没有可导出的数据行');
  }
  return rows.map((row) => buildInsertSql(ref, row, columns, dbType)).join('\n');
}

/**
 * 生成 UPDATE：SET 用编辑后的值，WHERE 用原始行（优先主键列）
 */
export function buildUpdateSql(
  ref: TableRef,
  originalRow: Record<string, any>,
  editedRow: Record<string, any>,
  columns: string[],
  whereColumns: string[],
  dbType = 'MY_SQL',
): string {
  const d = resolveSqlDialect(dbType);
  const setParts = columns
    .filter((c) => Object.prototype.hasOwnProperty.call(editedRow, c))
    .map((c) => `${d.quoteIdent(c)} = ${d.literal(editedRow[c])}`);
  if (!setParts.length) {
    throw new Error('没有可更新的字段');
  }
  const where = buildWhere(originalRow, columns, whereColumns, dbType);
  return `UPDATE ${d.qualifyTable(ref.schema, ref.table)} SET ${setParts.join(', ')} WHERE ${where};`;
}

/** 生成 DELETE */
export function buildDeleteSql(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
  whereColumns: string[],
  dbType = 'MY_SQL',
): string {
  const d = resolveSqlDialect(dbType);
  const where = buildWhere(row, columns, whereColumns, dbType);
  return `DELETE FROM ${d.qualifyTable(ref.schema, ref.table)} WHERE ${where};`;
}
