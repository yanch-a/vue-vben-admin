/**
 * 联表查询结果的列归属与按主键 UPDATE。
 *
 * 规则：
 * - 改哪张表，结果里必须带上该表主键（同名 id 请写成 别名.id 或 id AS user_id）
 * - 联表只能按主键定位，不退回「全列 WHERE」
 *
 * @author yanch
 */
import type { DirtyRowEdit } from './resultSheetValue';
import {
  buildUpdateSqlMapped,
  identEq,
  parseSelectHints,
  type ColPair,
  type SelectHint,
  type TableRef,
} from './resultRowSql';

export interface ResultTableMeta {
  ref: TableRef;
  alias?: string;
  columns: string[];
  primaryKeys: string[];
}

export type ColOwner =
  | { tableIndex: number; physicalCol: string }
  | 'ambiguous'
  | 'unknown';

function tableDisplayName(t: ResultTableMeta): string {
  const n = t.ref.schema ? `${t.ref.schema}.${t.ref.table}` : t.ref.table;
  return t.alias && !identEq(t.alias, t.ref.table) ? `${n} ${t.alias}` : n;
}

function matchTableIndex(
  tables: ResultTableMeta[],
  key?: string | null,
): number {
  if (!key) return -1;
  const aliasHits: number[] = [];
  const tableHits: number[] = [];
  tables.forEach((t, i) => {
    if (t.alias && identEq(t.alias, key)) aliasHits.push(i);
    if (identEq(t.ref.table, key)) tableHits.push(i);
  });
  if (aliasHits.length === 1) return aliasHits[0]!;
  if (tableHits.length === 1) return tableHits[0]!;
  return -1;
}

function splitQualifiedResultCol(
  resultCol: string,
): { tableKey?: string; column: string } {
  const parts = String(resultCol || '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      tableKey: parts[parts.length - 2],
      column: parts[parts.length - 1]!,
    };
  }
  return { column: parts[0] || resultCol };
}

function tableHasColumn(table: ResultTableMeta, col: string): boolean {
  return (table.columns || []).some((c) => identEq(c, col));
}

function pickHint(
  resultCol: string,
  hints: SelectHint[],
): SelectHint | undefined {
  return hints.find(
    (h) =>
      !h.starAll &&
      !h.starTable &&
      identEq(h.resultName, resultCol),
  );
}

/**
 * 把结果列归属到联表中的某张物理表。
 * JDBC 的 columnTables[i] 是 ResultSetMetaData.getTableName，有则优先。
 */
export function resolveResultColumnOwner(
  resultCol: string,
  tables: ResultTableMeta[],
  hints: SelectHint[],
  columnTable?: string,
): ColOwner {
  if (!resultCol || !tables.length) return 'unknown';

  const jdbcIdx = matchTableIndex(tables, columnTable);
  const qualified = splitQualifiedResultCol(resultCol);
  const hint = pickHint(resultCol, hints);

  // JDBC 的 columnTable 只能辅助确认物理列归属，不能把表达式别名变成可写列。
  if (hint?.writable === false) return 'unknown';

  const tryOwner = (
    tableKey: string | undefined,
    physical: string | undefined,
  ): ColOwner | null => {
    if (!physical) return null;
    const idx = matchTableIndex(tables, tableKey);
    if (idx >= 0) {
      if (
        tables[idx]!.columns.length &&
        !tableHasColumn(tables[idx]!, physical)
      ) {
        return 'unknown';
      }
      return { tableIndex: idx, physicalCol: physical };
    }
    if (!tableKey && jdbcIdx >= 0 && tableHasColumn(tables[jdbcIdx]!, physical)) {
      return { tableIndex: jdbcIdx, physicalCol: physical };
    }
    return null;
  };

  const fromHint = tryOwner(hint?.tableKey, hint?.column);
  if (fromHint) return fromHint;

  if (qualified.tableKey) {
    const fromQ = tryOwner(qualified.tableKey, qualified.column);
    if (fromQ) return fromQ;
  }

  if (jdbcIdx >= 0) {
    const physical = hint?.column || qualified.column || resultCol;
    if (
      !tables[jdbcIdx]!.columns.length ||
      tableHasColumn(tables[jdbcIdx]!, physical)
    ) {
      return { tableIndex: jdbcIdx, physicalCol: physical };
    }
  }

  const physical = hint?.column || qualified.column || resultCol;
  const hits: number[] = [];
  tables.forEach((t, i) => {
    if (tableHasColumn(t, physical)) hits.push(i);
  });
  if (hits.length === 1) {
    return { tableIndex: hits[0]!, physicalCol: physical };
  }
  if (hits.length > 1) return 'ambiguous';

  const starHint = hints.find(
    (h) => h.starTable && matchTableIndex(tables, h.starTable) >= 0,
  );
  if (starHint?.starTable) {
    const idx = matchTableIndex(tables, starHint.starTable);
    if (idx >= 0 && tableHasColumn(tables[idx]!, physical)) {
      return { tableIndex: idx, physicalCol: physical };
    }
  }

  if (hints.some((h) => h.starAll) && hits.length === 0 && tables.length === 1) {
    return { tableIndex: 0, physicalCol: physical };
  }

  return 'unknown';
}

