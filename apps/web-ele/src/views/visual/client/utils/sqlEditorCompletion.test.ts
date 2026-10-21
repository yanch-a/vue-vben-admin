import { describe, expect, it } from 'vitest';

import {
  detectCompletionContext,
  matchColumnSuggestions,
  matchTableSuggestions,
  type SqlCompletionContext,
} from './sqlEditorAssist';

/** 光标放在 | 处做补全上下文检测 */
function ctxAt(sqlWithCursor: string): SqlCompletionContext {
  const offset = sqlWithCursor.indexOf('|');
  expect(offset, '用例里需要用 | 标出光标').toBeGreaterThanOrEqual(0);
  return detectCompletionContext(sqlWithCursor.replace('|', ''), offset);
}

/**
 * SQL 编辑器表 / 字段补全回归。
 * 重点覆盖「明明有这张表/字段，输入前两个字符却提示不出来」的几类场景。
 * @author yanch
 */
describe('SQL 补全上下文', () => {
  it('FROM 后写表名', () => {
    const ctx = ctxAt('select * from us|');
    expect(ctx.kind).toBe('table');
    expect(ctx.prefix).toBe('us');
  });

  it('FROM a, b 逗号联表时逗号后仍按表名补全', () => {
    expect(ctxAt('select * from t_user u, t_|').kind).toBe('table');
    // 子查询里的逗号属于 SELECT 列表
    expect(ctxAt('select * from (select id, na| from t_user) x').kind).toBe('column');
  });

  it('比较运算符右侧也能补字段', () => {
    const ctx = ctxAt('select * from t_order o join t_user u on o.user_id = u|');
    expect(ctx.kind).toBe('column');
    expect(ctxAt('select * from t_order where amount > am|').kind).toBe('column');
  });

  it('未写别名前缀时带出 FROM / JOIN 的全部表', () => {
    const ctx = ctxAt('select * from t_order o left join t_user u on o.uid = u.id where na|');
    expect(ctx.kind).toBe('column');
    expect(ctx.tables?.map((t) => t.table)).toEqual(['t_order', 't_user']);
  });

  it('别名.字段只替换点号后面的部分', () => {
    const sql = 'select u.na| from t_user u';
    const ctx = ctxAt(sql);
    expect(ctx).toMatchObject({ kind: 'column', table: 't_user', prefix: 'na', qualified: true });
    expect(ctx.replaceFrom).toBe(sql.indexOf('na'));
  });

  it('光标在语句尾部空白时取当前语句，而不是脚本第一条', () => {
    const sql = 'select * from t_a;\nselect * from t_b where ';
    const ctx = detectCompletionContext(sql, sql.length);
    expect(ctx.kind).toBe('column');
    expect(ctx.table).toBe('t_b');
  });

  it('开引号未闭合时替换区间不含引号，插入时补闭合引号', () => {
    const sql = 'select * from `us|';
    const ctx = ctxAt(sql);
    expect(ctx.kind).toBe('table');
    expect(ctx.prefix).toBe('us');
    expect(ctx.closeQuote).toBe('`');
    expect(ctx.replaceFrom).toBe(sql.indexOf('us'));
  });

  it('还没写 FROM 时没有字段来源，但保留前缀供函数 / 关键字补全', () => {
    const ctx = ctxAt('select dat|');
    expect(ctx.kind).toBe('column');
    expect(ctx.tables).toEqual([]);
    expect(ctx.prefix).toBe('dat');
    // 表名之后既不是表也不是字段位置，交给关键字补全（where / left join ...）
    expect(ctxAt('select * from t_user wh|').kind).toBe('none');
  });
});

describe('表 / 字段匹配', () => {
  const baseCtx = { kind: 'table', replaceFrom: 0, replaceTo: 0 } as const;

  it('schema.table 形式的缓存表名按裸表名前缀匹配', () => {
    const tables = [
      { tableName: 'public.orders', schema: 'app' },
      { tableName: 'public.users', schema: 'app' },
    ];
    const hit = matchTableSuggestions(tables, { ...baseCtx, prefix: 'or' }, 'app');
    expect(hit.map((t) => t.tableName)).toEqual(['public.orders']);
  });

  it('写了 schema 前缀时只保留该 schema 下的表', () => {
    const tables = [
      { tableName: 'public.orders', schema: 'app' },
      { tableName: 'audit.orders', schema: 'app' },
    ];
    const hit = matchTableSuggestions(tables, { ...baseCtx, prefix: 'or', schema: 'audit' }, 'app');
    expect(hit.map((t) => t.tableName)).toEqual(['audit.orders']);
  });

  it('两个字符就能命中某一段开头，且排在整段前缀之后', () => {
    const tables = ['t_user', 'user_role', 'sys_log'].map((tableName) => ({ tableName }));
    const hit = matchTableSuggestions(tables, { ...baseCtx, prefix: 'us' });
    expect(hit.map((t) => t.tableName)).toEqual(['user_role', 't_user']);
  });

  it('字段两个字符命中下划线后的分段', () => {
    expect(matchColumnSuggestions(['id', 'user_name', 'nick'], 'na')).toEqual(['user_name']);
  });

  it('表很多时短前缀依旧能把目标排进结果（Monaco 每次输入都会重新取）', () => {
    const tables = Array.from({ length: 200 }, (_, i) => ({ tableName: `a_${String(i).padStart(3, '0')}` }));
    tables.push({ tableName: 'ab_target' });
    const hit = matchTableSuggestions(tables, { ...baseCtx, prefix: 'ab' });
    expect(hit[0]?.tableName).toBe('ab_target');
  });
});
