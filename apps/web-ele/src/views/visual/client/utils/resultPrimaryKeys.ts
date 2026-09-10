/**
 * 结果行改删用的主键识别。
 * getTableColumns 的布尔主键在 Jackson 里可能是 isPrimary / primary；
 * 认不全时再从索引名 PRIMARY、DDL 的 PRIMARY KEY (...) 兜底。
 *
 * @author yanch
 */

const SKIP_NO_PK_WARN_KEY = 'lemon-visual-client:skip-no-pk-warn-until';
const SKIP_NO_PK_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldSkipNoPkWarn(): boolean {
  try {
    const until = Number(localStorage.getItem(SKIP_NO_PK_WARN_KEY) || '');
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

export function rememberSkipNoPkWarn() {
  try {
    localStorage.setItem(SKIP_NO_PK_WARN_KEY, String(Date.now() + SKIP_NO_PK_MS));
  } catch {
    /* 无痕模式忽略 */
  }
}

function truthyFlag(v: unknown): boolean {
  return (
    v === true ||
    v === 1 ||
    v === '1' ||
    v === 'true' ||
    v === 'TRUE' ||
    v === 'YES' ||
    v === 'PRI'
  );
}

function columnName(c: any): string {
  return String(c?.fieldName || c?.columnName || c?.name || '').trim();
}

/** 单列对象是否标了主键（兼容多种 JSON 字段名） */
export function columnLooksPrimary(c: any): boolean {
  if (!c || typeof c !== 'object') return false;
  if (truthyFlag(c.isPrimary)) return true;
  if (truthyFlag(c.primary)) return true;
  if (truthyFlag(c.isPrimaryKey)) return true;
  if (truthyFlag(c.primaryKey)) return true;
  if (truthyFlag(c.pk)) return true;
  const key = String(c.columnKey || c.COLUMN_KEY || '').toUpperCase();
  if (key === 'PRI') return true;
  for (const [k, v] of Object.entries(c)) {
    if (!/primary/i.test(k) && !/(^|_)pk$/i.test(k)) continue;
    if (truthyFlag(v)) return true;
  }
  return false;
}

export function primaryKeysFromColumns(list: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(list) ? list : []) {
    if (!columnLooksPrimary(c)) continue;
    const name = columnName(c);
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

function splitIndexCols(raw: string): string[] {
  return String(raw || '')
    .split(/[,;]/)
    .map((s) => s.trim().replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, ''))
    .filter(Boolean);
}

function isPrimaryIndexName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (n.toUpperCase() === 'PRIMARY') return true;
  if (/^pk_/i.test(n)) return true;
  if (/_pkey$/i.test(n)) return true;
  if (/primary\s*key/i.test(n)) return true;
  return false;
}

export function primaryKeysFromIndexes(indexes: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const idx of Array.isArray(indexes) ? indexes : []) {
    if (!isPrimaryIndexName(idx?.indexName || idx?.index_name || '')) continue;
    for (const name of splitIndexCols(idx?.columns || idx?.columnName || '')) {
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
  }
  return out;
}

/** 从 CREATE TABLE DDL 抽 PRIMARY KEY (a, b) */
export function primaryKeysFromDdl(ddl: string): string[] {
  if (!ddl) return [];
  const m = String(ddl).match(
    /PRIMARY\s+KEY\s*(?:\w+\s*)?\(\s*([^)]+?)\s*\)/i,
  );
  if (!m?.[1]) return [];
  return splitIndexCols(m[1]);
}

export function mergePrimaryKeys(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const name of group || []) {
      const n = String(name || '').trim();
      const k = n.toLowerCase();
      if (!n || seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}
