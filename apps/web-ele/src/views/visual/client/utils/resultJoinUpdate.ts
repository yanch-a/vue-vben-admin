/**
 * 联表查询结果的列归属与按主键 UPDATE。
 *
 * 规则：
 * - 改哪张表，结果里必须带上该表主键（同名 id 请写成 别名.id 或 id AS user_id）
 * - 联表只能按主键定位，不退回「全列 WHERE」
 *
 * @author yanch
 */
import type { ResultEditParameter } from './resultComparison';
import type { DirtyRowEdit } from './resultSheetValue';
import {
  buildUpdateSqlMapped,
  identEq,
  resultProjectionHints,
  physicalColumnEquals,
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
  const exactAliases=tables.map((table,index)=>table.alias===key?index:-1).filter((index)=>index>=0);
  if(exactAliases.length===1)return exactAliases[0]!;
  const exactTables=tables.map((table,index)=>table.ref.table===key?index:-1).filter((index)=>index>=0);
  if(exactTables.length===1)return exactTables[0]!;
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
  return (table.columns || []).some((c) => physicalColumnEquals(c, col, table.columns));
}

function pickHint(
  resultCol: string,
  hints: SelectHint[],
): SelectHint | undefined {
  const selectable = hints.filter((h) => !h.starAll && !h.starTable);
  const exact = selectable.find((h) => h.resultName === resultCol);
  if (exact) return exact;
  const folded = selectable.filter((h) => identEq(h.resultName, resultCol));
  return folded.length === 1 ? folded[0] : undefined;
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
    if (tableKey) return 'unknown';
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
    const hint = pickHint(found, hints);
    const physical = hint?.column || splitQualifiedResultCol(found).column;
    const caseVariants = new Set(table.columns.filter((name) => identEq(name, pk)));
    if (caseVariants.size > 1 && !physicalColumnEquals(physical, pk, table.columns)) return null;
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
  // 只认可 SQL 列来源或无歧义的 JDBC/物理列信息，不从 b_id 等显示名称猜主键。
  for (let index=0;index<resultCols.length;index++) {
    const col=resultCols[index]!;
    const owner=resolveResultColumnOwner(col,tables,hints,columnTables?.[index]);
    if(owner!=='unknown' && owner!=='ambiguous' && owner.tableIndex===tableIndex
        && physicalColumnEquals(owner.physicalCol,pk,table.columns)) return col;
  }
  return undefined;
}

function ownerError(col: string, owner: ColOwner): string {
  if (owner === 'ambiguous') {
    return `列 ${col} 在多个表中都存在，请在 SELECT 中写成 表.列 或 AS 别名后再改`;
  }
  return `列 ${col} 无法归属到联表中的某张表，不能更新`;
}

/** 每个查询结果编译一次来源、主键及原值比较列，保存多行时复用。 */
export function compileJoinUpdatePlan(
  tables: ResultTableMeta[],
  resultCols: string[],
  sourceSql: string,
  dbType: string,
  columnTables?: string[],
): (item: Pick<DirtyRowEdit, 'original' | 'edited' | 'changedColumns'>, parameters?: ResultEditParameter[][]) => string[] {
  if (!tables.length) {
    throw new Error('无法识别联表，请检查 FROM / JOIN');
  }
  const hints = resultProjectionHints(sourceSql, resultCols);
  const owners = new Map(resultCols.map((col, index) => [col, resolveResultColumnOwner(col, tables, hints, columnTables?.[index])]));
  const keys = tables.map((table, index) => findTablePkBindings(table, index, resultCols, hints, tables, columnTables));
  const comparisons = keys.map((key, tableIndex) => {
    const pairs = key?.map((pair) => ({ ...pair }));
    if (!pairs?.length) return pairs;
    for (const col of resultCols) {
      const owner = owners.get(col) || 'unknown';
      if (owner !== 'ambiguous' && owner !== 'unknown' && owner.tableIndex === tableIndex
          && !pairs.some((pair) => pair.physical === owner.physicalCol)) {
        pairs.push({ physical: owner.physicalCol, resultCol: col });
      }
    }
    return pairs;
  });
  return (item, parameters) => {
    const byTable = new Map<number, ColPair[]>();

    for (const col of item.changedColumns) {
      const owner = owners.get(col) || 'unknown';
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
      const wherePairs = comparisons[tableIndex];
      if (!wherePairs?.length) {
        throw new Error(
          `修改 ${name} 的字段时，结果中必须带上该表主键（${table.primaryKeys.join(', ')}）。同名主键请写成 ${table.alias || table.ref.table}.id 或 id AS ${table.alias || table.ref.table}_id`,
        );
      }
      const bound: ResultEditParameter[] = [];
      sqls.push(
        buildUpdateSqlMapped(
          table.ref,
          item.original as Record<string, any>,
          item.edited as Record<string, any>,
          setPairs,
          wherePairs,
          dbType,
          parameters ? bound : undefined,
        ),
      );
      parameters?.push(bound);
    }
    if (!sqls.length) {
      throw new Error('没有可更新的字段');
    }
    return sqls;
  };
}

/** 兼容单次生成接口；表格批量保存使用 compileJoinUpdatePlan 复用解析结果。 */
export function buildJoinUpdateSqls(
  item: Pick<DirtyRowEdit, 'original' | 'edited' | 'changedColumns'>,
  tables: ResultTableMeta[], resultCols: string[], sourceSql: string, dbType: string,
  columnTables?: string[], parameters?: ResultEditParameter[][],
): string[] {
  return compileJoinUpdatePlan(tables, resultCols, sourceSql, dbType, columnTables)(item, parameters);
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
  const hints = resultProjectionHints(sourceSql, resultCols);
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

