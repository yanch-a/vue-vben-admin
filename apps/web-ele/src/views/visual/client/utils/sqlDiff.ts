/**
 * 轻量行级 diff（LCS），用于 AI 卡片「与原 SQL 对比」。
 * SQL 通常几十行，O(n*m) 足够；超过阈值时退化为整段替换，避免卡顿。
 * @author yanch
 */

export type DiffLineType = 'add' | 'del' | 'same';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** 两侧行数乘积超过该值不再做 LCS */
const MAX_CELLS = 250_000;

function splitLines(s: string): string[] {
  const text = String(s ?? '').replace(/\r\n?/g, '\n');
  if (!text) return [];
  const lines = text.split('\n');
  // 末尾换行产生的空行不参与比较
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** 比较时忽略行尾空白，展示仍用原文 */
function norm(line: string): string {
  return line.replace(/\s+$/, '');
}

/**
 * 计算 before → after 的行级差异。
 */
export function diffSqlLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ];
  }
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        norm(a[i]!) === norm(b[j]!)
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(a[i]!) === norm(b[j]!)) {
      out.push({ type: 'same', text: b[j]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! });
  while (j < m) out.push({ type: 'add', text: b[j++]! });
  return out;
}

/** 统计增删行数，用于卡片摘要 */
export function summarizeDiff(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}
