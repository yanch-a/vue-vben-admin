import { describe, expect, it } from 'vitest';

import { buildJoinUpdateSqls } from './resultJoinUpdate';

describe('联表结果更新', () => {
  it('按两张表主键分别生成 UPDATE', () => {
    const sqls = buildJoinUpdateSqls(
      {
        original: { user_id: 7, order_id: 9, name: 'old', amount: 10 },
        edited: { user_id: 7, order_id: 9, name: 'new', amount: 11 },
        changedColumns: ['name', 'amount'],
      },
      [
        { ref: { table: 'users' }, alias: 'u', columns: ['id', 'name'], primaryKeys: ['id'] },
        { ref: { table: 'orders' }, alias: 'o', columns: ['id', 'amount'], primaryKeys: ['id'] },
      ],
      ['user_id', 'order_id', 'name', 'amount'],
      'SELECT u.id AS user_id, o.id AS order_id, u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id',
      'MY_SQL',
      ['users', 'orders', 'users', 'orders'],
    );

    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain('UPDATE `users` SET `name` = \'new\' WHERE `id` = 7;');
    expect(sqls[1]).toContain('UPDATE `orders` SET `amount` = 11 WHERE `id` = 9;');
  });

  it('拒绝 JDBC 标记为物理表但实际是表达式的结果列', () => {
    expect(() =>
      buildJoinUpdateSqls(
        {
          original: { user_id: 7, name: 'old' },
          edited: { user_id: 7, name: 'new' },
          changedColumns: ['name'],
        },
        [{ ref: { table: 'users' }, alias: 'u', columns: ['id', 'name'], primaryKeys: ['id'] }],
        ['name', 'user_id'],
        "SELECT COALESCE(u.name, '') AS name, u.id AS user_id FROM users u",
        'MY_SQL',
        ['users', 'users'],
      ),
    ).toThrow('无法归属');
  });

  it('不把计算列别名 id 当成主键定位列', () => {
    expect(() =>
      buildJoinUpdateSqls(
        {
          original: { id: 7, name: 'old' },
          edited: { id: 7, name: 'new' },
          changedColumns: ['name'],
        },
        [{ ref: { table: 'users' }, alias: 'u', columns: ['id', 'name'], primaryKeys: ['id'] }],
        ['id', 'name'],
        "SELECT CAST(u.id AS CHAR) AS id, u.name FROM users u",
        'MY_SQL',
        ['users', 'users'],
      ),
    ).toThrow('必须带上该表主键');
  });
});
