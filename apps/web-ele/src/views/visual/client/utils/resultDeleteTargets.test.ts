import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

import {
  dedupeDeleteSql,
  planDeleteTargets,
  sameDeletePlan,
} from './resultDeleteTargets';

describe('结果区删除目标', () => {
  const a = { id: 1 };
  const b = { id: 2 };
  const c = { id: 3 };
  const current = [a, b, c];

  it('勾选行被响应式包一层后仍能对上当前结果', () => {
    const wrapped = reactive([a, b]);
    const plan = planDeleteTargets(wrapped, reactive(c), current);
    expect(plan).toEqual({ ok: true, mode: 'checked', rows: [a, b] });
  });

  it('有勾选时只删勾选行，不带上未勾选的右键行', () => {
    const plan = planDeleteTargets([a, b], c, current);
    expect(plan).toEqual({ ok: true, mode: 'checked', rows: [a, b] });
  });

  it('勾选里已包含右键行时只出现一次', () => {
    const plan = planDeleteTargets([b, b, a], b, current);
    expect(plan).toEqual({ ok: true, mode: 'checked', rows: [b, a] });
  });

  it('没有勾选时只删右键行', () => {
    expect(planDeleteTargets([], c, current)).toEqual({
      ok: true,
      mode: 'context',
      rows: [c],
    });
    expect(planDeleteTargets(null, a, current).ok && planDeleteTargets(null, a, current)).toMatchObject({
      mode: 'context',
      rows: [a],
    });
  });

  it('勾选行不在当前结果里时整批取消，避免删错', () => {
    const stale = { id: 9 };
    expect(planDeleteTargets([a, stale], c, current)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('没有可用行时不删', () => {
    expect(planDeleteTargets([], null, current)).toEqual({ ok: false, reason: 'empty' });
    expect(planDeleteTargets([], { id: 8 }, current)).toEqual({ ok: false, reason: 'empty' });
  });

  it('确认期间勾选变化后两份计划不再相同', () => {
    const before = planDeleteTargets([a, b], c, current);
    const after = planDeleteTargets([a], c, current);
    expect(sameDeletePlan(before, after)).toBe(false);
    expect(sameDeletePlan(before, planDeleteTargets([a, b], c, current))).toBe(true);
  });

  it('相同 DELETE 只保留一条，空语句丢掉', () => {
    expect(dedupeDeleteSql([' delete from t ', 'delete from t', 'delete from t where id=2', ''])).toEqual([
      ' delete from t ',
      'delete from t where id=2',
    ]);
  });
});
