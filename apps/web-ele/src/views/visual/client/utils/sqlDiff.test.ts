/**
 * 行级 SQL diff。
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import { diffSqlLines, summarizeDiff } from './sqlDiff';

describe('diffSqlLines', () => {
  it('相同内容全部为 same', () => {
    const lines = diffSqlLines('select 1\nfrom t', 'select 1\nfrom t');
    expect(lines.every((l) => l.type === 'same')).toBe(true);
    expect(summarizeDiff(lines)).toEqual({ added: 0, removed: 0 });
  });

  it('标记新增、删除并保留未变化行', () => {
    const before = 'SELECT *\nFROM t_order\nWHERE status = 1';
    const after = 'SELECT id, amount\nFROM t_order\nWHERE status = 1\nLIMIT 100';
    const lines = diffSqlLines(before, after);
    expect(lines).toEqual([
      { type: 'del', text: 'SELECT *' },
      { type: 'add', text: 'SELECT id, amount' },
      { type: 'same', text: 'FROM t_order' },
      { type: 'same', text: 'WHERE status = 1' },
      { type: 'add', text: 'LIMIT 100' },
    ]);
    expect(summarizeDiff(lines)).toEqual({ added: 2, removed: 1 });
  });

  it('忽略行尾空白与 CRLF 差异', () => {
    const lines = diffSqlLines('a  \r\nb', 'a\nb');
    expect(lines.map((l) => l.type)).toEqual(['same', 'same']);
  });

  it('空输入不报错', () => {
    expect(diffSqlLines('', 'x')).toEqual([{ type: 'add', text: 'x' }]);
    expect(diffSqlLines('x', '')).toEqual([{ type: 'del', text: 'x' }]);
    expect(diffSqlLines('', '')).toEqual([]);
  });
});
