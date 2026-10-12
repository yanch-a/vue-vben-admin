import { describe, expect, it } from 'vitest';
import { parseQueryTables, parseSelectHints, parseTableFromSql, quoteTable, metadataInstanceName, buildUpdateSql, physicalColumnEquals } from './resultRowSql';
import { resolveSqlDialect } from '../dialect/sqlDialect';
import { isSheetCellUnchanged, coerceSheetValue, toSheetText } from './resultSheetValue';
import { columnCacheKey } from './sqlEditorAssist';
import { useQueryTabs, isQueryTabDirty } from '../composables/useQueryTabs';
import { getResultDraft, putResultDraft } from '../composables/resultDraftStore';

/** 审计问题回归：SQL 来源、字节/时间精度、保存草稿与缓存身份。@author yanch */
describe('数据库客户端修复回归', () => {
  it('物理列大小写折叠只允许唯一字段', () => {
    expect(physicalColumnEquals('id', 'ID', ['ID', 'id'])).toBe(false);
    expect(physicalColumnEquals('ID', 'ID', ['ID', 'id'])).toBe(true);
    expect(physicalColumnEquals('id', 'ID', ['ID'])).toBe(true);
  });
  it('使用外层 FROM，跳过 CTE 临时结果和合并结果', () => {
    expect(parseQueryTables('WITH x AS (SELECT id FROM a) SELECT id FROM b')).toEqual([{ table: 'b', alias: undefined }]);
    expect(parseTableFromSql('SELECT (SELECT id FROM a) AS sub,id FROM b')).toEqual({ catalog: undefined, schema: undefined, table: 'b' });
    expect(parseQueryTables('WITH x AS (SELECT id FROM a) SELECT * FROM x')).toEqual([]);
    expect(parseQueryTables('SELECT id FROM a UNION SELECT id FROM b')).toEqual([]);
    expect(parseSelectHints('WITH x AS (SELECT id FROM a) SELECT b.id AS key_id,b.v AS title FROM b')[0]).toMatchObject({ column: 'id', resultName: 'key_id', writable: true });
  });
  it('保留 SQL Server 数据库限定名，远程服务器名保持只读', () => {
    const ref = parseTableFromSql('SELECT id FROM other_db.dbo.orders')!;
    expect(ref).toEqual({ catalog: 'other_db', schema: 'dbo', table: 'orders' });
    expect(quoteTable(ref, 'SQL_SERVER')).toBe('[other_db].[dbo].[orders]');
    expect(metadataInstanceName(ref, 'SQL_SERVER', 'current')).toBe('other_db');
    expect(parseTableFromSql('SELECT id FROM linked.other_db.dbo.orders')).toBeNull();
  });
  it('二进制字节按数据库方言回写，普通 base64 文本不变', () => {
    const bytes = { __lemonBinary: '000102ff' };
    expect(resolveSqlDialect('MY_SQL').literal(bytes)).toBe("X'000102ff'");
    expect(resolveSqlDialect('POSTGRE_SQL').literal(bytes)).toBe("decode('000102ff', 'hex')");
    expect(resolveSqlDialect('ORACLE').literal(bytes)).toBe("hextoraw('000102ff')");
    expect(resolveSqlDialect('SQL_SERVER').literal(bytes)).toBe('0x000102ff');
    expect(resolveSqlDialect('SQLITE').literal(bytes)).toBe("X'000102ff'");
    expect(resolveSqlDialect('MY_SQL').literal('AAEC')).toBe("'AAEC'");
    expect(toSheetText(bytes)).toBe('000102ff');
    expect(coerceSheetValue(bytes, 'ff00')).toEqual({ __lemonBinary: 'ff00' });
    expect(() => coerceSheetValue(bytes, 'xyz')).toThrow();
  });
  it('小数秒和时区变化属于修改，大数字字符串保持文本', () => {
    expect(isSheetCellUnchanged('2026-10-11 10:00:00.123456', '2026-10-11 10:00:00.999999')).toBe(false);
    expect(isSheetCellUnchanged('2026-10-11T10:00:00Z', '2026-10-11T10:00:00+08:00')).toBe(false);
    expect(coerceSheetValue('9007199254740993', '9007199254740995')).toBe('9007199254740995');
  });
  it('类型明确的数值和 Oracle 时间避免 NLS 隐式转换，路径文字不依赖转义模式', () => {
    const typed = (value: unknown,jdbcType:number,typeName:string) => ({__lemonTypedValue:{value,jdbcType,typeName}});
    expect(resolveSqlDialect('ORACLE').literal(typed('12345678901234567890.123456789',3,'NUMBER'))).toBe('12345678901234567890.123456789');
    expect(resolveSqlDialect('ORACLE').literal(typed('2026-10-11 10:20:30.123456789',93,'TIMESTAMP'))).toBe("TIMESTAMP '2026-10-11 10:20:30.123456789'");
    expect(resolveSqlDialect('ORACLE').literal(typed('2026-10-11',91,'DATE'))).toBe("TO_DATE('2026-10-11', 'YYYY-MM-DD')");
    expect(resolveSqlDialect('ORACLE').literal(typed('2026-10-11T10:20:30.123456+08:00',2014,'TIMESTAMP WITH TIME ZONE'))).toContain("HH24:MI:SS.FF TZH:TZM");
    expect(resolveSqlDialect('MY_SQL').literal('a\\b')).toBe("CONVERT(X'615c62' USING utf8mb4)");
    expect(resolveSqlDialect('POSTGRE_SQL').literal('a\\b')).toBe("convert_from(decode('615c62', 'hex'), 'UTF8')");
  });
  it('UPDATE 比较原值，防止覆盖并发变更', () => {
    expect(buildUpdateSql({ table: 't' }, { id: 1, v: 'old' }, { id: 1, v: 'new' }, ['v'], ['id']))
      .toContain("WHERE `id` = 1 AND `v` = 'old'");
  });
  it('重复打开保存查询保留草稿，保存基线使用实际提交内容', () => {
    const state = useQueryTabs(() => 'repair-drafts');
    const tab = state.addTab({ savedQueryId: 'repair-1', sql: 'SELECT 1' })!;
    tab.sql = 'SELECT edited';
    expect(state.addTab({ savedQueryId: 'repair-1', sql: 'SELECT 1' })?.id).toBe(tab.id);
    expect(tab.sql).toBe('SELECT edited');
    state.markTabSaved(tab, 'SELECT submitted');
    expect(isQueryTabDirty(tab)).toBe(true);
    expect(columnCacheKey(1,'db','Orders')).not.toBe(columnCacheKey(1,'db','orders'));
  });
  it('结果草稿按对象身份隔离', () => {
    const a = { columns:['id'], rows:[{id:1}], rowCount:1 };
    const b = { columns:['id'], rows:[{id:1}], rowCount:1 };
    putResultDraft(a, { rows:[{id:2}],original:a.rows,dirty:new Set([0]),added:new Set(),editingCell:null,editDraft:'' });
    expect(getResultDraft(a)?.rows[0]?.id).toBe(2);
    expect(getResultDraft(b)).toBeUndefined();
    putResultDraft(a,null); expect(getResultDraft(a)).toBeUndefined();
  });
});
