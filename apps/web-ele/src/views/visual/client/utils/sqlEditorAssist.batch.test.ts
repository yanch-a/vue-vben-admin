import { describe, expect, it } from 'vitest';

import { listSqlStatements } from './sqlEditorAssist';

/**
 * 选区多语句切分：字符串和注释里的分号不能切开。
 *
 * @author yanch
 */
describe('listSqlStatements', () => {
  it('按分号拆成多条', () => {
    expect(listSqlStatements('select 1; select 2')).toEqual([
      'select 1',
      'select 2',
    ]);
  });

  it('忽略字符串里的分号', () => {
    expect(listSqlStatements("select ';'; select 2")).toEqual([
      "select ';'",
      'select 2',
    ]);
  });

  it('单条语句不拆开', () => {
    expect(listSqlStatements('select 1')).toEqual(['select 1']);
  });
});