function resultColByName(resultCols: string[], name: string): string | undefined {
  return resultCols.find((c) => identEq(c, name));
}

function otherTablesHavePkName(
  tables: ResultTableMeta[],
  tableIndex: number,
  pk: string,
): boolean {
  return tables.some(
    (t, i) => i !== tableIndex && (t.primaryKeys || []).some((k) => identEq(k, pk)),
  );
}

/**
 * 在结果列里找某表主键。同名 id 时必须能靠别名/表前缀/JDBC 表名区分。
 */
export function findTablePkBindings(
  table: ResultTableMeta,
  tableIndex: number,
  resultCols: string[],
  hints: SelectHint[],
  tables: ResultTableMeta[],
  columnTables?: string[],
): ColPair[] | null {
  const pks = table.primaryKeys || [];
  if (!pks.length) return null;
  const pairs: ColPair[] = [];
  for (const pk of pks) {
    const found = findPkResultCol(
      table,
      tableIndex,
      pk,
      resultCols,
      hints,
      tables,
      columnTables,
    );
    if (!found) return null;
    pairs.push({ physical: pk, resultCol: found });
  }
  return pairs;
}

function findPkResultCol(
  table: ResultTableMeta,
  tableIndex: number,
  pk: string,
  resultCols: string[],
  hints: SelectHint[],
  tables: ResultTableMeta[],
  columnTables?: string[],
): string | undefined {
  const keys: string[] = [];
  if (table.alias) {
    keys.push(`${table.alias}.${pk}`, `${table.alias}_${pk}`);
  }
  keys.push(`${table.ref.table}.${pk}`, `${table.ref.table}_${pk}`);
  for (const k of keys) {
    const hit = resultColByName(resultCols, k);
    if (hit) return hit;
  }

  for (let i = 0; i < resultCols.length; i++) {
    const col = resultCols[i]!;
    const hint = pickHint(col, hints);
    // 表达式别名即使恰好叫 id，也不能作为真实主键定位行。
    if (hint?.writable === false) continue;
    if (hint?.column && identEq(hint.column, pk)) {
      const idx = matchTableIndex(tables, hint.tableKey);
      if (idx === tableIndex) return col;
    }
    const q = splitQualifiedResultCol(col);
    if (identEq(q.column, pk) && matchTableIndex(tables, q.tableKey) === tableIndex) {
      return col;
    }
    const jdbc = columnTables?.[i];
    if (jdbc && identEq(q.column, pk) && matchTableIndex(tables, jdbc) === tableIndex) {
      return col;
    }
  }

  const writableResultCols = resultCols.filter((c) => {
    const hint = pickHint(c, hints);
    return hint?.writable !== false;
  });
  const bare = writableResultCols.filter(
    (c) => identEq(splitQualifiedResultCol(c).column, pk)
      && !splitQualifiedResultCol(c).tableKey,
  );
  const exactBare = writableResultCols.filter((c) => identEq(c, pk));
  const candidates = exactBare.length ? exactBare : bare;
  if (candidates.length === 1) {
    const col = candidates[0]!;
    const idx = resultCols.findIndex((c) => c === col);
    const jdbc = idx >= 0 ? columnTables?.[idx] : undefined;
    if (jdbc && matchTableIndex(tables, jdbc) === tableIndex) return col;
    if (jdbc && matchTableIndex(tables, jdbc) >= 0 && matchTableIndex(tables, jdbc) !== tableIndex) {
      return undefined;
    }
    if (!otherTablesHavePkName(tables, tableIndex, pk)) return col;
    const othersQualified = tables.some((t, i) => {
      if (i === tableIndex) return false;
      if (!(t.primaryKeys || []).some((k) => identEq(k, pk))) return false;
      const prefix = [t.alias, t.ref.table].filter(Boolean) as string[];
      return prefix.some(
        (p) =>
          resultColByName(resultCols, `${p}.${pk}`) ||
          resultColByName(resultCols, `${p}_${pk}`),
      );
    });
    if (othersQualified) return col;
    return undefined;
  }
  return undefined;
}

