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
  const refs = parseTableRefsFromStatement(stmt);
  if (refs[0]) {
    return { schema: refs[0].schema, table: refs[0].table };
  }
  // 无 FROM/JOIN 时兜底 UPDATE / INTO / TABLE
  const masked = maskSqlNoise(stmt);
  const m = masked.match(
    /\b(?:UPDATE|INTO|TABLE)\s+(?:([a-zA-Z0-9_$#]+|`[^`]+`|"[^"]+"|\[[^\]]+\])\s*\.\s*)?([a-zA-Z0-9_$#]+|`[^`]+`|"[^"]+"|\[[^\]]+\])/i,
  );
  if (!m) return {};
  const a = stripIdentQuotes(m[1] || '');
  const b = stripIdentQuotes(m[2] || '');
  if (a && b) return { schema: a, table: b };
  if (b) return { table: b };
  return {};
}

/** JOIN/FROM 后不应被当成别名的关键字 */
const ALIAS_STOP_WORDS = new Set(
  [
    'on',
    'where',
    'left',
    'right',
    'inner',
    'outer',
    'full',
    'cross',
    'join',
    'using',
    'group',
    'order',
    'limit',
    'offset',
    'having',
    'union',
    'except',
    'intersect',
    'set',
    'into',
    'values',
    'as',
    'and',
    'or',
    'when',
    'then',
    'else',
    'end',
    'fetch',
    'only',
    'with',
    'start',
    'connect',
    'natural',
  ].map((s) => s.toLowerCase()),
);

export interface SqlTableRef {
  schema?: string;
  table: string;
  /** 显式或隐式别名；无别名时与 table 相同便于查找 */
  alias: string;
}

/**
 * 解析语句中 FROM / JOIN 出现的表及别名（供 a.col / b.col 补全）
 */
export function parseTableRefsFromStatement(stmt: string): SqlTableRef[] {
  const masked = maskSqlNoise(stmt);
  const ident =
    '(?:[a-zA-Z0-9_$#]+|`[^`]+`|"[^"]+"|\\[[^\\]]+\\])';
  const out: SqlTableRef[] = [];
  const seen = new Set<string>();

  const push = (schema: string, table: string, aliasRaw: string) => {
    if (!table) return;
    let alias = aliasRaw;
    if (alias && ALIAS_STOP_WORDS.has(alias.toLowerCase())) {
      alias = '';
    }
    const a = alias || table;
    const key = `${(schema || '').toLowerCase()}::${table.toLowerCase()}::${a.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      schema: schema || undefined,
      table,
      alias: a,
    });
  };

  // FROM / JOIN 表（含 schema.table 与可选别名）
  const fromJoinRe = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(?:(${ident})\\s*\\.\\s*)?(${ident})(?:\\s+(?:AS\\s+)?(${ident}))?`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = fromJoinRe.exec(masked)) !== null) {
    push(
      stripIdentQuotes(m[1] || ''),
      stripIdentQuotes(m[2] || ''),
      stripIdentQuotes(m[3] || ''),
    );
  }

  // 逗号联表：仅扫描 FROM … 到 WHERE/GROUP/ORDER/LIMIT/HAVING/UNION/; 之前的片段
  const fromHeader = /\bFROM\b/i.exec(masked);
  if (fromHeader) {
    const fromStart = fromHeader.index! + fromHeader[0].length;
    const rest = masked.slice(fromStart);
    const endM = /\b(WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION|INTERSECT|EXCEPT)\b|;/i.exec(
      rest,
    );
    const fromClause = endM ? rest.slice(0, endM.index) : rest;
    // 按逗号拆开的「表项」（JOIN 段里也有逗号极少见；JOIN 已在上面解析）
    // 跳过已含 JOIN 关键字的子段，避免重复
    const parts = fromClause.split(',');
    const itemRe = new RegExp(
      `^\\s*(?:(${ident})\\s*\\.\\s*)?(${ident})(?:\\s+(?:AS\\s+)?(${ident}))?\\s*`,
      'i',
    );
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i] || '';
      // 第一段以 FROM 后内容开头，可能含 JOIN … —— 只取 JOIN 之前
      if (/\bJOIN\b/i.test(part)) {
        part = part.split(/\bJOIN\b/i)[0] || '';
      }
      // 去掉开头可能残留的 JOIN 类型词
      part = part.replace(
        /^\s*(?:LEFT|RIGHT|INNER|OUTER|FULL|CROSS|NATURAL)\s+/i,
        '',
      );
      const im = itemRe.exec(part);
      if (!im) continue;
      // 第一段已由 fromJoinRe 解析过 FROM 主表，仍 push（seen 去重）
      push(
        stripIdentQuotes(im[1] || ''),
        stripIdentQuotes(im[2] || ''),
        stripIdentQuotes(im[3] || ''),
      );
    }
  }

  return out;
}

