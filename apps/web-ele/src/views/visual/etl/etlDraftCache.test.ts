import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearEtlLocalDraft,
  etlDirtyIds,
  getEtlLocalDraft,
  saveEtlLocalDraft,
} from './etlDraftCache';

/** 缓存原始文本和模式，不因校验失败或服务端版本变化擅自丢稿。 @author yanch */
describe('ETL raw local draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    etlDirtyIds.value = new Set();
  });
  const draft = {
    workspaceId: '1',
    baseRevision: 3,
    workspaceName: '本地修改',
    description: '',
    draftJson: '{"pipelines": [',
    editorMode: 'json' as const,
    documentJson: '{"pipelines":[]}',
  };
  it('round-trips unfinished JSON and editor mode exactly', () => {
    expect(saveEtlLocalDraft(draft)).toBe(true);
    expect(getEtlLocalDraft(1)).toMatchObject(draft);
    expect(etlDirtyIds.value.has('1')).toBe(true);
  });
  it('retains the old baseline for explicit conflict recovery', () => {
    saveEtlLocalDraft(draft);
    expect(getEtlLocalDraft(1)?.baseRevision).toBe(3);
    clearEtlLocalDraft(1);
    expect(getEtlLocalDraft(1)).toBeUndefined();
  });
  it('refuses oversized drafts without replacing previous raw text', () => {
    saveEtlLocalDraft(draft);
    expect(
      saveEtlLocalDraft({
        ...draft,
        draftJson: 'x'.repeat(2 * 1024 * 1024 + 1),
      }),
    ).toBe(false);
    expect(getEtlLocalDraft(1)?.draftJson).toBe(draft.draftJson);
  });
});
