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
  const text = String(value);
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
