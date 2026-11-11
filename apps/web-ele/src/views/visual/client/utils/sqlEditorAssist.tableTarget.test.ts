import { describe, expect, it } from 'vitest';

import {
  parseTableRefsFromStatement,
  resolveEditorTableAction,
  resolveLocateTableTarget,
  resolveTableTargetFromEditor,
} from './sqlEditorAssist';

describe('SQL 编辑器右键表定位', () => {
  const highGoSql = 'SELECT * FROM "app"."orders" LIMIT 200';

  it('能从瀚高带引号的 schema.table 里还原真表', () => {
    expect(parseTableRefsFromStatement(highGoSql)).toEqual([
      { schema: 'app', table: 'orders', alias: 'orders' },
    ]);
    expect(resolveTableTargetFromEditor(highGoSql, '"orders"')).toEqual({
      schema: 'app',
      table: 'orders',
    });
    expect(resolveTableTargetFromEditor(highGoSql, '"app"."orders"')).toEqual({
      schema: 'app',
      table: 'orders',
    });
  });

  it('瀚高把 schema 留在表名里，不拿它去切换数据库', () => {
    expect(resolveEditorTableAction({
      dbType: 'HIGHGO',
      instanceName: 'highgo',
      schema: 'app',
      table: 'orders',
    })).toEqual({
      instanceName: 'highgo',
      tableName: 'app.orders',
      schemaName: 'app',
    });
    expect(resolveEditorTableAction({
      dbType: 'HIGHGO',
      instanceName: 'highgo',
      tabSchema: 'audit',
      table: 'logs',
    })).toEqual({
      instanceName: 'highgo',
      tableName: 'audit.logs',
      schemaName: 'audit',
    });
  });

  it('定位时选中的表优先于语句里的第一张表', () => {
    const sql = 'SELECT * FROM orders o JOIN users u ON o.id = u.id';
    expect(resolveLocateTableTarget({
      fullSql: sql,
      offset: sql.indexOf('users'),
      rawToken: 'users',
      dbType: 'MY_SQL',
      instanceName: 'app',
    })).toEqual({ instanceName: 'app', tableName: 'users' });
  });

  it('当前语句只有一张表时，光标不在表名上也定位这张表', () => {
    const sql = 'SELECT id FROM `shop`.`orders` LIMIT 200';
    expect(resolveLocateTableTarget({
      fullSql: sql,
      offset: 0,
      rawToken: 'SELECT',
      dbType: 'MY_SQL',
      instanceName: 'current',
    })).toEqual({ instanceName: 'shop', tableName: 'orders' });
  });

  it('多表语句里光标在字段上时不猜表', () => {
    const sql = 'SELECT id FROM orders o JOIN users u ON o.id = u.id';
    expect(resolveLocateTableTarget({
      fullSql: sql,
      offset: sql.indexOf('id'),
      rawToken: 'id',
      dbType: 'MY_SQL',
      instanceName: 'app',
    })).toBeNull();
  });

  it('瀚高选中 schema.table 时定位保留 schema', () => {
    const sql = 'SELECT * FROM "audit"."logs"';
    expect(resolveLocateTableTarget({
      fullSql: sql,
      offset: sql.indexOf('"audit"'),
      rawToken: '"audit"."logs"',
      explicitSelection: true,
      dbType: 'HIGHGO',
      instanceName: 'highgo',
      tabSchema: 'public',
    })).toEqual({
      instanceName: 'highgo',
      tableName: 'audit.logs',
      schemaName: 'audit',
    });
  });

  it('MySQL 的前缀仍然是库名', () => {
    expect(resolveEditorTableAction({
      dbType: 'MY_SQL',
      instanceName: 'current',
      schema: 'other',
      table: 'orders',
    })).toEqual({
      instanceName: 'other',
      tableName: 'orders',
    });
  });
});
