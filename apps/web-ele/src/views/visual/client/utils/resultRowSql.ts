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

/** FROM / JOIN 里的一张表，带可选别名 */
export interface QueryTableRef extends TableRef {
  alias?: string;
}

/** SET/WHERE 物理列名 ↔ 结果集列名（联表别名列用） */
export interface ColPair {
  physical: string;
  resultCol: string;
}

const IDENT =
  '(?:`([^`]+)`|"([^"]+)"|\\[([^\\]]+)\\]|([\\p{L}_][\\p{L}\\p{N}_$#]*))';

const JOIN_MOD =
  /^(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|OUTER)$/i;

function pickIdent(m: RegExpMatchArray, offset: number): string | undefined {
  return m[offset] || m[offset + 1] || m[offset + 2] || m[offset + 3] || undefined;
}

/** 抹注释和单引号字面量，保留 "ident" / `ident` */
export function stripSqlNoise(sql: string): string {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'([^'\\]|\\.|'')*'/g, "''");
}

function consumeIdent(s: string): { name: string; rest: string } | null {
  const m = s.match(new RegExp(`^\\s*${IDENT}`, 'iu'));
  if (!m) return null;
  const name = pickIdent(m, 1);
  if (!name) return null;
  return { name, rest: s.slice(m[0].length) };
}

function consumeQualifiedName(
  s: string,
): { parts: string[]; rest: string } | null {
  const first = consumeIdent(s);
  if (!first) return null;
  const parts = [first.name];
  let rest = first.rest;
  while (true) {
    const dot = rest.match(/^\s*\./);
    if (!dot) break;
    const next = consumeIdent(rest.slice(dot[0].length));
    if (!next) break;
    parts.push(next.name);
    rest = next.rest;
  }
  return { parts, rest };
}

function partsToTableRef(parts: string[]): TableRef | null {
  if (!parts.length) return null;
  if (parts.length >= 3) {
    return { schema: parts[parts.length - 2], table: parts[parts.length - 1]! };
  }
  if (parts.length === 2) {
    return { schema: parts[0], table: parts[1]! };
  }
  return { table: parts[0]! };
}

function stripJoinModifiers(s: string): string {
  let t = s.trim();
  const head = /^(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|OUTER)\s+/i;
  const tail = /\s+(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|OUTER)$/i;
  while (head.test(t)) t = t.replace(head, '');
  while (tail.test(t)) t = t.replace(tail, '');
  return t.trim();
}

