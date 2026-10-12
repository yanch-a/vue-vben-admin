import { describe, expect, it } from 'vitest';
import { createEtlSqlDraftGuard } from './etlSqlDraftGuard';

/** 测试生产代码使用的草稿写入门禁，异步字段加载不能把 A 的 SQL 写入 B。@author yanch */
describe('ETL metadata SQL insertion', () => {
  it('drops a result after switching steps and does not modify either SQL draft', () => {
    const a = { id: 'A', config: { sql: '' } }, b = { id: 'B', config: { sql: 'SELECT manual_b' } };
    let selected = a;
    const guard = createEtlSqlDraftGuard(() => JSON.stringify([selected.id, selected.config.sql]));
    const request = guard.capture(a); selected = b;
    expect(request.apply('SELECT generated_a')).toBe(false);
    expect(a.config.sql).toBe(''); expect(b.config.sql).toBe('SELECT manual_b');
  });
  it('keeps manual input entered while metadata is loading and the latest insertion wins', () => {
    const a = { config: { sql: '' } };
    const guard = createEtlSqlDraftGuard(() => a.config.sql);
    const old = guard.capture(a); a.config.sql = 'SELECT manual';
    expect(old.apply('SELECT stale')).toBe(false);
    a.config.sql = ''; const first = guard.capture(a), latest = guard.capture(a);
    expect(first.latest()).toBe(false); expect(first.apply('SELECT first')).toBe(false);
    expect(latest.apply('SELECT latest')).toBe(true); expect(a.config.sql).toBe('SELECT latest');
  });
});
