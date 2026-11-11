/**
 * 查询结果 → 可粘贴到 Excel 的 TSV（含表头）
 * 规则对齐 Excel 粘贴：制表符分列、CRLF 分行，特殊字符加引号转义。
 *
 * @author yanch
 */

/**
 * 单个单元格转 TSV 字段：null/undefined → 空；含特殊字符则引号包裹
 */
function escapeTsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = value && typeof value === 'object' && '__lemonBinary' in value
    ? String((value as { __lemonBinary: unknown }).__lemonBinary)
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Excel 粘贴：含 tab / 换行 / 双引号时需用双引号包裹，内部 " → ""
  if (/[\t\r\n"]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 将结果行列转为 TSV 文本（第一行为表头），可直接粘贴到 Excel
 *
 * @param columns 列名（表头）
 * @param rows 数据行
 */
export function buildResultTsv(
  columns: string[],
  rows: Record<string, any>[],
): string {
  if (!columns.length) {
    return '';
  }
  const header = columns.map((c) => escapeTsvCell(c)).join('\t');
  const lines = rows.map((row) =>
    columns.map((col) => escapeTsvCell(row?.[col])).join('\t'),
  );
  return [header, ...lines].join('\r\n');
}

const RESULT_CELL_SELECTOR = '.vrt-td, .vrt-th';

function nodeElement(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

/**
 * 选区是否包住了整个单元格文本。
 * 双击或从格子一端拖到另一端时，选区常会冲出 span、落到块级 div 的边界上。
 */
function selectionCoversNode(range: Range, node: Node): boolean {
  const nodeRange = node.ownerDocument.createRange();
  try {
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
    );
  } catch {
    return false;
  }
}

/**
 * 去掉浏览器在块级格子末尾多写的那一个换行。
 * 单元格原文自己以换行结尾时保留，只丢掉多出来的那个。
 *
 * @param selectedText 选区纯文本
 * @param cellText 选区结束位置所在格子的原文；无法对照时传 null
 */
export function stripResultCopyTrailingBreak(
  selectedText: string,
  cellText: string | null,
): string {
  if (!/[\r\n]$/.test(selectedText)) return selectedText;
  if (cellText != null && /[\r\n]$/.test(cellText)) return selectedText;
  return selectedText.replace(/\r?\n$/, '');
}

/**
 * 结果表里的选区 → 应写入剪贴板的纯文本。
 * 选区不在这张表里、或正在编辑输入框时返回 null，调用方不要改写剪贴板。
 * 整格选中时直接用格子原文，避免块级 div 在末尾多一个换行。
 */
export function plainTextFromResultSelection(
  root: HTMLElement,
  selection: Selection,
): string | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
    return null;
  }
  if (nodeElement(anchor)?.closest('input, textarea, [contenteditable="true"]')) {
    return null;
  }
  const selectedText = selection.toString();
  if (!selectedText) return null;

  const range = selection.getRangeAt(0);
  const startCell = nodeElement(range.startContainer)?.closest(RESULT_CELL_SELECTOR);
  const endCell = nodeElement(range.endContainer)?.closest(RESULT_CELL_SELECTOR);
  if (startCell && startCell === endCell) {
    const span = startCell.querySelector('.vrt-cell-text');
    const cellText = span?.textContent ?? '';
    if (span && selectionCoversNode(range, span)) return cellText;
    return stripResultCopyTrailingBreak(selectedText, cellText);
  }

  const endSpan = nodeElement(range.endContainer)?.closest('.vrt-cell-text');
  return stripResultCopyTrailingBreak(
    selectedText,
    endSpan?.textContent ?? null,
  );
}
