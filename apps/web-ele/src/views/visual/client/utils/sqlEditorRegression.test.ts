import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { expandSessionChain, extractExecutableSql, listSqlStatements } from './sqlEditorAssist';

/**
 * SQL 编辑器回归用例。
 * 脚本在 sqlEditorRegression.sql，改编辑器切句或用户变量规则后跑这个文件。
 *
 * pnpm exec vitest run apps/web-ele/src/views/visual/client/utils/sqlEditorRegression.test.ts --dom
 *
 * @author yanch
 */
const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'sqlEditorRegression.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/** 模拟编辑器：光标落在标记上，没有框选，按依赖把要执行的语句收出来 */
function executeAt(marker: string): string[] {
  const cursor = sql.indexOf(marker);
  expect(cursor, `脚本里找不到标记 ${marker}`).toBeGreaterThanOrEqual(0);
  const current = extractExecutableSql(sql, cursor);
  return listSqlStatements(expandSessionChain(sql, current, cursor));
}

describe('sqlEditorRegression', () => {
  it('过程体不会被分号切开，DELIMITER 本身不执行', () => {
    const parts = listSqlStatements(sql);
    const procedure = parts.find((part) => part.startsWith('CREATE PROCEDURE'));
    expect(procedure).toBeTruthy();
    expect(procedure).toContain('END IF');
    expect(procedure).toContain('INSERT INTO lm_editor_regression');
    expect(procedure).not.toContain('CALL lm_editor_regression_proc');
    expect(parts.some((part) => /^DELIMITER\b/i.test(part))).toBe(false);
    expect(parts.filter((part) => part.startsWith('CALL '))).toEqual([
      'CALL lm_editor_regression_proc()',
    ]);
  });

  it('光标在 chain 插入上时，只带上给它赋值的两条 SET', () => {
    expect(executeAt('/*cursor:chain*/').map((part) => part.split('\n')[0])).toEqual([
      "SET @note := 'from-set'",
      'SET @new_id := (SELECT IFNULL(MAX(id), 0) + 1 FROM lm_editor_regression)',
      'INSERT /*cursor:chain*/ INTO lm_editor_regression (id, code, note)',
    ]);
  });

  it('光标在 gap 插入上时，越过中间的 seed 插入去取变量', () => {
    const parts = executeAt('/*cursor:gap*/');
    expect(parts.map((part) => part.split('\n')[0])).toEqual([
      "SET @keep := 'kept'",
      'SET @row_id := (SELECT IFNULL(MAX(id), 0) + 1 FROM lm_editor_regression)',
      'INSERT /*cursor:gap*/ INTO lm_editor_regression (id, code, note)',
    ]);
    expect(parts.join('\n')).not.toContain("'seed'");
  });

  it('SET NAMES 和后面的查询互不牵扯', () => {
    const namesAt = sql.indexOf('SET NAMES utf8mb4');
    const names = expandSessionChain(sql, extractExecutableSql(sql, namesAt), namesAt);
    expect(names).toBe('SET NAMES utf8mb4');
    expect(executeAt('/*cursor:after-names*/')).toEqual([
      "SELECT /*cursor:after-names*/ code, note FROM lm_editor_regression WHERE code = 'chain'",
    ]);
  });

  it('光标在过程体里只执行这一条过程', () => {
    const parts = executeAt('/*cursor:proc*/');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('CREATE PROCEDURE lm_editor_regression_proc()');
    expect(parts[0]).toContain('END IF');
    expect(parts[0]).not.toContain('CALL ');
  });

  it('光标在 EXECUTE 上时，预处理四条语句一起执行', () => {
    expect(executeAt('/*cursor:exec*/')).toEqual([
      "SET @prep_sql := 'INSERT INTO lm_editor_regression (id, code, note) SELECT 30, ''prep'', ''ok'' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM lm_editor_regression WHERE id = 30)'",
      'PREPARE lm_editor_stmt FROM @prep_sql',
      'EXECUTE /*cursor:exec*/ lm_editor_stmt',
      'DEALLOCATE PREPARE lm_editor_stmt',
    ]);
  });

  it('框选只保留选区，清理语句也不会把前面的插入带上', () => {
    const selectedText = 'DROP /*cursor:cleanup*/ TABLE IF EXISTS lm_editor_regression';
    const start = sql.indexOf(selectedText);
    const selected = extractExecutableSql(sql, start, { start, end: start + selectedText.length });
    expect(selected).toBe(selectedText);
    expect(executeAt('/*cursor:cleanup*/')).toEqual([selectedText]);
  });
});
