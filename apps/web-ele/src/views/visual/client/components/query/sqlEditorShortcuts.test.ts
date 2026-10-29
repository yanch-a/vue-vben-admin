import { describe, expect, it } from 'vitest';

import {
  matchSqlEditorShortcut,
  shouldAcceptSqlEditorShortcut,
} from './sqlEditorShortcuts';

describe('sqlEditorShortcuts gate', () => {
  it('requires active page + focus + not readOnly', () => {
    expect(
      shouldAcceptSqlEditorShortcut({
        pageActive: true,
        readOnly: false,
        focusInEditor: true,
      }),
    ).toBe(true);
    expect(
      shouldAcceptSqlEditorShortcut({
        pageActive: false,
        readOnly: false,
        focusInEditor: true,
      }),
    ).toBe(false);
    expect(
      shouldAcceptSqlEditorShortcut({
        pageActive: true,
        readOnly: true,
        focusInEditor: true,
      }),
    ).toBe(false);
    expect(
      shouldAcceptSqlEditorShortcut({
        pageActive: true,
        readOnly: false,
        focusInEditor: false,
      }),
    ).toBe(false);
  });

  it('rejects composing / repeat / already prevented', () => {
    const base = {
      pageActive: true,
      readOnly: false,
      focusInEditor: true,
    };
    expect(shouldAcceptSqlEditorShortcut({ ...base, isComposing: true })).toBe(
      false,
    );
    expect(shouldAcceptSqlEditorShortcut({ ...base, repeat: true })).toBe(false);
    expect(
      shouldAcceptSqlEditorShortcut({ ...base, defaultPrevented: true }),
    ).toBe(false);
  });
});

describe('sqlEditorShortcuts match', () => {
  it('matches F9 / Ctrl+Enter execute', () => {
    expect(matchSqlEditorShortcut({ key: 'F9' })).toBe('execute');
    expect(matchSqlEditorShortcut({ ctrlKey: true, key: 'Enter' })).toBe(
      'execute',
    );
  });

  it('matches Ctrl+S save and F12 format', () => {
    expect(matchSqlEditorShortcut({ ctrlKey: true, key: 's' })).toBe('save');
    expect(matchSqlEditorShortcut({ metaKey: true, code: 'KeyS', key: 'ß' })).toBe(
      'save',
    );
    expect(matchSqlEditorShortcut({ key: 'F12' })).toBe('format');
  });

  it('matches client-only explain / ask-ai, skips in embedded', () => {
    expect(
      matchSqlEditorShortcut({ ctrlKey: true, shiftKey: true, key: 'e' }),
    ).toBe('explain');
    expect(matchSqlEditorShortcut({ ctrlKey: true, key: 'k' })).toBe('ask-ai');
    expect(
      matchSqlEditorShortcut(
        { ctrlKey: true, shiftKey: true, key: 'e' },
        true,
      ),
    ).toBe(null);
    expect(matchSqlEditorShortcut({ ctrlKey: true, key: 'k' }, true)).toBe(
      null,
    );
  });

  it('inactive keep-alive page cannot accept even if monaco would fire', () => {
    // 模拟：后台 ETL 页焦点误报时仍被 pageActive 拦住
    expect(
      shouldAcceptSqlEditorShortcut({
        pageActive: false,
        readOnly: false,
        focusInEditor: true,
      }),
    ).toBe(false);
  });
});
