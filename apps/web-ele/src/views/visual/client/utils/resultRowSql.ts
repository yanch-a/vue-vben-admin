/**
 * 查询结果行 → INSERT / UPDATE / DELETE SQL 生成
 * 标识符与字面量统一走 resolveSqlDialect(dbType)，避免各库硬编码。
 *
 * @author yanch
 */
import { resolveSqlDialect } from '../dialect/sqlDialect';

export interface TableRef {
  schema?: string;
  table: string;
}

/** 从 SELECT SQL 解析主表（简单 FROM 子句，不支持复杂子查询） */
export function parseTableFromSql(sql: string): TableRef | null {
  if (!sql) return null;
  const cleaned = sql
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');
  const m = cleaned.match(
    /\bFROM\s+(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([a-zA-Z0-9_]+))\s*(?:\.\s*(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([a-zA-Z0-9_]+)))?/i,
  );
  if (!m) return null;
  const a = m[1] || m[2] || m[3] || m[4];
  const b = m[5] || m[6] || m[7] || m[8];
  if (b) return { schema: a, table: b };
  if (a) return { table: a };
  return null;
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