/**
 * 按别名或表名解析真实表（大小写不敏感）
 */
export function resolveTableRefByAlias(
  stmt: string,
  name: string,
): { schema?: string; table?: string } {
  const key = (name || '').toLowerCase();
  if (!key) return {};
  const refs = parseTableRefsFromStatement(stmt);
  for (const r of refs) {
    if (r.alias.toLowerCase() === key || r.table.toLowerCase() === key) {
      return { schema: r.schema, table: r.table };
    }
  }
  return {};
}

/**
 * 从 SQL 编辑器选区或光标处标识符解析「查看表信息」目标。
 * 支持 schema.table、引号标识符；若是别名则按当前 SQL 的 FROM/JOIN 还原真表。
 */
export function resolveTableTargetFromEditor(
  fullSql: string,
  rawToken: string,
): { schema?: string; table: string } | null {
  let token = String(rawToken || '').trim();
  if (!token) return null;
  // 选区若带尾部分号/多余空白，只取首个标识片段
  token = token.replace(/;+\s*$/, '').trim();
  if (/\s/.test(token) && !/[.`"[\]]/.test(token)) {
    token = token.split(/\s+/)[0] || '';
  }
  if (!token) return null;

  const parts = token
    .split('.')
    .map((part) => stripIdentQuotes(part.trim()))
    .filter(Boolean);
  if (parts.length >= 2) {
    const schema = parts[parts.length - 2];
    const table = parts[parts.length - 1];
    if (!schema || !table) return null;
    return { schema, table };
  }

  const name = parts[0];
  if (!name || !/^[\w$#@]+$/u.test(name)) return null;

  const byAlias = resolveTableRefByAlias(fullSql, name);
  if (byAlias.table) {
    return { schema: byAlias.schema, table: byAlias.table };
  }
  return { table: name };
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

  // 别名.字段 / 表.字段 / schema.表名（第二段）
  if (dotted.length >= 2) {
    const left = dotted[0] || '';
    const afterDotTable = TABLE_HINT_RE.test(lookback.replace(/\.\s*$/, ' '));
    // 字段补全只替换点号后的字段名，避免选中后冲掉别名/表前缀（a.id → id）
    const fieldReplaceFrom = pos - prefix.length;

    // FROM/JOIN/UPDATE 后的 schema.table：优先当「表补全」，不要把 schema 误当成别名去补字段
    // 例：JOIN other_db.lm_  → 表补全；WHERE a.  → 字段补全
    if (TABLE_HINT_RE.test(lookback) || afterDotTable) {
      return {
        kind: 'table',
        prefix,
        schema: left,
        replaceFrom: fieldReplaceFrom,
        replaceTo,
      };
    }

    const byAlias = resolveTableRefByAlias(stmtAll, left);
    if (byAlias.table) {
      return {
        kind: 'column',
        prefix,
        schema: byAlias.schema || primary.schema,
        table: byAlias.table,
        replaceFrom: fieldReplaceFrom,
        replaceTo,
      };
    }
    // left 就是已知表名（无别名）
    if (
      primary.table &&
      left.toLowerCase() === primary.table.toLowerCase()
    ) {
      return {
        kind: 'column',
        prefix,
        schema: primary.schema,
        table: primary.table,
        replaceFrom: fieldReplaceFrom,
        replaceTo,
      };
    }
    // 无法解析时：若像 schema.table（无表上下文）仍走表补全
    if (!primary.table) {
      return {
        kind: 'table',
        prefix,
        schema: left,
        replaceFrom: fieldReplaceFrom,
        replaceTo,
      };
    }
    // 兜底：把 left 当表名做字段补全（可能跨库未解析到）
    return {
      kind: 'column',
      prefix,
      schema: primary.schema,
      table: left,
      replaceFrom: fieldReplaceFrom,
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
 * 标识符补全相关度（越小越靠前）：
 * 0 全词精确 → 1 全词前缀 → 2 分段前缀 → 3 较长子串包含
 * 刻意不做「子序列模糊」（太松，短前缀会冒出大量不相干表）
 */
export function scoreIdentMatch(name: string, prefix: string): number | null {
  const n = (name || '').toLowerCase();
  const p = (prefix || '').toLowerCase();
  if (!n) return null;
  if (!p) return 50;
  if (n === p) return 0;
  // 整段输入的前缀匹配（gb_t_p → gb_t_project）——最高优先
  if (n.startsWith(p)) return 1;

  const nParts = n.split(/[_\-.]+/).filter(Boolean);
  const pParts = p.split(/[_\-.]+/).filter(Boolean);

  // 多段逐段前缀：gb + t + pro → gb_t_project
  if (pParts.length > 1 && nParts.length >= pParts.length) {
    let ok = true;
    for (let i = 0; i < pParts.length; i++) {
      if (!nParts[i]!.startsWith(pParts[i]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return 2;
  }

  // 仅当输入已较长时，才允许「某一段以整段输入开头」（避免 pro 扫出上百张表）
  if (p.length >= 4 && nParts.some((part) => part.startsWith(p))) return 2;

  // 包含：至少 3 字符，且更偏向名字较短的表（在 match 里二次排序）
  if (p.length >= 3 && n.includes(p)) return 3;

  return null;
}

/**
 * 表名补全：整段输入前缀绝对优先；同档按「剩余未匹配长度」短的在前。
 * 前缀命中与模糊命中分桶截断，避免短前缀被不相干表占满前 100。
 */
export function matchTableSuggestions(
  tables: TableNameItem[],
  ctx: SqlCompletionContext,
  currentInstance?: string,
): TableNameItem[] {
  const prefix = (ctx.prefix || '').toLowerCase();
  const schemaFilter = (ctx.schema || '').toLowerCase();
  const prefixLen = prefix.length;

  const scored: { item: TableNameItem; score: number; name: string; rest: number }[] =
    [];
  for (const t of tables) {
    const name = (t.tableName || '').toLowerCase();
    const sch = (t.schema || currentInstance || '').toLowerCase();
    if (schemaFilter && sch && sch !== schemaFilter) continue;
    const score = scoreIdentMatch(t.tableName, prefix);
    if (score == null) continue;
    const rest =
      score <= 1 && prefixLen > 0
        ? Math.max(0, name.length - prefixLen)
        : name.length;
    scored.push({ item: t, score, name, rest });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.rest - b.rest ||
      a.name.localeCompare(b.name),
  );

  const prefixHits = scored.filter((s) => s.score <= 1);
  const segmentHits = scored.filter((s) => s.score === 2);
  const otherHits = scored.filter((s) => s.score >= 3);

  // 前缀档尽量留足名额，模糊档严格限额
  const merged = [
    ...prefixHits.slice(0, 20),
    ...segmentHits.slice(0, 8),
    ...otherHits.slice(0, 5),
  ];
  return merged.slice(0, 20).map((x) => x.item);
}

export function matchColumnSuggestions(
  columns: string[],
  prefix: string,
): string[] {
  const p = prefix || '';
  const scored: { name: string; score: number; rest: number }[] = [];
  for (const c of columns) {
    const score = scoreIdentMatch(c, p);
    if (score == null) continue;
    const name = c.toLowerCase();
    const rest =
      score <= 1 && p.length > 0
        ? Math.max(0, name.length - p.length)
        : name.length;
    scored.push({ name: c, score, rest });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.rest - b.rest ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  const prefixHits = scored.filter((s) => s.score <= 1);
  const restHits = scored.filter((s) => s.score > 1);
  return [...prefixHits, ...restHits.slice(0, 40)].map((x) => x.name);
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
  // v2：旧缓存可能把主键漏成空（Jackson primary / isPrimary），换 key 强制重拉
  return `v2::${dbConfigId}::${instanceName}::${tableName}`.toLowerCase();
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
