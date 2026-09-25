import { describe, expect, it } from 'vitest';

import {
  EXECUTED_SQL_LIMIT,
  filterExecutedSql,
  listExecutedSql,
  rememberExecutedSql,
} from './executedSqlHistory';

describe('已执行 SQL 前端缓存', () => {
  it('按连接分开保存，只留最近 200 条，新的在前', () => {
    const id = `conn-${Date.now()}`;
    for (let i = 0; i < EXECUTED_SQL_LIMIT + 5; i += 1) {
      rememberExecutedSql({
        dbConfigId: id,
        instanceName: 'app',
        sql: `select ${i}`,
        success: true,
        executedAt: i,
      });
    }
    rememberExecutedSql({
      dbConfigId: `${id}-other`,
      sql: 'select other',
      success: false,
    });
    const list = listExecutedSql(id);
    expect(list).toHaveLength(EXECUTED_SQL_LIMIT);
    expect(list[0]?.sql).toBe(`select ${EXECUTED_SQL_LIMIT + 4}`);
    expect(list.some((item) => item.sql === 'select 0')).toBe(false);
    expect(listExecutedSql(`${id}-other`).map((item) => item.sql)).toEqual(['select other']);
    expect(listExecutedSql('')).toEqual([]);
  });

  it('空 SQL 不记，检索匹配正文和库名', () => {
    const id = `search-${Date.now()}`;
    rememberExecutedSql({ dbConfigId: id, sql: '   ', success: true });
    rememberExecutedSql({
      dbConfigId: id,
      instanceName: 'lm_cms',
      sql: 'select * from orders',
      success: true,
    });
    const list = listExecutedSql(id);
    expect(list).toHaveLength(1);
    expect(filterExecutedSql(list, 'ORDERS')).toHaveLength(1);
    expect(filterExecutedSql(list, 'lm_c')).toHaveLength(1);
    expect(filterExecutedSql(list, 'absent')).toHaveLength(0);
  });
});
