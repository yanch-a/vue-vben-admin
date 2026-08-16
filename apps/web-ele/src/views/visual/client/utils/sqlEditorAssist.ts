/**
 * SQL 编辑器辅助算法（补全上下文 / 表字段缓存 / 按分号切执行语句）
 *
 * 设计要点：
 * 1. 根据光标前语义判断「写表名」还是「写字段名」，避免每次按键都打接口
 * 2. 表名补全优先用左侧已加载的表清单；支持 db.table 按库匹配
 * 3. 字段补全仅在识别到表之后按需请求，并写入客户端 LRU 缓存
 * 4. 执行时按分号切分，只发「光标所在语句」；若有选区则只发选中内容
 *
 * @author yanch
 */

/** 补全类型 */
export type CompletionKind = 'table' | 'column' | 'none';

export interface SqlCompletionContext {
  kind: CompletionKind;
  /** 当前正在输入的片段（最后一个标识符） */
  prefix: string;
  /** db.table 中的库名；或 FROM 子句解析出的库 */
  schema?: string;
  /** 写字段时归属的表名 */
  table?: string;
  /** 在全文中的替换区间 [from, to) */
  replaceFrom: number;
  replaceTo: number;
}

export interface SqlRange {
  start: number;
  end: number;
}

export interface TableNameItem {
  tableName: string;
  /** 所属库/schema；缺省表示与当前编辑器库相同 */
  schema?: string;
}

// ─────────────────────────── 字符串/注释剥离（启发式） ───────────────────────────

/**
 * 将字符串字面量与注释替换为空格，保留长度大致对应关系（用于关键字判断，不用于切片）
 */
function maskSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    // 行注释
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '#') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    // 块注释
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          out += '  ';
          i += 2;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    // 单引号字符串
    if (c === "'") {
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += '  ';
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out += ' ';
          i++;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    // 双引号（部分方言标识符，这里按字面量屏蔽以免干扰）
    if (c === '"') {
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          out += '  ';
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          out += ' ';
          i++;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripIdentQuotes(name: string): string {
  return String(name || '')
    .replace(/^[`"\[]+|[`"\]]+$/g, '')
    .trim();
}

// ─────────────────────────── 按分号切分语句 ───────────────────────────

/**
 * 按分号切分 SQL，忽略字符串/注释中的分号。
 * 返回每条语句在原文中的 [start, end)（不含末尾分号）。
 */
export function splitSqlStatements(fullText: string): SqlRange[] {
  const ranges: SqlRange[] = [];
  let start = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  const pushRange = (end: number) => {
    // 跳过首尾空白
    let s = start;
    let e = end;
    while (s < e && /\s/.test(fullText[s]!)) s++;
    while (e > s && /\s/.test(fullText[e - 1]!)) e--;
    if (e > s) ranges.push({ start: s, end: e });
  };

  while (i < fullText.length) {
    const c = fullText[i]!;
    const n = fullText[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && n === "'") {
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && n === '"') {
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      i++;
      continue;
    }

    if (c === '-' && n === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === '#') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }

    if (c === ';') {
      pushRange(i);
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  pushRange(fullText.length);
  return ranges;
}

/**
 * 收紧区间：去掉语句两端空白，便于格式化后原地替换。
 */
function tightenSqlRange(text: string, range: SqlRange): SqlRange {
  let start = range.start;
  let end = range.end;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
}

/**
 * 取待执行/格式化的 SQL 区间：
 * - 有非空选区 → 选区（两端空白收紧）
 * - 否则 → 光标所在分号语句（无分号则整篇）
 *
 * @returns range 为原文中的替换区间；text 为该区间内容（已 trim）
 */
export function extractExecutableSqlRange(
  fullText: string,
  cursorOffset: number,
  selection?: SqlRange | null,
): { range: SqlRange; text: string } | null {
  const text = fullText || '';
  if (selection && selection.end > selection.start) {
    const range = tightenSqlRange(text, selection);
    const slice = text.slice(range.start, range.end);
    if (!slice.trim()) return null;
    return { range, text: slice };
  }
  if (!text.trim()) return null;
  const ranges = splitSqlStatements(text);
  if (!ranges.length) {
    const range = tightenSqlRange(text, { start: 0, end: text.length });
    return { range, text: text.slice(range.start, range.end) };
  }

  const pos = Math.max(0, Math.min(cursorOffset, text.length));
  // 光标落在语句内，或紧贴语句后的空白/分号
  let hit =
    ranges.find((r) => pos >= r.start && pos <= r.end) ||
    ranges.find((r) => {
      let p = r.end;
      while (p < text.length && /\s/.test(text[p]!)) p++;
      if (p < text.length && text[p] === ';') p++;
      return pos >= r.start && pos <= p;
    });

  if (!hit) {
    // 光标在末尾空白：取最后一条非空
    hit = ranges[ranges.length - 1];
  }
  if (!hit) return null;
  const range = tightenSqlRange(text, hit);
  const slice = text.slice(range.start, range.end);
  if (!slice.trim()) return null;
  return { range, text: slice };
}

/**
 * 取待执行 SQL：
 * - 有非空选区 → 只执行选中内容
 * - 否则 → 光标所在分号语句（无分号则整篇）
 */
export function extractExecutableSql(
  fullText: string,
  cursorOffset: number,
  selection?: SqlRange | null,
): string {
  return extractExecutableSqlRange(fullText, cursorOffset, selection)?.text?.trim() || '';
}

// ─────────────────────────── 补全上下文检测 ───────────────────────────

const TABLE_HINT_RE =
  /\b(FROM|JOIN|UPDATE|INTO|TABLE|TRUNCATE|DESCRIBE|DESC|EXPLAIN)\s*$/i;
const COLUMN_HINT_RE =
  /\b(SELECT|WHERE|AND|OR|SET|ON|HAVING|BY|WHEN|LIKE|BETWEEN|IN|VALUES|,|\()\s*$/i;

/**
 * 从当前语句中解析第一张主表（FROM / UPDATE / INTO）
 */
export function parsePrimaryTableFromStatement(stmt: string): {
  schema?: string;
  table?: string;
} {
  const masked = maskSqlNoise(stmt);
  const m = masked.match(
    /\b(?:FROM|UPDATE|INTO|TABLE)\s+(?:([a-zA-Z0-9_]+|`[^`]+`|"[^"]+"|\[[^\]]+\])\s*\.\s*)?([a-zA-Z0-9_]+|`[^`]+`|"[^"]+"|\[[^\]]+\])/i,
  );
  if (!m) return {};
  const a = stripIdentQuotes(m[1] || '');
  const b = stripIdentQuotes(m[2] || '');
  if (a && b) return { schema: a, table: b };
  if (b) return { table: b };
  return {};
}

/**
 * 判断光标处是在补全表名还是字段名。
 */
export function detectCompletionContext(
  fullSql: string,
  offset: number,
): SqlCompletionContext {
  const pos = Math.max(0, Math.min(offset, fullSql.length));
  const before = fullSql.slice(0, pos);

  // 限制在当前语句内
  const ranges = splitSqlStatements(fullSql);
  const cur =
    ranges.find((r) => pos >= r.start && pos <= r.end) ||
    ranges.find((r) => pos >= r.start) ||
    null;
  const stmtStart = cur?.start ?? 0;
  const stmtBefore = before.slice(stmtStart);
  const stmtAll = cur
    ? fullSql.slice(cur.start, cur.end)
    : fullSql;

  // 当前正在输入的标识（可含库.表 或 表.字段 的前缀）
  const wordMatch = /((?:[`"\[]?[a-zA-Z0-9_$#]+[`"\]]?\.)*[`"\[]?[a-zA-Z0-9_$#]*[`"\]]?)$/.exec(
    stmtBefore,
  );
  const rawWord = wordMatch?.[1] || '';
  const replaceFrom = pos - rawWord.length;
  const replaceTo = pos;

  const dotted = rawWord.split('.').map((p) => stripIdentQuotes(p));
  const prefix = dotted[dotted.length - 1] || '';

  const maskedBefore = maskSqlNoise(stmtBefore);
  // 去掉正在输入的词，看左侧关键字
  const lookback = maskedBefore
    .slice(0, Math.max(0, maskedBefore.length - rawWord.length))
    .replace(/\s+$/u, '');

  const primary = parsePrimaryTableFromStatement(stmtAll);

  // 形如 db. 或 db.xxx —— 第二段当表名；若前面已有 FROM 表. 则当字段
  if (dotted.length >= 2) {
    const left = dotted[0] || '';
    // lookback 以点结束（刚输入完左标识）或 raw 含点
    const afterDotTable = TABLE_HINT_RE.test(lookback.replace(/\.\s*$/, ' '));
    // 若 left 已是已知表（有 FROM），更可能是 table.column
    if (
      primary.table &&
      left.toLowerCase() === primary.table.toLowerCase()
    ) {
      return {
        kind: 'column',
        prefix,
        schema: primary.schema,
        table: primary.table,
        replaceFrom,
        replaceTo,
      };
    }
    // UPDATE/FROM 后的 schema.table
    if (TABLE_HINT_RE.test(lookback) || afterDotTable || !primary.table) {
      return {
        kind: 'table',
        prefix,
        schema: left,
        replaceFrom,
        replaceTo,
      };
    }
    return {
      kind: 'column',
      prefix,
      schema: primary.schema,
      table: left,
      replaceFrom,
      replaceTo,
    };
  }

  if (TABLE_HINT_RE.test(lookback)) {
    return {
      kind: 'table',
      prefix,
      replaceFrom,
      replaceTo,
    };
  }

  if (COLUMN_HINT_RE.test(lookback)) {
    return {
      kind: 'column',
      prefix,
      schema: primary.schema,
      table: primary.table,
      replaceFrom,
      replaceTo,
    };
  }

  // SELECT 列表中且尚未出现 FROM：字段场景但可能还没有表 → none/column
  const upperStmt = maskSqlNoise(stmtBefore).toUpperCase();
  if (
    /\bSELECT\b/.test(upperStmt) &&
    !/\bFROM\b/.test(upperStmt) &&
    prefix
  ) {
    return {
      kind: primary.table ? 'column' : 'none',
      prefix,
      schema: primary.schema,
      table: primary.table,
      replaceFrom,
      replaceTo,
    };
  }

  return {
    kind: 'none',
    prefix,
    replaceFrom,
    replaceTo,
  };
}

/**
 * 表名匹配：支持当前库表，以及用户手写 db.table（按 schema 过滤）
 */
export function matchTableSuggestions(
  tables: TableNameItem[],
  ctx: SqlCompletionContext,
  currentInstance?: string,
): TableNameItem[] {
  const prefix = (ctx.prefix || '').toLowerCase();
  const schemaFilter = (ctx.schema || '').toLowerCase();

  return tables.filter((t) => {
    const name = t.tableName.toLowerCase();
    const sch = (t.schema || currentInstance || '').toLowerCase();
    if (schemaFilter && sch && sch !== schemaFilter) return false;
    if (!prefix) return true;
    return name.startsWith(prefix) || name.includes(prefix);
  });
}

export function matchColumnSuggestions(
  columns: string[],
  prefix: string,
): string[] {
  const p = (prefix || '').toLowerCase();
  if (!p) return columns.slice();
  return columns.filter(
    (c) => c.toLowerCase().startsWith(p) || c.toLowerCase().includes(p),
  );
}

// ─────────────────────────── 客户端表清单 / 字段缓存 ───────────────────────────

/** 左侧树已加载的表：key = `${dbConfigId}::${instanceName}` */
const tablesCatalog = new Map<string, TableNameItem[]>();

function tablesKey(dbConfigId: string | number, instanceName: string) {
  return `${dbConfigId}::${instanceName}`;
}

/** 对象树加载 Tables 后写入，供表名补全使用 */
export function rememberInstanceTables(
  dbConfigId: string | number,
  instanceName: string,
  tableNames: string[],
) {
  if (!instanceName) return;
  const list = (tableNames || [])
    .filter(Boolean)
    .map((tableName) => ({ tableName, schema: instanceName }));
  tablesCatalog.set(tablesKey(dbConfigId, instanceName), list);
}

export function getRememberedTables(
  dbConfigId: string | number,
  instanceName: string,
): TableNameItem[] {
  return tablesCatalog.get(tablesKey(dbConfigId, instanceName)) || [];
}

/** 跨库补全：合并该连接下所有已缓存库的表 */
export function getAllRememberedTables(
  dbConfigId: string | number,
): TableNameItem[] {
  const prefix = `${dbConfigId}::`;
  const out: TableNameItem[] = [];
  tablesCatalog.forEach((list, key) => {
    if (key.startsWith(prefix)) out.push(...list);
  });
  return out;
}

interface ColumnCacheEntry {
  key: string;
  columns: string[];
  primaryKeys: string[];
  touchedAt: number;
}

const COLUMN_CACHE_MAX = 50;
const COLUMN_CACHE_KEEP = 30;
const columnCache = new Map<string, ColumnCacheEntry>();

export function columnCacheKey(
  dbConfigId: string | number,
  instanceName: string,
  tableName: string,
) {
  return `${dbConfigId}::${instanceName}::${tableName}`.toLowerCase();
}

function pruneColumnCache() {
  if (columnCache.size <= COLUMN_CACHE_MAX) return;
  const sorted = [...columnCache.values()].sort(
    (a, b) => a.touchedAt - b.touchedAt,
  );
  const removeCount = columnCache.size - COLUMN_CACHE_KEEP;
  for (let i = 0; i < removeCount; i++) {
    const e = sorted[i];
    if (e) columnCache.delete(e.key);
  }
}

export function getCachedColumns(
  dbConfigId: string | number,
  instanceName: string,
  tableName: string,
): { columns: string[]; primaryKeys: string[] } | null {
  const key = columnCacheKey(dbConfigId, instanceName, tableName);
  const hit = columnCache.get(key);
  if (!hit) return null;
  hit.touchedAt = Date.now();
  return { columns: hit.columns, primaryKeys: hit.primaryKeys };
}

export function setCachedColumns(
  dbConfigId: string | number,
  instanceName: string,
  tableName: string,
  columns: string[],
  primaryKeys: string[] = [],
) {
  const key = columnCacheKey(dbConfigId, instanceName, tableName);
  columnCache.set(key, {
    key,
    columns: columns.slice(),
    primaryKeys: primaryKeys.slice(),
    touchedAt: Date.now(),
  });
  pruneColumnCache();
}

/** 关闭编辑器 / 切换连接时清空字段缓存 */
export function clearColumnCache() {
  columnCache.clear();
}

export function clearTablesCatalog() {
  tablesCatalog.clear();
}
