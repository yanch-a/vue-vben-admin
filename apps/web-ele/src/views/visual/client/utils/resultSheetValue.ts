/**
 * 查询结果单元格编辑：对比 / 回写，避免 NULL 和类型被输入框改掉后误判脏行。
 *
 * 约定：
 * - 原值 NULL + 输入仍为空 → 仍是 NULL（不是空串）
 * - 原值有内容 + 用户清空 → 空字符串（与右键弹窗一致）
 * - 未变化的列直接回写原值
 *
 * @author yanch
 */

export interface DirtyRowEdit {
  /** 结果集行下标（不含表头） */
  rowIndex: number;
  original: Record<string, unknown>;
  edited: Record<string, unknown>;
  /** 实际变化的列，生成 UPDATE 时只 SET 这些列 */
  changedColumns: string[];
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined;
}

function isBlankSheetCell(v: unknown): boolean {
  if (isNullish(v)) return true;
  if (v === '') return true;
  if (typeof v === 'object' && v && 'v' in (v as object)) {
    return isBlankSheetCell((v as { v?: unknown }).v);
  }
  return false;
}

/** 从 Univer getValues / ICellData 取出展示用文本 */
export function sheetCellToText(cell: unknown): string {
  if (isNullish(cell)) return '';
  if (typeof cell === 'object') {
    if (cell instanceof Date) {
      return formatDateTime(cell);
    }
    if ('v' in (cell as object)) {
      return sheetCellToText((cell as { v?: unknown }).v);
    }
  }
  if (typeof cell === 'boolean') {
    return cell ? 'true' : 'false';
  }
  return String(cell);
}

/** 写入 Univer 的展示文本：NULL → 空；其余 String() */
export function toSheetText(value: unknown): string {
  if (isNullish(value)) return '';
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeDateText(s: string): string {
  return s
    .trim()
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/\.\d+$/, '')
    .replace(/\s+$/, '');
}

function looksLikeDateTime(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(s.trim());
}

function isNumericText(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t);
}

/**
 * 单元格相对原值是否未改。
 * 先比「我们写进去的文本」，再兼容 Univer 仍把文本读成 number/boolean/Date 的情况。
 */
export function isSheetCellUnchanged(original: unknown, sheetCell: unknown): boolean {
  if (isNullish(original)) {
    return isBlankSheetCell(sheetCell);
  }
  if (isBlankSheetCell(sheetCell)) {
    return false;
  }
  const written = toSheetText(original);
  const read = sheetCellToText(sheetCell);
  if (written === read) {
    return true;
  }

  const raw =
    sheetCell && typeof sheetCell === 'object' && 'v' in (sheetCell as object)
      ? (sheetCell as { v?: unknown }).v
      : sheetCell;

  if (typeof original === 'number' && typeof raw === 'number') {
    return original === raw;
  }
  if (typeof original === 'number' && isNumericText(read)) {
    return Number(read) === original;
  }
  if (typeof original === 'boolean') {
    const t = read.trim().toLowerCase();
    if (original && (t === 'true' || t === '1')) return true;
    if (!original && (t === 'false' || t === '0')) return true;
    return false;
  }
  if (typeof original === 'bigint') {
    try {
      return original === BigInt(read.trim());
    } catch {
      return false;
    }
  }
  // 原值是数字字符串，表格仍吐出 number：仅当文本形态一致才算没改（保住 001 / 1.0）
  if (typeof original === 'string' && typeof raw === 'number') {
    return String(raw) === original;
  }
  if (looksLikeDateTime(written) && looksLikeDateTime(read)) {
    return normalizeDateText(written) === normalizeDateText(read);
  }
  return false;
}

/**
 * 用户改过之后，按原值类型收回写类型。
 * 未改过的列不要走这里，直接用原值。
 */
export function coerceSheetValue(original: unknown, sheetCell: unknown): unknown {
  if (isBlankSheetCell(sheetCell)) {
    // 原 NULL 清空仍为 NULL；原有值被清空 → 空串
    return isNullish(original) ? null : '';
  }
  const text = sheetCellToText(sheetCell);
  if (typeof original === 'number') {
    const n = Number(text.trim());
    return Number.isFinite(n) ? n : text;
  }
  if (typeof original === 'boolean') {
    const t = text.trim().toLowerCase();
    if (t === 'true' || t === '1') return true;
    if (t === 'false' || t === '0') return false;
    return text;
  }
  if (typeof original === 'bigint') {
    try {
      return BigInt(text.trim());
    } catch {
      return text;
    }
  }
  if (original instanceof Date) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? text : d;
  }
  // 原 NULL 被填了内容：按文本写回，避免把 id 误推断成 number
  return text;
}

/** 已按原类型收回写的行：用同一套 NULL 规则比是否真改过 */
export function sameDbValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true;
  }
  return isSheetCellUnchanged(a, b);
}

/** 从对象行收集脏行（点选编辑用，不走 Univer 二维矩阵） */
export function collectDirtyFromRows(
  originalRows: Record<string, unknown>[],
  editedRows: Record<string, unknown>[],
  columns: string[],
): DirtyRowEdit[] {
  const out: DirtyRowEdit[] = [];
  originalRows.forEach((original, rowIndex) => {
    const edited = editedRows[rowIndex] || {};
    const changedColumns = columns.filter(
      (c) => !sameDbValue(original[c], edited[c]),
    );
    if (changedColumns.length) {
      out.push({
        rowIndex,
        original,
        edited: { ...original, ...edited },
        changedColumns,
      });
    }
  });
  return out;
}
