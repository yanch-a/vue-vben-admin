import { describe, expect, it } from 'vitest';
import { createEtlPreviewSession } from './etlPreviewSession';

/** 预览真实状态门禁回归：同名步骤、异步乱序和配置编辑。@author yanch */
describe('ETL preview sessions', () => {
  it('ignores an old response and old finally while a new request is pending', () => {
    const state = createEtlPreviewSession(() => 'workspace1/pipeline1/config1');
    const old = state.begin(); const latest = state.begin();
    expect(state.current(old)).toBe(false); expect(state.latest(old)).toBe(false);
    expect(state.current(latest)).toBe(true);
  });
  it('rejects changed field transforms and a different pipeline with the same node ID', () => {
    let context = 'workspace1/pipeline1/config1';
    const state = createEtlPreviewSession(() => context); const request = state.begin();
    context = 'workspace1/pipeline1/config2'; expect(state.current(request)).toBe(false);
    context = 'workspace1/pipeline2/config1'; expect(state.current(request)).toBe(false);
  });
  it('switching away and back or unmounting cannot revive an old request', () => {
    const state = createEtlPreviewSession(() => 'workspace1/pipeline1/config1');
    const request = state.begin(); state.invalidate();
    expect(state.current(request)).toBe(false); expect(state.latest(request)).toBe(false);
  });
});
