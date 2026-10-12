import { describe, expect, it } from 'vitest';

import { buildJoinUpdateSqls, findTablePkBindings } from './resultJoinUpdate';

describe('联表结果更新', () => {
  it('不能把另一张表的 id 别名 b_id 猜成 b 的主键', () => {
    expect(()=>buildJoinUpdateSqls({original:{b_id:1,v:'same'},edited:{v:'new'},changedColumns:['v']},
      [{ref:{table:'a'},alias:'a',columns:['id'],primaryKeys:['id']},{ref:{table:'b'},alias:'b',columns:['id','v'],primaryKeys:['id']}],
      ['b_id','v'],'SELECT a.id AS b_id,b.v FROM a JOIN b ON a.id=b.parent_id','MY_SQL',['a','b'])).toThrow('必须带上该表主键');
  });
  it('即使别名恰好叫 b_id，表达式也不能用来定位 b 的行', () => {
    expect(()=>buildJoinUpdateSqls({original:{b_id:1,v:'same'},edited:{v:'new'},changedColumns:['v']},
      [{ref:{table:'b'},alias:'b',columns:['id','v'],primaryKeys:['id']}],['b_id','v'],
      'SELECT b.id+1 AS b_id,b.v FROM b','MY_SQL',['b','b'])).toThrow('必须带上该表主键');
  });
  it('区分大小写的列只允许真实主键用于定位', () => {
    const table = { ref: { table: 't' }, columns: ['ID', 'id', 'v'], primaryKeys: ['ID'] };
    expect(findTablePkBindings(table, 0, ['id'], [], [table])).toBeNull();
    expect(findTablePkBindings(table, 0, ['id', 'ID'], [], [table])).toEqual([{ physical: 'ID', resultCol: 'ID' }]);
  });
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
    expect(sqls[0]).toContain('UPDATE `users` SET `name` = \'new\' WHERE `id` = 7 AND `name` = \'old\';');
    expect(sqls[1]).toContain('UPDATE `orders` SET `amount` = 11 WHERE `id` = 9 AND `amount` = 10;');
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
