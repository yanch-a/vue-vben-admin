/**
 * SQL 编辑器辅助算法（补全上下文 / 表字段缓存 / 按分号切执行语句）
 *
 * 设计要点：
 * 1. 根据光标前语义判断「写表名」还是「写字段名」，避免每次按键都打接口
 * 2. 表名补全优先用左侧已加载的表清单；支持 db.table 按库匹配
 * 3. 字段补全仅在识别到表之后按需请求，并写入客户端 LRU 缓存
 * 4. 执行时按分号切分：无选区只发「光标所在语句」；选区含多条时整段交给分步执行
 * 5. 光标落在 SET @变量 / PREPARE 上时，把前后依赖的语句收成一次执行，保证变量还在同一个连接上
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

function isSqlIdentStart(c: string | undefined): boolean {
  return !!c && /[A-Za-z_\u0080-\uFFFF#]/.test(c);
}

function isSqlIdentPart(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9_\u0080-\uFFFF#$]/.test(c);
}

function matchSqlWord(text: string, pos: number, word: string): boolean {
  if (pos < 0 || pos + word.length > text.length) return false;
  if (pos > 0 && isSqlIdentPart(text[pos - 1])) return false;
  if (text.slice(pos, pos + word.length).toLowerCase() !== word.toLowerCase()) return false;
  return !isSqlIdentPart(text[pos + word.length]);
}

function skipSqlWord(text: string, pos: number, stopDelimiter = ';'): number {
  let p = pos;
  if (isSqlIdentStart(text[p])) {
    p++;
    // $ 属于标识符字符，但 END$$ 里的 $$ 是终止符，不能被单词吞掉
    while (isSqlIdentPart(text[p])) {
      if (stopDelimiter !== ';' && text.startsWith(stopDelimiter, p)) break;
      p++;
    }
  }
  return p;
}

/** 跳过空白和注释，不越过字符串。供例程头识别使用。 */
function skipSqlTrivia(text: string, pos: number): number {
  let p = pos;
  while (p < text.length) {
    const c = text[p]!;
    const n = text[p + 1];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      p++;
      continue;
    }
    if (c === '-' && n === '-') {
      while (p < text.length && text[p] !== '\n' && text[p] !== '\r') p++;
      continue;
    }
    if (c === '#') {
      while (p < text.length && text[p] !== '\n' && text[p] !== '\r') p++;
      continue;
    }
    if (c === '/' && n === '*') {
      p += 2;
      while (p + 1 < text.length && !(text[p] === '*' && text[p + 1] === '/')) p++;
      p = p + 1 < text.length ? p + 2 : text.length;
      continue;
    }
    break;
  }
  return p;
}

function skipQuotedSpan(text: string, pos: number, quote: string): number {
  let p = pos + 1;
  while (p < text.length) {
    const d = text[p]!;
    p++;
    if (d === quote) {
      if (text[p] === quote) {
        p++;
        continue;
      }
      break;
    }
    if (d === '\\' && quote !== '`' && p < text.length) p++;
  }
  return p;
}

/**
 * 当前位置若是 $tag$ / $$ 美元引号，返回结束位置之后；否则返回原位置。
 * PostgreSQL 函数体里的分号必须整段跳过。
 */
function skipDollarQuoteSpan(text: string, pos: number): number {
  if (text[pos] !== '$') return pos;
  let i = pos + 1;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '$') {
      const tag = text.slice(pos, i + 1);
      const end = text.indexOf(tag, i + 1);
      return end < 0 ? text.length : end + tag.length;
    }
    if (!/[A-Za-z0-9_]/.test(c)) return pos;
    i++;
  }
  return pos;
}

