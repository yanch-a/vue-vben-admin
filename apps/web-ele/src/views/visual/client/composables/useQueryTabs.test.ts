import { describe, expect, it } from 'vitest';

import { isQueryTabDirty, type QueryTab } from './useQueryTabs';

/**
 * 查询页签未保存状态测试。
 *
 * @author yanch
 */
describe('isQueryTabDirty', () => {
  const tab = (overrides: Partial<QueryTab>): QueryTab => ({
    id: 'q-1',
    title: 'Query 1',
    sql: '',
    resultVisible: false,
    resultTab: 'result',
    executing: false,
    result: null,
    ...overrides,
  });

  it('把有内容的新查询标记为未保存', () => {
    expect(isQueryTabDirty(tab({ sql: 'select 1' }))).toBe(true);
    expect(isQueryTabDirty(tab({ sql: '   ' }))).toBe(false);
  });

  it('按保存基线判断已保存查询是否修改', () => {
    expect(
      isQueryTabDirty(
        tab({ savedQueryId: 1, sql: 'select 1', savedSqlBaseline: 'select 1' }),
      ),
    ).toBe(false);
    expect(
      isQueryTabDirty(
        tab({ savedQueryId: 1, sql: 'select 2', savedSqlBaseline: 'select 1' }),
      ),
    ).toBe(true);
  });
});
