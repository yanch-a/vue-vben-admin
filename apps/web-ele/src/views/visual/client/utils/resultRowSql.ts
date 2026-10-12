/**
 * 查询结果行 → INSERT / UPDATE / DELETE SQL 生成
 * 标识符与字面量统一走 resolveSqlDialect(dbType)，避免各库硬编码。
 *
 * @author yanch
 */
import { createResultValueWriter, resultValuePredicate, type ResultEditParameter } from './resultComparison';
import { topLevelWords } from './sqlTopLevel';
import { resolveDialectFamily, resolveSqlDialect } from '../dialect/sqlDialect';

export interface TableRef {
  /** SQL Server 三段限定名中的数据库。 */
  catalog?: string;
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
  '(?:`((?:``|[^`])+)`|"((?:""|[^"])+)"|\\[((?:\\]\\]|[^\\]])+)\\]|([\\p{L}_][\\p{L}\\p{N}_$#]*))';

const JOIN_MOD =
  /^(?:INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|OUTER)$/i;

function pickIdent(m: RegExpMatchArray, offset: number): string | undefined {
  const value = m[offset] || m[offset + 1] || m[offset + 2] || m[offset + 3];
  return value?.replace(/``/g, '`').replace(/""/g, '"').replace(/\]\]/g, ']');
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
    if (parts.length > 3) return null; // 远程服务器四段名无法在本连接安全读取主键。
    return { catalog: parts[0], schema: parts[1], table: parts[2]! };
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
    if (['"', '`', '[', "'"].includes(ch)) {
      const start = i++; const close = ch === '[' ? ']' : ch;
      while (i < s.length) {
        if (s[i++] === close) { if (s[i] === close) i++; else break; }
      }
      buf += s.slice(start, i); continue;
    }
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
  const words = topLevelWords(sql);
  const select = words.findIndex((w) => w.word === 'SELECT');
  if (select < 0) return null;
  // UNION/DISTINCT/GROUP 的行没有唯一物理来源，结果保持只读。
  if (words.slice(select + 1).some((w) => ['UNION', 'INTERSECT', 'EXCEPT', 'DISTINCT', 'GROUP', 'APPLY', 'PIVOT', 'UNPIVOT'].includes(w.word))) return null;
  const from = words.slice(select + 1).find((w) => w.word === 'FROM');
  if (!from) return null;
  const end = words.find((w) => w.start > from.end && ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'WINDOW', 'FOR'].includes(w.word));
  return sql.slice(from.end, end?.start ?? sql.length).replace(/;\s*$/, '');
}