function atSqlLineStart(text: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0) {
    const c = text[j]!;
    if (c === '\n' || c === '\r') return true;
    if (c === ' ' || c === '\t') {
      j--;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * CREATE/ALTER 过程、函数、触发器、事件。
 * 过程体里的分号属于同一条语句，不能当成下一条 SQL。
 */
function looksLikeSqlRoutine(text: string, pos: number): boolean {
  if (!matchSqlWord(text, pos, 'CREATE') && !matchSqlWord(text, pos, 'ALTER')) return false;
  let p = skipSqlWord(text, pos);
  for (let guard = 0; guard < 40 && p < text.length; guard++) {
    p = skipSqlTrivia(text, p);
    if (p >= text.length || text[p] === '(') break;
    if (
      matchSqlWord(text, p, 'PROCEDURE') ||
      matchSqlWord(text, p, 'FUNCTION') ||
      matchSqlWord(text, p, 'TRIGGER') ||
      matchSqlWord(text, p, 'EVENT') ||
      matchSqlWord(text, p, 'PROC')
    ) {
      return true;
    }
    if (
      matchSqlWord(text, p, 'TABLE') ||
      matchSqlWord(text, p, 'INDEX') ||
      matchSqlWord(text, p, 'VIEW') ||
      matchSqlWord(text, p, 'DATABASE') ||
      matchSqlWord(text, p, 'SCHEMA') ||
      matchSqlWord(text, p, 'USER')
    ) {
      return false;
    }
    if (text[p] === '`' || text[p] === "'" || text[p] === '"') {
      p = skipQuotedSpan(text, p, text[p]!);
      continue;
    }
    if (isSqlIdentStart(text[p])) {
      p = skipSqlWord(text, p);
      continue;
    }
    p++;
  }
  return false;
}

/** BEGIN 后面跟事务关键字时，不是过程块 */
function isTxnAfterBegin(text: string, pos: number): boolean {
  return (
    matchSqlWord(text, pos, 'TRANSACTION') ||
    matchSqlWord(text, pos, 'TRAN') ||
    matchSqlWord(text, pos, 'WORK') ||
    matchSqlWord(text, pos, 'DEFERRED') ||
    matchSqlWord(text, pos, 'IMMEDIATE') ||
    matchSqlWord(text, pos, 'EXCLUSIVE')
  );
}

/** END IF / END LOOP 等是复合语句的结束，不是 BEGIN 块的 END */
function isCompoundEndWord(text: string, pos: number): boolean {
  return (
    matchSqlWord(text, pos, 'IF') ||
    matchSqlWord(text, pos, 'LOOP') ||
    matchSqlWord(text, pos, 'WHILE') ||
    matchSqlWord(text, pos, 'REPEAT') ||
    matchSqlWord(text, pos, 'CASE')
  );
}

/** BEGIN 后面是语句、并且有配对的 END 时，整段 BEGIN...END 算一条。没有 END 就按分号拆，避免把后面的语句吞掉。 */
function opensAnonymousBlock(text: string, pos: number): boolean {
  if (matchSqlWord(text, pos, 'BEGIN')) {
    const after = skipSqlTrivia(text, skipSqlWord(text, pos));
    if (isTxnAfterBegin(text, after) || text[after] === ';') return false;
    return hasMatchingBlockEnd(text, pos);
  }
  if (matchSqlWord(text, pos, 'DECLARE')) {
    return declareReachesBegin(text, pos);
  }
  return false;
}

/**
 * 从 BEGIN 往后找配对的 END。END IF 不算，字符串和注释里的 END 也不算。
 * 中途遇到单独一行的 GO 或 /，说明块没有在这个批次里结束。
 */
function hasMatchingBlockEnd(text: string, beginPos: number): boolean {
  const n = text.length;
  let i = beginPos;
  let depth = 0;
  let atStmtStart = true;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '-' && next === '-') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '#') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = i + 1 < n ? i + 2 : n;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuotedSpan(text, i, c);
      atStmtStart = false;
      continue;
    }
    if (c === '$') {
      const dollarEnd = skipDollarQuoteSpan(text, i);
      if (dollarEnd > i) {
        i = dollarEnd;
        atStmtStart = false;
        continue;
      }
    }
    if (atSqlLineStart(text, i) && (matchSqlWord(text, i, 'GO') || (c === '/' && next !== '*'))) {
      return false;
    }
    if (isSqlIdentStart(c)) {
      if (matchSqlWord(text, i, 'BEGIN')) {
        const after = skipSqlWord(text, i);
        const p = skipSqlTrivia(text, after);
        if (matchSqlWord(text, p, 'ATOMIC')) {
          depth++;
          i = skipSqlWord(text, p);
          atStmtStart = true;
          continue;
        }
        if (isTxnAfterBegin(text, p) || text[p] === ';') {
          i = after;
          atStmtStart = false;
          continue;
        }
        depth++;
        i = after;
        atStmtStart = true;
        continue;
      }
      if (matchSqlWord(text, i, 'END')) {
        const after = skipSqlWord(text, i);
        const p = skipSqlTrivia(text, after);
        if (isCompoundEndWord(text, p)) {
          i = skipSqlWord(text, p);
          atStmtStart = false;
          continue;
        }
        if (depth > 0 && atStmtStart) {
          depth--;
          if (depth === 0) return true;
        }
        i = after;
        atStmtStart = false;
        continue;
      }
      i = skipSqlWord(text, i);
      atStmtStart = false;
      continue;
    }
    if (c === ';') {
      atStmtStart = true;
      i++;
      continue;
    }
    i++;
    atStmtStart = false;
  }
  return false;
}

