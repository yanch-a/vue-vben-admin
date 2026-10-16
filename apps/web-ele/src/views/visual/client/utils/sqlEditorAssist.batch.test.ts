import { describe, expect, it } from 'vitest';

import { expandSessionChain, extractExecutableSql, listSqlStatements } from './sqlEditorAssist';

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

  it('没有 END 的 BEGIN 不会把后面的语句吞成一条', () => {
    expect(listSqlStatements('BEGIN\nINSERT INTO t VALUES (1);\nCOMMIT;\nSELECT 1;')).toEqual([
      'BEGIN\nINSERT INTO t VALUES (1)',
      'COMMIT',
      'SELECT 1',
    ]);
  });

  it('BEGIN 事务不会把后面的语句吞掉', () => {
    expect(listSqlStatements('BEGIN;\nINSERT INTO t VALUES (1);\nCOMMIT;')).toEqual([
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ]);
  });

  it('匿名 BEGIN END 保持一条', () => {
    const sql = `BEGIN
  INSERT INTO t VALUES (1);
  INSERT INTO t VALUES (2);
END;
SELECT 1;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('INSERT INTO t VALUES (2)');
    expect(parts[1]).toBe('SELECT 1');
  });

  it('DECLARE 到 END 的匿名块保持一条', () => {
    const sql = `DECLARE
  n NUMBER;
BEGIN
  n := 1;
END;
SELECT 1;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('n NUMBER');
    expect(parts[0]).toContain('n := 1');
    expect(parts[1]).toBe('SELECT 1');
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

  it('分号后未闭合的反引号不会把后面的语句粘成一条', () => {
    const sql = [
      'SELECT BIDDER_NAME FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915501559A01B01"  GROUP BY bidder_name ;`~!',
      'SELECT legal_idcard ,LENGTH(legal_idcard)FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915504294A01B01"   ORDER BY DATA_TIMESTAMP DESC;',
      'SELECT project_leader_idcard ,LENGTH(project_leader_idcard)FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915502595A01B01"   ORDER BY DATA_TIMESTAMP DESC;',
      'SELECT project_leader_phone FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915501463A01B01" ORDER BY DATA_TIMESTAMP DESC;',
    ].join('\n');
    const parts = listSqlStatements(sql);
    expect(parts[0]).toBe(
      'SELECT BIDDER_NAME FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915501559A01B01"  GROUP BY bidder_name',
    );
    expect(parts).toContain(
      'SELECT legal_idcard ,LENGTH(legal_idcard)FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915504294A01B01"   ORDER BY DATA_TIMESTAMP DESC',
    );
    expect(parts).toContain(
      'SELECT project_leader_idcard ,LENGTH(project_leader_idcard)FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915502595A01B01"   ORDER BY DATA_TIMESTAMP DESC',
    );
    expect(parts).toContain(
      'SELECT project_leader_phone FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915501463A01B01" ORDER BY DATA_TIMESTAMP DESC',
    );
    expect(extractExecutableSql(sql, sql.indexOf('legal_idcard'))).toBe(
      'SELECT legal_idcard ,LENGTH(legal_idcard)FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915504294A01B01"   ORDER BY DATA_TIMESTAMP DESC',
    );
    expect(extractExecutableSql(sql, sql.indexOf('project_leader_phone'))).toBe(
      'SELECT project_leader_phone FROM BID_LIST WHERE BID_SECTION_CODE="E1300000915501463A01B01" ORDER BY DATA_TIMESTAMP DESC',
    );
    expect(extractExecutableSql(sql, sql.indexOf('legal_idcard'))).not.toContain('project_leader');
  });

  it('闭合的多行字符串和跨行反引号仍然保持在同一条语句里', () => {
    expect(listSqlStatements("SELECT 'a\nSELECT 1';\nSELECT 2;")).toEqual([
      "SELECT 'a\nSELECT 1'",
      'SELECT 2',
    ]);
    expect(listSqlStatements('SELECT `a\nb` FROM t;\nSELECT 2;')).toEqual([
      'SELECT `a\nb` FROM t',
      'SELECT 2',
    ]);
  });

  it('未闭合引号同一行后面的新语句也会切开', () => {
    expect(listSqlStatements('SELECT 1; `~! SELECT 2;\nSELECT 3;')).toEqual([
      'SELECT 1',
      '`~!',
      'SELECT 2',
      'SELECT 3',
    ]);
  });

  it('过程体里未闭合的字符串不会把过程结束之后的语句吞掉', () => {
    const sql = `CREATE PROCEDURE p()
BEGIN
  SELECT 'oops
  SELECT 1;
END;
SELECT 2;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('CREATE PROCEDURE p()');
    expect(parts[0]).toContain('END');
    expect(parts[1]).toBe('SELECT 2');
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

describe('原有切分不被未闭合引号恢复影响', () => {
  it('闭合的多行动态 SQL 里出现 SELECT 仍然是一条', () => {
    const sql = "SET @sql = 'SELECT id\nFROM t\nWHERE x = 1';\nSELECT 1;";
    expect(listSqlStatements(sql)).toEqual([
      "SET @sql = 'SELECT id\nFROM t\nWHERE x = 1'",
      'SELECT 1',
    ]);
    expect(extractExecutableSql(sql, sql.indexOf('FROM t'))).toBe(
      "SET @sql = 'SELECT id\nFROM t\nWHERE x = 1'",
    );
  });

  it('字符串、注释、反引号里的分号不切开', () => {
    const sql = [
      "SELECT 'a;b', \"c;d\", `e;f`;",
      "SELECT 'it\\'s', 'it''s';",
      'SELECT 1; -- \'; `~!',
      'SELECT 2; /* \'; ` */',
      '# ; `',
      'SELECT 3;',
    ].join('\n');
    expect(listSqlStatements(sql)).toEqual([
      "SELECT 'a;b', \"c;d\", `e;f`",
      "SELECT 'it\\'s', 'it''s'",
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
  });

  it('换行的 SELECT、ORDER BY、DESC 仍属于同一条', () => {
    const sql = 'SELECT *\nFROM t\nWHERE a = 1\nORDER BY id\nDESC\nLIMIT 1;\nSELECT 2;';
    const parts = listSqlStatements(sql);
    expect(parts).toEqual([
      'SELECT *\nFROM t\nWHERE a = 1\nORDER BY id\nDESC\nLIMIT 1',
      'SELECT 2',
    ]);
    expect(extractExecutableSql(sql, sql.indexOf('DESC'))).toBe(parts[0]);
    expect(extractExecutableSql(sql, sql.lastIndexOf('FROM'))).toBe(parts[0]);
  });

  it('INSERT SELECT、WITH、UNION 不按中间的关键字拆开', () => {
    expect(listSqlStatements('INSERT INTO t (id)\nSELECT 1 FROM dual;\nSELECT 2;')).toEqual([
      'INSERT INTO t (id)\nSELECT 1 FROM dual',
      'SELECT 2',
    ]);
    expect(listSqlStatements('WITH c AS (\n  SELECT 1\n)\nSELECT * FROM c;\nSELECT 2;')).toEqual([
      'WITH c AS (\n  SELECT 1\n)\nSELECT * FROM c',
      'SELECT 2',
    ]);
    expect(listSqlStatements('SELECT 1\nUNION\nSELECT 2;\nSELECT 3;')).toEqual([
      'SELECT 1\nUNION\nSELECT 2',
      'SELECT 3',
    ]);
    expect(listSqlStatements('CREATE\nTABLE t (id int);\nINSERT INTO t VALUES (1);')).toEqual([
      'CREATE\nTABLE t (id int)',
      'INSERT INTO t VALUES (1)',
    ]);
  });

  it('过程注释里的 BEGIN 和字符串里的 END 不会把过程拆开', () => {
    const sql = `CREATE PROCEDURE p()
COMMENT 'see
BEGIN later'
BEGIN
  SET @s = 'END
SELECT 1;';
  SELECT 1;
END;
SELECT 2;`;
    const parts = listSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("COMMENT 'see");
    expect(parts[0]).toContain('BEGIN later');
    expect(parts[0]).toContain('SELECT 1;');
    expect(parts[0]).toContain('END');
    expect(parts[1]).toBe('SELECT 2');
    expect(extractExecutableSql(sql, sql.indexOf('SET @s'))).toBe(parts[0]);
  });

  it('BEGIN 后直接跟字符串，END 仍然能结束这个块', () => {
    const sql = "BEGIN\n  'x'\nEND;\nSELECT 2;";
    expect(listSqlStatements(sql)).toEqual(["BEGIN\n  'x'\nEND", 'SELECT 2']);
  });

  it('嵌套 BEGIN 和事务 BEGIN 保持原来的边界', () => {
    const nested = listSqlStatements('BEGIN\n  BEGIN\n    SELECT 1;\n  END;\n  SELECT 2;\nEND;\nSELECT 3;');
    expect(nested).toHaveLength(2);
    expect(nested[0]).toContain('SELECT 1');
    expect(nested[0]).toContain('SELECT 2');
    expect(nested[1]).toBe('SELECT 3');
    expect(listSqlStatements('BEGIN WORK;\nINSERT INTO t VALUES (1);\nCOMMIT;\nSELECT 1;')).toEqual([
      'BEGIN WORK',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
      'SELECT 1',
    ]);
    expect(listSqlStatements('SELECT 1\nGO')).toEqual(['SELECT 1']);
    expect(listSqlStatements('SELECT 1\nGO\nSELECT 2\nGO')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(listSqlStatements('SELECT 1\nGO; -- batch\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(listSqlStatements("SELECT 'GO'\nFROM t;")).toEqual(["SELECT 'GO'\nFROM t"]);
    expect(listSqlStatements('BEGIN\n  NULL;\nEND;\n/\nSELECT 1;')).toEqual([
      'BEGIN\n  NULL;\nEND',
      'SELECT 1',
    ]);
  });

  it('反引号后面的语句用 Windows 换行也能单独执行', () => {
    const sql = 'SELECT 1; `~!\r\nSELECT 2;\r\nSELECT 3;';
    expect(extractExecutableSql(sql, sql.indexOf('SELECT 2'))).toBe('SELECT 2');
    expect(extractExecutableSql(sql, sql.indexOf('SELECT 3'))).toBe('SELECT 3');
    expect(extractExecutableSql(sql, sql.indexOf('SELECT 1'))).toBe('SELECT 1');
  });

  it('杂符夹在 SET 和查询之间时，用户变量仍然能配对', () => {
    const sql = 'SET @a := 1; `~!\nSELECT @a;\nSELECT 2;';
    const cursor = sql.indexOf('SELECT @a');
    expect(listSqlStatements(expandSessionChain(sql, extractExecutableSql(sql, cursor), cursor))).toEqual([
      'SET @a := 1',
      'SELECT @a',
    ]);
  });
});

describe('expandSessionChain', () => {
  const script = `SET @wo_menu := (
  SELECT menu_id FROM (
    SELECT mm.menu_id FROM sys_menu_module mm WHERE mm.module_code = 'SqlWorkOrder'
    UNION ALL
    SELECT m.menu_id FROM sys_menu m WHERE m.name = 'SqlWorkOrder'
  ) t LIMIT 1
);
SET @op_id := (SELECT IFNULL(MAX(id), 0) + 1 FROM sys_operation);
INSERT INTO sys_operation (id, menu_id)
SELECT @op_id, @wo_menu FROM DUAL
WHERE @wo_menu IS NOT NULL;`;

  it('光标在 INSERT 上时把前面的 SET 一起带走', () => {
    const insertAt = script.indexOf('INSERT INTO');
    const current = extractExecutableSql(script, insertAt);
    const expanded = expandSessionChain(script, current);
    expect(listSqlStatements(expanded)).toHaveLength(3);
    expect(expanded.startsWith('SET @wo_menu')).toBe(true);
    expect(expanded).toContain('INSERT INTO sys_operation');
  });

  it('光标在第一条 SET 上时把后面用到变量的 INSERT 一起带走', () => {
    const current = extractExecutableSql(script, script.indexOf('SET @wo_menu'));
    expect(listSqlStatements(expandSessionChain(script, current))).toHaveLength(3);
  });

  it('SET NAMES 不会把后面无关的建表语句带上', () => {
    const sql = 'SET NAMES utf8mb4;\nCREATE TABLE t (id int);';
    const current = extractExecutableSql(sql, sql.indexOf('CREATE'));
    expect(expandSessionChain(sql, current)).toBe('CREATE TABLE t (id int)');
  });

  it('中间隔着别的 INSERT 时，仍带上更早赋值的变量，但不执行那条无关 INSERT', () => {
    const sql = `SET @cw_menu := (SELECT 1);
INSERT INTO sys_menu_module (menu_id) SELECT @cw_menu FROM DUAL;
SET @op_id := (SELECT 2);
INSERT INTO sys_operation (id, menu_id) SELECT @op_id, @cw_menu FROM DUAL;`;
    const cursor = sql.lastIndexOf('INSERT INTO');
    const current = extractExecutableSql(sql, cursor);
    const parts = listSqlStatements(expandSessionChain(sql, current, cursor));
    expect(parts).toEqual([
      'SET @cw_menu := (SELECT 1)',
      'SET @op_id := (SELECT 2)',
      'INSERT INTO sys_operation (id, menu_id) SELECT @op_id, @cw_menu FROM DUAL',
    ]);
  });

  it('两段相同的 INSERT 会按光标落到后一段，而不是总执行第一段', () => {
    const sql = `SET @a := 1;
INSERT INTO t VALUES (@a);
SET @a := 2;
INSERT INTO t VALUES (@a);`;
    const cursor = sql.lastIndexOf('INSERT INTO');
    const current = extractExecutableSql(sql, cursor);
    const parts = listSqlStatements(expandSessionChain(sql, current, cursor));
    expect(parts).toEqual(['SET @a := 2', 'INSERT INTO t VALUES (@a)']);
  });

  it('PREPARE 到 DEALLOCATE 保持在同一段里', () => {
    const sql = `SET @sql := 'INSERT INTO t VALUES (1)';
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SELECT 1;`;
    const current = extractExecutableSql(sql, sql.indexOf('EXECUTE'));
    const parts = listSqlStatements(expandSessionChain(sql, current));
    expect(parts).toEqual([
      "SET @sql := 'INSERT INTO t VALUES (1)'",
      'PREPARE stmt FROM @sql',
      'EXECUTE stmt',
      'DEALLOCATE PREPARE stmt',
    ]);
  });

  it('DECLARE 赋的变量会被后面的语句带上', () => {
    const sql = `DECLARE @id INT = 1;
INSERT INTO t VALUES (@id);
SELECT 1;`;
    const cursor = sql.indexOf('INSERT');
    const current = extractExecutableSql(sql, cursor);
    const parts = listSqlStatements(expandSessionChain(sql, current, cursor));
    expect(parts).toEqual(['DECLARE @id INT = 1', 'INSERT INTO t VALUES (@id)']);
  });

  it('后面用到临时表时，把前面的 CREATE TEMPORARY 带上', () => {
    const sql = `CREATE TEMPORARY TABLE tmp_note (id int);
INSERT INTO tmp_note VALUES (1);
SELECT 1;`;
    const cursor = sql.indexOf('INSERT INTO tmp_note');
    const current = extractExecutableSql(sql, cursor);
    const parts = listSqlStatements(expandSessionChain(sql, current, cursor));
    expect(parts[0]).toContain('CREATE TEMPORARY TABLE tmp_note');
    expect(parts[1]).toContain('INSERT INTO tmp_note');
  });

  it('光标在后面的查询上时，不会把更早的 USE 带上', () => {
    const sql = `USE other_db;
SELECT 1;
USE app;
SELECT 2;`;
    const cursor = sql.lastIndexOf('SELECT');
    const current = extractExecutableSql(sql, cursor);
    expect(expandSessionChain(sql, current, cursor)).toBe('SELECT 2');
  });
});