function parseTableChunk(chunk: string): QueryTableRef | null {
  let s = stripJoinModifiers(chunk);


  if (!s || s.startsWith('(')) return null;
  const q = consumeQualifiedName(s);
  if (!q) return null;
  const ref = partsToTableRef(q.parts);
  if (!ref?.table) return null;
  let alias: string | undefined;
  const aliasMatch = q.rest.match(
    new RegExp(`^\\s+(?:AS\\s+)?${IDENT}(?:\\s|$)`, 'iu'),
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
    // 存在派生表时不能把剩下的一张物理表误当成整个结果的唯一来源。
    if (!t?.table) return [];
    const outerSelect = topLevelWords(sql).find((w) => w.word === 'SELECT');
    const prefix = sql.slice(0, outerSelect?.start ?? 0);
    // CTE 名是临时结果，不是可直接 UPDATE 的物理表。
    if (/^\s*WITH\b/i.test(prefix)) {
      const names = [...prefix.matchAll(/(?:WITH|,)\s*["`\[]?([\w$]+)["`\]]?\s*(?:\([^)]*\)\s*)?AS\s*\(/gi)].map((m) => m[1]);
      if (names.some((name) => name === t.table)) return [];
    }
    const key = `${t.catalog || ''}::${t.alias || ''}::${t.schema || ''}::${t.table}`;
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
  return { catalog: t.catalog, schema: t.schema, table: t.table };
}

/** SELECT 列表一项：用于把结果列归属到某张表 */
export interface SelectHint {
  resultName: string;
  tableKey?: string;
  column?: string;
  starTable?: string;
  starAll?: boolean;
  /** 表达式、聚合、窗口函数和 CASE 等结果列不可直接回写。 */
  writable?: boolean;
}

function splitTopComma(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i=0;i<s.length;i++) {
    const ch=s[i]!;
    // 引用标识符中的逗号/括号不参与 SELECT 列表切分。
    if (['"','`','[',"'"].includes(ch)) {
      const start=i;const close=ch==='['?']':ch;
      while (++i<s.length) { if(s[i]===close) { if(s[i+1]===close)i++;else break; } }
      buf+=s.slice(start,i+1);continue;
    }
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
  const words = topLevelWords(sql);
  const select = words.find((w) => w.word === 'SELECT');
  const from = words.find((w) => w.word === 'FROM' && w.start > (select?.end ?? Infinity));
  if (!select || !from) return null;
  return stripSqlNoise(sql.slice(select.end, from.start)).replace(/^\s*(?:DISTINCT|ALL)\s+/i, '').replace(/^\s*TOP\s*(?:\([^)]*\)|\d+)\s*(?:PERCENT\s*)?(?:WITH\s+TIES\s*)?/i, '').trim();
}

function trailingAlias(item: string): string | undefined {
  const m = item.match(new RegExp(`\\s+(?:AS\\s+)?${IDENT}\\s*$`, 'iu'));
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
  const q = consumeQualifiedName(t);
  if (!q) {
    return { resultName: trailingAlias(t) || t, writable: false };
  }
  const aliasMatch = q.rest.match(
    new RegExp(`^\\s+(?:AS\\s+)?${IDENT}\\s*$`, 'iu'),
  );
  const aliasName = aliasMatch ? pickIdent(aliasMatch, 1) : undefined;
  // 只允许完整的列引用或列引用加别名；剩余 token 说明这是表达式。
  if (q.rest.trim() && !aliasName) {
    return { resultName: trailingAlias(t) || t, writable: false };
  }
  if (q.parts.length >= 2) {
    const column = q.parts[q.parts.length - 1]!;
    const tableKey = q.parts[q.parts.length - 2]!;
    return {
      resultName: aliasName || column,
      tableKey,
      column,
      writable: true,
    };
  }
  return {
    resultName: aliasName || q.parts[0]!,
    column: q.parts[0],
    writable: true,
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

/** 按投影序号关联去重后的显示名称；星号扩展时采用原始标签，无法证明的表达式保持只读。@author yanch */
export function resultProjectionHints(sql: string, columns: string[], metadata?: {label:string;sourceLabel?:string}[]): SelectHint[] {
  const hints=parseSelectHints(sql);
  if(hints.length===columns.length && !hints.some((hint)=>hint.starAll||hint.starTable)) {
    return hints.map((hint,index)=>({...hint,resultName:columns[index]!}));
  }
  const explicit=hints.filter((hint)=>!hint.starAll&&!hint.starTable);
  return [...hints.filter((hint)=>hint.starAll||hint.starTable),...columns.map((column)=>{
    const label=metadata?.find((item)=>item.label===column)?.sourceLabel || column.split('.').at(-1)!;
    const matches=explicit.filter((hint)=>identEq(hint.resultName,label));
    if(matches.length>1)return {resultName:column,writable:false};
    return matches[0]?{...matches[0],resultName:column}:{resultName:column};
  })];
}

/**
 * 比较真实物理字段；元数据存在 ID/id 等大小写同名列时必须精确匹配。
 * 只有元数据能证明大小写折叠后唯一，才兼容驱动返回的大小写差异。
 * @author yanch
 */
export function physicalColumnEquals(actual: string, expected: string, knownColumns: string[]): boolean {
  if (actual === expected) return true;
  const folded = expected.toLowerCase();
  if (actual.toLowerCase() !== folded) return false;
  return new Set(knownColumns.filter((name) => name.toLowerCase() === folded)).size <= 1;
}

export function identEq(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

/**
 * 拉表元数据时用的表名：PG/SS/H2 非默认 schema 写成 schema.table；
 * MySQL 的 FROM db.t 里 db 是库名，表名只留 t，库名交给 metadataInstanceName。
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

/**
 * 拉列和主键时用的库名。
 * MySQL 族里 `库`.`表` 的第一段就是库，必须按 SQL 限定名查，不能用左侧当前选中库。
 * PostgreSQL / SQL Server / Oracle 的 schema 不是库，仍用当前库。
 */
export function metadataInstanceName(
  ref: TableRef,
  dbType: string | undefined | null,
  currentInstance: string,
): string {
  if (resolveDialectFamily(dbType) === 'SQLSERVER_LIKE' && ref.catalog) return ref.catalog;
  const qualified = (ref.schema || '').trim();
  if (resolveDialectFamily(dbType) === 'MYSQL_LIKE' && qualified) {
    return qualified;
  }
  return currentInstance;
}

export function quoteIdent(name: string, dbType = 'MY_SQL'): string {
  return resolveSqlDialect(dbType).quoteIdent(name);
}

export function quoteTable(ref: TableRef, dbType = 'MY_SQL'): string {
  return [ref.catalog, ref.schema, ref.table].filter(Boolean).map((name) => quoteIdent(name!, dbType)).join('.');
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
  parameters?: ResultEditParameter[],
): string {
  const d = resolveSqlDialect(dbType);
  const write = createResultValueWriter(dbType, parameters);
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
      return resultValuePredicate(d.quoteIdent(col), v, dbType, write);
    })
    .join(' AND ');
}

/** 生成 INSERT */
export function buildInsertSql(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
  dbType = 'MY_SQL',
  parameters?: ResultEditParameter[],
): string {
  const d = resolveSqlDialect(dbType);
  const write = createResultValueWriter(dbType, parameters);
  const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
  const colList = cols.map((c) => d.quoteIdent(c)).join(', ');
  const valList = cols.map((c) => write(row[c])).join(', ');
  return `INSERT INTO ${quoteTable(ref, dbType)} (${colList}) VALUES (${valList});`;
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
  parameters?: ResultEditParameter[],
): string {
  const d = resolveSqlDialect(dbType);
  const write = createResultValueWriter(dbType, parameters);
  const setParts = columns
    .filter((c) => Object.prototype.hasOwnProperty.call(editedRow, c))
    .map((c) => `${d.quoteIdent(c)} = ${write(editedRow[c])}`);
  if (!setParts.length) {
    throw new Error('没有可更新的字段');
  }
  const where = buildWhere(originalRow, Object.keys(originalRow), [...new Set([...whereColumns, ...Object.keys(originalRow)])], dbType, parameters);
  return `UPDATE ${quoteTable(ref, dbType)} SET ${setParts.join(', ')} WHERE ${where};`;
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
  parameters?: ResultEditParameter[],
): string {
  const d = resolveSqlDialect(dbType);
  const write = createResultValueWriter(dbType, parameters);
  const setParts = setPairs
    .filter((p) => Object.prototype.hasOwnProperty.call(editedRow, p.resultCol))
    .map(
      (p) =>
        `${d.quoteIdent(p.physical)} = ${write(editedRow[p.resultCol])}`,
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
      return resultValuePredicate(d.quoteIdent(p.physical), v, dbType, write);
    })
    .join(' AND ');
  return `UPDATE ${quoteTable(ref, dbType)} SET ${setParts.join(', ')} WHERE ${where};`;
}

/** 生成 DELETE */
export function buildDeleteSql(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
  whereColumns: string[],
  dbType = 'MY_SQL',
  parameters?: ResultEditParameter[],
): string {
  const where = buildWhere(row, columns, [...new Set([...whereColumns, ...columns])], dbType, parameters);
  return `DELETE FROM ${quoteTable(ref, dbType)} WHERE ${where};`;
}
