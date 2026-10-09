import { describe, expect, it } from 'vitest';
import { createEtlRequestGate } from './etlRequestGate';

/** 切换意图与异步响应无序返回时，仅最后意图允许提交。 @author yanch */
describe('ETL workspace request generations', () => {
  it('drops an older response and older finally even if it arrives last', async () => {
    const gate = createEtlRequestGate();
    let shown = '',
      loading = true;
    let releaseA!: () => void;
    const requestA = gate.begin();
    const a = (async () => {
      await new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      if (gate.current(requestA)) shown = 'A';
      if (gate.current(requestA)) loading = false;
    })();
    const requestB = gate.begin();
    if (gate.current(requestB)) shown = 'B';
    releaseA();
    await a;
    expect(shown).toBe('B');
    expect(loading).toBe(true);
  });
  it('same-workspace dirty intent and unmount invalidate in-flight loads', () => {
    const gate = createEtlRequestGate();
    const switching = gate.begin();
    gate.begin();
    expect(gate.current(switching)).toBe(false);
    const latest = gate.stamp();
    gate.invalidate();
    expect(gate.current(latest)).toBe(false);
  });
});