function ownerError(col: string, owner: ColOwner): string {
  if (owner === 'ambiguous') {
    return `列 ${col} 在多个表中都存在，请在 SELECT 中写成 表.列 或 AS 别名后再改`;
  }
  return `列 ${col} 无法归属到联表中的某张表，不能更新`;
}

export function buildJoinUpdateSqls(
  item: Pick<DirtyRowEdit, 'original' | 'edited' | 'changedColumns'>,
  tables: ResultTableMeta[],
  resultCols: string[],
  sourceSql: string,
  dbType: string,
  columnTables?: string[],
): string[] {
  if (!tables.length) {
    throw new Error('无法识别联表，请检查 FROM / JOIN');
  }
  const hints = parseSelectHints(sourceSql);
  const byTable = new Map<number, ColPair[]>();

  for (const col of item.changedColumns) {
    const idx = resultCols.findIndex((c) => identEq(c, col));
    const jdbc = idx >= 0 ? columnTables?.[idx] : undefined;
    const owner = resolveResultColumnOwner(col, tables, hints, jdbc);
    if (owner === 'ambiguous' || owner === 'unknown') {
      throw new Error(ownerError(col, owner));
    }
    const list = byTable.get(owner.tableIndex) || [];
    list.push({ physical: owner.physicalCol, resultCol: col });
    byTable.set(owner.tableIndex, list);
  }

  const sqls: string[] = [];
  for (const [tableIndex, setPairs] of byTable) {
    const table = tables[tableIndex]!;
    const name = tableDisplayName(table);
    if (!table.primaryKeys?.length) {
      throw new Error(
        `表 ${name} 没有主键。联表结果只能按主键更新，请改用单表查询`,
      );
    }
    const wherePairs = findTablePkBindings(
      table,
      tableIndex,
      resultCols,
      hints,
      tables,
      columnTables,
    );
    if (!wherePairs?.length) {
      throw new Error(
        `修改 ${name} 的字段时，结果中必须带上该表主键（${table.primaryKeys.join(', ')}）。同名主键请写成 ${table.alias || table.ref.table}.id 或 id AS ${table.alias || table.ref.table}_id`,
      );
    }
    sqls.push(
      buildUpdateSqlMapped(
        table.ref,
        item.original as Record<string, any>,
        item.edited as Record<string, any>,
        setPairs,
        wherePairs,
        dbType,
      ),
    );
  }
  if (!sqls.length) {
    throw new Error('没有可更新的字段');
  }
  return sqls;
}

/** 拷贝 UPDATE：每个能定位主键的表各生成一条（SET 该表已归属列） */
export function buildJoinCopyUpdateSqls(
  row: Record<string, any>,
  tables: ResultTableMeta[],
  resultCols: string[],
  sourceSql: string,
  dbType: string,
  columnTables?: string[],
): string[] {
  const hints = parseSelectHints(sourceSql);
  const mapped: string[] = [];
  for (const col of resultCols) {
    const idx = resultCols.indexOf(col);
    const owner = resolveResultColumnOwner(
      col,
      tables,
      hints,
      columnTables?.[idx],
    );
    if (owner !== 'ambiguous' && owner !== 'unknown') {
      mapped.push(col);
    }
  }
  if (!mapped.length) {
    throw new Error('联表列无法归属，无法生成 UPDATE');
  }
  return buildJoinUpdateSqls(
    { original: row, edited: row, changedColumns: mapped },
    tables,
    resultCols,
    sourceSql,
    dbType,
    columnTables,
  );
}

