import { describe, expect, it } from 'vitest';

import { extractExecutableSql, listSqlStatements } from './sqlEditorAssist';

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

  it('存储过程体内的分号不拆开，END IF 也不结束过程', () => {
    const sql = `CREATE PROCEDURE p()
BEGIN
  IF 1 = 1 THEN
    INSERT INTO t VALUES (1);
  END IF;
END;
SELECT 1;`;
    expect(listSqlStatements(sql)).toEqual([
      `CREATE PROCEDURE p()
BEGIN
  IF 1 = 1 THEN
    INSERT INTO t VALUES (1);
  END IF;
END`,
      'SELECT 1',
    ]);
  });

  it('光标在过程体中间时，执行的是整段过程', () => {
    const sql = `CREATE PROCEDURE p()
BEGIN
  INSERT INTO t VALUES (1);
END;`;
    const cursor = sql.indexOf('INSERT');
    expect(extractExecutableSql(sql, cursor)).toContain('END');
    expect(extractExecutableSql(sql, cursor)).toContain('INSERT INTO t VALUES (1)');
  });

  it('过程里的字段名 end 不会把过程切开', () => {
    const sql = `CREATE PROCEDURE p()
BEGIN
  SELECT end FROM t;
  SELECT 1;
END;
SELECT 2;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('SELECT end FROM t');
    expect(parts[0]).toContain('SELECT 1');
    expect(parts[1]).toBe('SELECT 2');
  });

  it('建表语句仍然按分号拆开', () => {
    expect(listSqlStatements('CREATE TABLE t (id int); INSERT INTO t VALUES (1);')).toEqual([
      'CREATE TABLE t (id int)',
      'INSERT INTO t VALUES (1)',
    ]);
  });

  it('美元引号里的函数体保持一条', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$
BEGIN
  INSERT INTO t VALUES (1);
END;
$$ LANGUAGE plpgsql;
SELECT 1;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('INSERT INTO t VALUES (1)');
    expect(parts[0]).toContain('LANGUAGE plpgsql');
    expect(parts[1]).toBe('SELECT 1');
  });

  it('DELIMITER 只切换终止符，不作为要执行的语句', () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE p()
BEGIN
  SELECT 1;
END$$
DELIMITER ;
CALL p();`;
    expect(listSqlStatements(sql)).toEqual([
      `CREATE PROCEDURE p()
BEGIN
  SELECT 1;
END`,
      'CALL p()',
    ]);
  });
});
