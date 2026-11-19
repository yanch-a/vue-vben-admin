/**
 * 改变数据库：语句生成、标识符转义和当前值读取。
 *
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import {
  alterDatabaseExecuteInstance,
  buildAlterDatabaseSql,
  buildDatabaseCharsetQuery,
  readCharsetRow,
  supportsAlterDatabase,
} from './alterDatabase';

describe('改变数据库', () => {
  it('只对 MySQL 族和 SQL Server 开放', () => {
    expect(supportsAlterDatabase('MY_SQL')).toBe(true);
    expect(supportsAlterDatabase('OCEANBASE_MYSQL')).toBe(true);
    expect(supportsAlterDatabase('SQL_SERVER')).toBe(true);
    expect(supportsAlterDatabase('POSTGRE_SQL')).toBe(false);
    expect(supportsAlterDatabase('ORACLE')).toBe(false);
    expect(supportsAlterDatabase('SQLITE')).toBe(false);
    expect(supportsAlterDatabase('H2')).toBe(false);
  });

  it('MySQL 同时写入字符集和排序规则，并转义库名', () => {
    expect(
      buildAlterDatabaseSql('MY_SQL', 'app`db', 'utf8mb4', 'utf8mb4_general_ci'),
    ).toBe(
      'ALTER DATABASE `app``db` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;',
    );
  });

  it('拒绝把注入内容拼进未加引号的字符集', () => {
    expect(
      buildAlterDatabaseSql('MY_SQL', 'app', 'utf8mb4; DROP DATABASE app', 'utf8mb4_bin'),
    ).toBe('');
    expect(
      buildDatabaseCharsetQuery('MY_SQL', "a'b"),
    ).toContain("SCHEMA_NAME = 'a''b'");
  });

  it('SQL Server 只改排序规则，并改到 master 上执行', () => {
    expect(
      buildAlterDatabaseSql('SQL_SERVER', 'sales]db', '', 'Chinese_PRC_CI_AS'),
    ).toBe('ALTER DATABASE [sales]]db] COLLATE Chinese_PRC_CI_AS;');
    expect(alterDatabaseExecuteInstance('SQL_SERVER', 'sales')).toBe('master');
    expect(alterDatabaseExecuteInstance('MY_SQL', 'app')).toBe('app');
    expect(buildDatabaseCharsetQuery('SQL_SERVER', "o'hare")).toContain(
      "name = N'o''hare'",
    );
  });

  it('读取结果时忽略列名大小写，MySQL 字符集转成小写', () => {
    expect(
      readCharsetRow('MY_SQL', {
        CHARSET: 'UTF8MB4',
        COLLATION: 'UTF8MB4_GENERAL_CI',
      }),
    ).toEqual({ charset: 'utf8mb4', collation: 'utf8mb4_general_ci' });
    expect(
      readCharsetRow('SQL_SERVER', { COLLATION_NAME: 'Chinese_PRC_CI_AS' }),
    ).toEqual({ charset: '', collation: 'Chinese_PRC_CI_AS' });
  });

  it('PostgreSQL 不生成修改语句', () => {
    expect(buildAlterDatabaseSql('POSTGRE_SQL', 'app', 'UTF8', 'C')).toBe('');
    expect(buildDatabaseCharsetQuery('POSTGRE_SQL', 'app')).toBe('');
  });
});
