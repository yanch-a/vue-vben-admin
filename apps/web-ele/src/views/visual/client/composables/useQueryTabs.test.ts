import { describe, expect, it } from 'vitest';

import {
  collectAliveEditorTabIds,
  isQueryTabDirty,
  type QueryTab,
} from './useQueryTabs';

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

  it('一次性页签即使有 SQL 也不视为未保存', () => {
    expect(
      isQueryTabDirty(tab({ sql: 'select * from t', ephemeral: true })),
    ).toBe(false);
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

describe('collectAliveEditorTabIds', () => {
  it('切换连接时保留其他已打开连接的页签，已关闭连接不保留', () => {
    const tabsByConnection = {
      'sess-a': [{ id: 'q-a1' }, { id: 'q-a2' }],
      'sess-b': [{ id: 'q-b1' }],
      'sess-closed': [{ id: 'q-old' }],
    };
    expect(collectAliveEditorTabIds(['sess-a', 'sess-b'], tabsByConnection)).toEqual([
      'q-a1',
      'q-a2',
      'q-b1',
    ]);
    expect(collectAliveEditorTabIds(['sess-a'], tabsByConnection)).toEqual([
      'q-a1',
      'q-a2',
    ]);
  });
});