/** 按逗号 / JOIN 切开 FROM 段（括号内不切） */
function splitFromTableChunks(fromPart: string): string[] {
  const chunks: string[] = [];
  let buf = '';
  let depth = 0;
  const s = fromPart;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '(') {
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      i++;
      continue;
    }
    if (depth === 0 && ch === ',') {
      chunks.push(buf);
      buf = '';
      i++;
      continue;
    }
    if (depth === 0 && /^JOIN\b/i.test(s.slice(i))) {
      chunks.push(buf);
      buf = '';
      i += 4;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

function extractFromClause(sql: string): string | null {
  const cleaned = stripSqlNoise(sql);
  const m = cleaned.match(/\bFROM\b([\s\S]*)$/iu);
  if (!m?.[1]) return null;
  let from = m[1];
  const cut = from.search(
    /\b(?:WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION|OFFSET|FETCH|WINDOW|FOR\s+(?:UPDATE|SHARE)|INTERSECT|EXCEPT)\b/iu,
  );
  if (cut >= 0) from = from.slice(0, cut);
  return from;
}

function parseTableChunk(chunk: string): QueryTableRef | null {
  let s = stripJoinModifiers(chunk);
  s = s.replace(/\b(?:ON|USING)\b[\s\S]*$/iu, '').trim();
  s = s.replace(
    /\b(?:WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|OFFSET|FETCH)\b[\s\S]*$/iu,
    '',
  ).trim();
  if (!s || s.startsWith('(')) return null;
  const q = consumeQualifiedName(s);
  if (!q) return null;
  const ref = partsToTableRef(q.parts);
  if (!ref?.table) return null;
  let alias: string | undefined;
  const aliasMatch = q.rest.match(
    new RegExp(`^\\s+(?:AS\\s+)?(${IDENT})(?:\\s|$)`, 'iu'),
  );
  if (aliasMatch) {
    const name = pickIdent(aliasMatch, 1);
    if (name && !JOIN_MOD.test(name) && !/^(ON|USING|AS)$/i.test(name)) {
      alias = name;
    }
  }
  return { ...ref, alias };
}

/**
 * 解析 SELECT 的 FROM / JOIN 全部表（含子查询的跳过）。
 * 用于联表编辑：按表分别 UPDATE。
 */
export function parseQueryTables(sql: string): QueryTableRef[] {
  if (!sql) return [];
  const from = extractFromClause(sql);
  if (!from) return [];
  const out: QueryTableRef[] = [];
  const seen = new Set<string>();
  for (const chunk of splitFromTableChunks(from)) {
    const t = parseTableChunk(chunk);
    if (!t?.table) continue;
    const key = `${(t.alias || '').toLowerCase()}::${(t.schema || '').toLowerCase()}::${t.table.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** 从 SELECT SQL 解析主表（第一张 FROM 表） */
export function parseTableFromSql(sql: string): TableRef | null {
  const tables = parseQueryTables(sql);
  if (!tables.length) return null;
  const t = tables[0]!;
  return { schema: t.schema, table: t.table };
}

/** SELECT 列表一项：用于把结果列归属到某张表 */
export interface SelectHint {
  resultName: string;
  tableKey?: string;
  column?: string;
  starTable?: string;
  starAll?: boolean;
}

function splitTopComma(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') {
      depth++;
      buf += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function extractSelectList(sql: string): string | null {
  const cleaned = stripSqlNoise(sql);
  const sel = cleaned.search(/\bSELECT\b/iu);
  if (sel < 0) return null;
  let i = sel + 6;
  const skip = cleaned
    .slice(i)
    .match(
      /^\s*(?:(?:DISTINCT|ALL)\s+)?(?:TOP\s*(?:\([^)]+\)|\d+)\s*(?:PERCENT\s+)?(?:WITH\s+TIES\s+)?)?/iu,
    );
  if (skip) i += skip[0].length;
  const start = i;
  let depth = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^FROM\b/iu.test(cleaned.slice(i))) {
      return cleaned.slice(start, i).trim();
    }
    i++;
  }
  return null;
}

function trailingAlias(item: string): string | undefined {
  const m = item.match(new RegExp(`\\s+(?:AS\\s+)?(${IDENT})\\s*$`, 'iu'));
  if (!m) return undefined;
  const name = pickIdent(m, 1);
  if (!name || JOIN_MOD.test(name)) return undefined;
  return name;
}

function parseSelectItem(item: string): SelectHint {
  const t = item.trim();
  if (t === '*') return { resultName: '*', starAll: true };
  const star = t.match(
    new RegExp(`^${IDENT}(?:\\s*\\.\\s*${IDENT})*\\s*\\.\\s*\\*$`, 'iu'),
  );
  if (star) {
    const q = consumeQualifiedName(t.replace(/\s*\.\s*\*\s*$/, ''));
    const key = q?.parts[q.parts.length - 1];
    return { resultName: '*', starTable: key };
  }
  if (/[()]/.test(t) || /\bCASE\b/i.test(t)) {
    return { resultName: trailingAlias(t) || t };
  }
  const q = consumeQualifiedName(t);
  if (!q) {
    return { resultName: trailingAlias(t) || t };
  }
  const aliasMatch = q.rest.match(
    new RegExp(`^\\s+(?:AS\\s+)?(${IDENT})\\s*$`, 'iu'),
  );
  const aliasName = aliasMatch ? pickIdent(aliasMatch, 1) : undefined;
  if (q.parts.length >= 2) {
    const column = q.parts[q.parts.length - 1]!;
    const tableKey = q.parts[q.parts.length - 2]!;
    return {
      resultName: aliasName || column,
      tableKey,
      column,
    };
  }
  return {
    resultName: aliasName || q.parts[0]!,
    column: q.parts[0],
  };
}

/** 解析 SELECT 列表，给联表列归属用 */
export function parseSelectHints(sql: string): SelectHint[] {
  const list = extractSelectList(sql);
  if (!list) return [];
  return splitTopComma(list)
    .filter(Boolean)
    .map(parseSelectItem);
}

export function identEq(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
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

/**
 * 联表 UPDATE：SET/WHERE 用物理列名，取值用结果列名（AS 别名、表.列 去重后的列）。
 */
export function buildUpdateSqlMapped(
  ref: TableRef,
  originalRow: Record<string, any>,
  editedRow: Record<string, any>,
  setPairs: ColPair[],
  wherePairs: ColPair[],
  dbType = 'MY_SQL',
): string {
  const d = resolveSqlDialect(dbType);
  const setParts = setPairs
    .filter((p) => Object.prototype.hasOwnProperty.call(editedRow, p.resultCol))
    .map(
      (p) =>
        `${d.quoteIdent(p.physical)} = ${d.literal(editedRow[p.resultCol])}`,
    );
  if (!setParts.length) {
    throw new Error('没有可更新的字段');
  }
  if (!wherePairs.length) {
    throw new Error('无法构建 WHERE：联表更新必须带主键');
  }
  const where = wherePairs
    .map((p) => {
      const v = originalRow[p.resultCol];
      if (v === null || v === undefined) {
        return `${d.quoteIdent(p.physical)} IS NULL`;
      }
      return `${d.quoteIdent(p.physical)} = ${d.literal(v)}`;
    })
    .join(' AND ');
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