/**
 * Oracle 的 DECLARE ... BEGIN ... END 中间有分号，但仍是一条匿名块。
 * DECLARE @x; SELECT @x 这种没有 BEGIN 的声明要拆开。
 */
function declareReachesBegin(text: string, pos: number): boolean {
  const n = text.length;
  let j = pos;
  let paren = 0;
  while (j < n) {
    const c = text[j]!;
    const next = text[j + 1];
    if (c === '-' && next === '-') {
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      continue;
    }
    if (c === '#') {
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      continue;
    }
    if (c === '/' && next === '*') {
      j += 2;
      while (j + 1 < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j = j + 1 < n ? j + 2 : n;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      j = skipQuotedSpan(text, j, c);
      continue;
    }
    if (c === '$') {
      const dollarEnd = skipDollarQuoteSpan(text, j);
      if (dollarEnd > j) {
        j = dollarEnd;
        continue;
      }
    }
    if (c === '(') {
      paren++;
      j++;
      continue;
    }
    if (c === ')') {
      paren = Math.max(0, paren - 1);
      j++;
      continue;
    }
    if (paren === 0 && isSqlIdentStart(c)) {
      if (matchSqlWord(text, j, 'BEGIN')) {
        const after = skipSqlTrivia(text, skipSqlWord(text, j));
        if (isTxnAfterBegin(text, after) || text[after] === ';') return false;
        return hasMatchingBlockEnd(text, j);
      }
      if (
        matchSqlWord(text, j, 'SELECT') ||
        matchSqlWord(text, j, 'INSERT') ||
        matchSqlWord(text, j, 'UPDATE') ||
        matchSqlWord(text, j, 'DELETE') ||
        matchSqlWord(text, j, 'CREATE') ||
        matchSqlWord(text, j, 'ALTER') ||
        matchSqlWord(text, j, 'DROP') ||
        matchSqlWord(text, j, 'WITH') ||
        matchSqlWord(text, j, 'SET') ||
        matchSqlWord(text, j, 'COMMIT') ||
        matchSqlWord(text, j, 'ROLLBACK') ||
        matchSqlWord(text, j, 'CALL') ||
        matchSqlWord(text, j, 'EXEC') ||
        matchSqlWord(text, j, 'EXECUTE') ||
        matchSqlWord(text, j, 'MERGE') ||
        matchSqlWord(text, j, 'USE') ||
        matchSqlWord(text, j, 'PREPARE')
      ) {
        return false;
      }
      j = skipSqlWord(text, j);
      continue;
    }
    if (atSqlLineStart(text, j) && (matchSqlWord(text, j, 'GO') || (c === '/' && next !== '*'))) {
      return false;
    }
    j++;
  }
  return false;
}

/**
 * 按分号切分 SQL，忽略字符串、注释、美元引号里的分号。
 * 存储过程 / 函数 / 触发器 / 事件整段算一条：BEGIN...END 内部的分号不切开。
 * 匿名 BEGIN...END、DECLARE...BEGIN...END 同样保持一条。BEGIN; / BEGIN WORK 仍是单独的事务语句。
 * MySQL 的 DELIMITER 只改变终止符，本身不送给数据库。
 * 返回每条语句在原文中的 [start, end)（不含末尾终止符）。
 */
export function splitSqlStatements(fullText: string): SqlRange[] {
  const ranges: SqlRange[] = [];
  const text = fullText || '';
  const n = text.length;
  let delimiter = ';';
  let i = 0;

  const pushRange = (from: number, end: number) => {
    let s = from;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) ranges.push({ start: s, end: e });
  };

  const skipRestOfLine = () => {
    while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
  };

  while (i < n) {
    i = skipSqlTrivia(text, i);
    if (i >= n) break;

    // DELIMITER $$ 这类客户端指令不执行，只切换后面语句的结束符
    if (atSqlLineStart(text, i) && matchSqlWord(text, i, 'DELIMITER')) {
      i = skipSqlWord(text, i);
      while (text[i] === ' ' || text[i] === '\t') i++;
      const d0 = i;
      while (i < n && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') i++;
      const next = text.slice(d0, i).trim();
      if (next) delimiter = next;
      skipRestOfLine();
      continue;
    }

    // 单独一行的 GO 或 / 是客户端提交符，不作为 SQL
    if (atSqlLineStart(text, i) && matchSqlWord(text, i, 'GO')) {
      const after = skipSqlTrivia(text, skipSqlWord(text, i));
      if (after >= n || text[after] === '\n' || text[after] === '\r' || text[after] === ';') {
        skipRestOfLine();
        continue;
      }
    }
    if (atSqlLineStart(text, i) && text[i] === '/' && text[i + 1] !== '*') {
      const after = skipSqlTrivia(text, i + 1);
      if (after >= n || text[after] === '\n' || text[after] === '\r') {
        skipRestOfLine();
        continue;
      }
    }

    const start = i;
    const routine = looksLikeSqlRoutine(text, i);
    const anonymous = !routine && opensAnonymousBlock(text, i);
    let depth = 0;
    let closed = false;
    // DECLARE 段里的分号先不切开，等到 BEGIN 再按块深度计算
    let holdingDeclare = anonymous && matchSqlWord(text, i, 'DECLARE');
    // 只有语句开头的 END 才关闭 BEGIN，字段名 end 不能把过程切开
    let atStmtStart = false;

    while (i < n) {
      const c = text[i]!;
      const next = text[i + 1];

      if (c === '-' && next === '-') {
        while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      if (c === '#') {
        while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      if (c === '/' && next === '*') {
        i += 2;
        while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i = i + 1 < n ? i + 2 : n;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        i = skipQuotedSpan(text, i, c);
        continue;
      }
      if (delimiter === ';') {
        const dollarEnd = skipDollarQuoteSpan(text, i);
        if (dollarEnd > i) {
          i = dollarEnd;
          continue;
        }
      }
      // SQL Server 的 GO、Oracle 的单独一行 /：结束当前过程，符号本身不执行
      if (atSqlLineStart(text, i) && matchSqlWord(text, i, 'GO')) {
        const afterGo = skipSqlTrivia(text, skipSqlWord(text, i));
        if (afterGo >= n || text[afterGo] === '\n' || text[afterGo] === '\r' || text[afterGo] === ';') {
          pushRange(start, i);
          closed = true;
          break;
        }
      }
      if (routine && atSqlLineStart(text, i) && c === '/' && next !== '*') {
        const afterSlash = skipSqlTrivia(text, i + 1);
        if (afterSlash >= n || text[afterSlash] === '\n' || text[afterSlash] === '\r') {
          pushRange(start, i);
          closed = true;
          break;
        }
      }
      if (delimiter !== ';' && text.startsWith(delimiter, i)) {
        pushRange(start, i);
        i += delimiter.length;
        closed = true;
        break;
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i++;
        continue;
      }
      if ((routine || anonymous) && delimiter === ';' && matchSqlWord(text, i, 'BEGIN')) {
        const after = skipSqlWord(text, i, delimiter);
        const p = skipSqlTrivia(text, after);
        if (matchSqlWord(text, p, 'ATOMIC')) {
          depth++;
          holdingDeclare = false;
          i = skipSqlWord(text, p, delimiter);
          atStmtStart = true;
          continue;
        }
        if (isTxnAfterBegin(text, p) || text[p] === ';') {
          i = after;
          atStmtStart = false;
          continue;
        }
        depth++;
        holdingDeclare = false;
        i = after;
        atStmtStart = true;
        continue;
      }
      if ((routine || anonymous) && matchSqlWord(text, i, 'END')) {
        const after = skipSqlWord(text, i, delimiter);
        const p = skipSqlTrivia(text, after);
        if (isCompoundEndWord(text, p)) {
          i = skipSqlWord(text, p, delimiter);
          atStmtStart = false;
          continue;
        }
        if (depth > 0 && atStmtStart) depth--;
        i = after;
        atStmtStart = false;
        continue;
      }
      if (c === ';' && delimiter === ';' && depth === 0 && !holdingDeclare) {
        pushRange(start, i);
        i++;
        closed = true;
        break;
      }
      if (c === ';' && delimiter === ';') {
        i++;
        atStmtStart = true;
        continue;
      }
      if (isSqlIdentStart(c)) {
        i = skipSqlWord(text, i, delimiter);
        atStmtStart = false;
        continue;
      }
      i++;
      atStmtStart = false;
    }

    if (!closed) {
      pushRange(start, n);
      break;
    }
  }
  return ranges;
}

/**
 * 取出按分号切开的语句文本（已去掉首尾空白）。
 * 编辑器用来判断选区里是不是多条 SQL。
 */
export function listSqlStatements(fullText: string): string[] {
  const text = fullText || '';
  return splitSqlStatements(text)
    .map((range) => text.slice(range.start, range.end).trim())
    .filter((sql) => sql.length > 0);
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

/**
 * 去掉注释和引号后的首关键字，用来判断是不是 SET / PREPARE。
 */
function leadingKeyword(sql: string): string {
  const masked = maskSqlLiterals(sql).trim();
  const matched = masked.match(/^([A-Za-z]+)/);
  return (matched?.[1] || '').toUpperCase();
}

/** 注释和字符串里的内容不参与变量、关键字判断 */
function maskSqlLiterals(sql: string): string {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`[^`]*`/g, ' ');
}

/** SET、事务、DECLARE、USE、PREPARE。单独发给只读查询接口会被拒绝。 */
export function isEditorSessionSql(sql: string): boolean {
  const head = leadingKeyword(sql);
  return (
    head === 'SET' ||
    head === 'PREPARE' ||
    head === 'EXECUTE' ||
    head === 'DEALLOCATE' ||
    head === 'BEGIN' ||
    head === 'COMMIT' ||
    head === 'ROLLBACK' ||
    head === 'SAVEPOINT' ||
    head === 'RELEASE' ||
    head === 'DECLARE' ||
    head === 'USE' ||
    head === 'START'
  );
}

/** PREPARE / EXECUTE 可能改数据，确认框要把它算成写操作 */
export function isPreparedScriptSql(sql: string): boolean {
  const head = leadingKeyword(sql);
  return head === 'PREPARE' || head === 'EXECUTE';
}

/** SET @变量，不含 SET NAMES / SET GLOBAL */
function isUserVarAssignment(sql: string): boolean {
  return leadingKeyword(sql) === 'SET' && /\bSET\s+@(?!@)/i.test(maskSqlLiterals(sql));
}

function isPrepareFamily(sql: string): boolean {
  const head = leadingKeyword(sql);
  return head === 'PREPARE' || head === 'EXECUTE' || head === 'DEALLOCATE';
}

/** 语句里出现的用户变量，忽略 @@系统变量。传入的文本应已经去掉注释和字符串。 */
function userVarsIn(masked: string): string[] {
  const found: string[] = [];
  const re = /(^|[^@])@([A-Za-z_][A-Za-z0-9_]*)/g;
  let matched: RegExpExecArray | null;
  while ((matched = re.exec(masked))) {
    found.push(matched[2]!.toLowerCase());
  }
  return found;
}

/**
 * 真正读到的用户变量。
 * SET @a := 1 只是赋值，不能算成「用了 @a」，否则后面重新 SET @a 会被误收进来。
 * SET @a := @b 读的是 @b。
 */
function readVars(sql: string): string[] {
  const masked = maskSqlLiterals(sql).replace(/@([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)/gi, ' ');
  return userVarsIn(masked);
}

/** SET @a := ... / SET @a = ...，以及 SQL Server 的 DECLARE @a */
function assignedVarsOf(sql: string): string[] {
  const head = leadingKeyword(sql);
  const masked = maskSqlLiterals(sql);
  const found: string[] = [];
  if (head === 'SET') {
    const re = /@([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)/gi;
    let matched: RegExpExecArray | null;
    while ((matched = re.exec(masked))) {
      found.push(matched[1]!.toLowerCase());
    }
    return found;
  }
  if (head === 'DECLARE') {
    const re = /@([A-Za-z_][A-Za-z0-9_]*)/gi;
    let matched: RegExpExecArray | null;
    while ((matched = re.exec(masked))) {
      found.push(matched[1]!.toLowerCase());
    }
  }
  return found;
}

/** CREATE TEMPORARY / TEMP TABLE 的表名。没有就是空串。 */
function tempTableName(sql: string): string {
  const masked = maskSqlLiterals(sql);
  const matched = masked.match(
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*)?(`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z_][\w$]*)/i,
  );
  if (!matched?.[1]) return '';
  return matched[1].replace(/^[`"[]|[`"\]]$/g, '').toLowerCase();
}

function mentionsIdent(sql: string, name: string): boolean {
  if (!name) return false;
  const masked = maskSqlLiterals(sql);
  const re = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`, 'i');
  return re.test(masked);
}

/** PREPARE / EXECUTE / DEALLOCATE 操作的语句名；对不上就不是同一条预处理链 */
function preparedName(sql: string): string {
  const masked = maskSqlLiterals(sql).trim();
  const prepare = masked.match(/^PREPARE\s+([A-Za-z_][A-Za-z0-9_]*)\s+FROM\b/i);
  if (prepare) return prepare[1]!.toLowerCase();
  const execute = masked.match(/^EXECUTE\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  if (execute) return execute[1]!.toLowerCase();
  const drop = masked.match(/^DEALLOCATE\s+PREPARE\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  if (drop) return drop[1]!.toLowerCase();
  return '';
}

/** 链里读到、但链内还没有赋值的用户变量，必须到更前面的 SET 里找 */
function unresolvedReads(statements: string[], included: Set<number>): Set<string> {
  const needed = new Set<string>();
  const defined = new Set<string>();
  const order = [...included].sort((a, b) => a - b);
  for (const index of order) {
    for (const name of readVars(statements[index] || '')) {
      if (!defined.has(name)) needed.add(name);
    }
    for (const name of assignedVarsOf(statements[index] || '')) defined.add(name);
  }
  return needed;
}

/** EXECUTE / DEALLOCATE 用到、但链内还没有 PREPARE 的语句名 */
function unresolvedPrepares(statements: string[], included: Set<number>): Set<string> {
  const needed = new Set<string>();
  const defined = new Set<string>();
  const order = [...included].sort((a, b) => a - b);
  for (const index of order) {
    const sql = statements[index] || '';
    const head = leadingKeyword(sql);
    const name = preparedName(sql);
    if ((head === 'EXECUTE' || head === 'DEALLOCATE') && name && !defined.has(name)) {
      needed.add(name);
    }
    if (head === 'PREPARE' && name) defined.add(name);
  }
  return needed;
}

function isDeclareVar(sql: string): boolean {
  return leadingKeyword(sql) === 'DECLARE' && assignedVarsOf(sql).length > 0;
}

/**
 * 下一条是否还依赖当前这串语句。
 * 紧挨着的 SET @变量会先收成一组，这样光标放在第一条 SET 上也能带上后面的 INSERT。
 * 中间夹着的无关 INSERT / DELETE 不会因为前后都是 SET 就被执行。
 */
function sessionFeedsNext(statements: string[], included: Set<number>, end: number): boolean {
  const last = statements[end] || '';
  const next = statements[end + 1] || '';
  if (isUserVarAssignment(last) && isUserVarAssignment(next)) return true;
  if (isDeclareVar(last) && isDeclareVar(next)) return true;
  const assigned = new Set<string>();
  const prepared = new Set<string>();
  for (const index of included) {
    for (const name of assignedVarsOf(statements[index] || '')) assigned.add(name);
    if (leadingKeyword(statements[index] || '') === 'PREPARE') {
      const name = preparedName(statements[index] || '');
      if (name) prepared.add(name);
    }
  }
  if (readVars(next).some((name) => assigned.has(name))) return true;
  const temp = tempTableName(last);
  if (temp && mentionsIdent(next, temp)) return true;
  const nextName = preparedName(next);
  const nextHead = leadingKeyword(next);
  if (nextName && prepared.has(nextName) && (nextHead === 'EXECUTE' || nextHead === 'DEALLOCATE')) {
    return true;
  }
  const lastName = preparedName(last);
  return isPrepareFamily(last) && isPrepareFamily(next) && !!lastName && lastName === nextName;
}

/**
 * 光标没有选区时，把提供变量的 SET、对应的 PREPARE，以及紧跟着使用它们的语句收成一次执行。
 * 变量只在同一个连接里有效。中间无关的增删语句不会被捎上，避免点一条 INSERT 却把前面的 DELETE 跑掉。
 * cursorOffset 用来区分全文里两段完全相同的语句，避免总命中第一段。
 * 调用方在用户自己框选了语句时不要扩展。SET NAMES 不会把后面无关的 CREATE TABLE 带上。
 */
export function expandSessionChain(fullText: string, currentSql: string, cursorOffset?: number): string {
  const current = (currentSql || '').trim();
  if (!current) return current;
  const text = fullText || '';
  const pairs = splitSqlStatements(text)
    .map((range) => ({ range, sql: text.slice(range.start, range.end).trim() }))
    .filter((item) => item.sql.length > 0);
  if (pairs.length <= 1) return current;
  const statements = pairs.map((item) => item.sql);
  const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const wanted = flat(current);
  let index = -1;
  if (typeof cursorOffset === 'number') {
    index = pairs.findIndex((item) => cursorOffset >= item.range.start && cursorOffset <= item.range.end);
    if (index < 0) {
      // 光标停在语句后面的空白或分号上，仍算这一条
      index = pairs.findIndex((item) => {
        let pos = item.range.end;
        while (pos < text.length && /\s/.test(text[pos] || '')) pos += 1;
        if (pos < text.length && text[pos] === ';') pos += 1;
        return cursorOffset >= item.range.start && cursorOffset <= pos;
      });
    }
  }
  if (index < 0) {
    index = statements.findIndex((sql) => sql === current || flat(sql) === wanted);
  }
  if (index < 0) return current;

  const included = new Set<number>([index]);
  let grew = true;
  while (grew) {
    grew = false;
    const end = Math.max(...included);
    if (end + 1 < statements.length && sessionFeedsNext(statements, included, end)) {
      included.add(end + 1);
      grew = true;
    }
    const neededVars = unresolvedReads(statements, included);
    const neededPrepares = unresolvedPrepares(statements, included);
    const temps = new Set<string>();
    for (const item of included) {
      const name = tempTableName(statements[item] || '');
      if (name) temps.add(name);
    }
    for (let prev = Math.min(...included) - 1; prev >= 0; prev -= 1) {
      const name = tempTableName(statements[prev] || '');
      if (!name || temps.has(name)) continue;
      const used = [...included].some((item) => mentionsIdent(statements[item] || '', name));
      if (!used) continue;
      included.add(prev);
      temps.add(name);
      grew = true;
    }
    if (neededVars.size === 0 && neededPrepares.size === 0) continue;
    // 从近到远找赋值。找到后就不再要更早的同名 SET，避免把上一节的 @op_id 也带上
    const start = Math.min(...included);
    for (let prev = start - 1; prev >= 0 && (neededVars.size > 0 || neededPrepares.size > 0); prev -= 1) {
      const sql = statements[prev] || '';
      let provides = false;
      for (const name of assignedVarsOf(sql)) {
        if (!neededVars.has(name)) continue;
        neededVars.delete(name);
        provides = true;
      }
      const prepared = preparedName(sql);
      if (leadingKeyword(sql) === 'PREPARE' && prepared && neededPrepares.has(prepared)) {
        neededPrepares.delete(prepared);
        provides = true;
      }
      if (provides && !included.has(prev)) {
        included.add(prev);
        grew = true;
      }
    }
  }
  if (included.size === 1) return current;
  return [...included]
    .sort((a, b) => a - b)
    .map((item) => statements[item] || '')
    .join(';\n');
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
