import { describe, expect, it } from 'vitest';

import {
  metadataInstanceName,
  metadataTableName,
  parseQueryTables,
} from './resultRowSql';

const CROSS_DB_SQL = `SELECT
  *
FROM
  \`lemon_cms\`.\`lm_forum_topic\`
LIMIT
  200;`;

describe('跨库查询的元数据定位', () => {
  it('从限定名解析出库和表', () => {
    expect(parseQueryTables(CROSS_DB_SQL)).toEqual([
      { schema: 'lemon_cms', table: 'lm_forum_topic' },
    ]);
  });

  it('MySQL 按 SQL 里的库查主键，不用当前选中库', () => {
    const ref = parseQueryTables(CROSS_DB_SQL)[0]!;
    expect(metadataInstanceName(ref, 'MY_SQL', 'g3_sx_dt')).toBe('lemon_cms');
    expect(metadataTableName(ref, 'MY_SQL')).toBe('lm_forum_topic');
  });

  it('没有库限定时仍用当前选中库', () => {
    const ref = parseQueryTables('SELECT * FROM lm_forum_topic LIMIT 200')[0]!;
    expect(metadataInstanceName(ref, 'MYSQL', 'g3_sx_dt')).toBe('g3_sx_dt');
    expect(metadataTableName(ref, 'MYSQL')).toBe('lm_forum_topic');
  });

  it('PostgreSQL 的 schema 不是库，仍用当前库', () => {
    const ref = parseQueryTables('SELECT * FROM app.users')[0]!;
    expect(metadataInstanceName(ref, 'POSTGRESQL', 'analytics')).toBe('analytics');
    expect(metadataTableName(ref, 'POSTGRESQL')).toBe('app.users');
  });
});
