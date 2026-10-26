import { describe, expect, it } from 'vitest';

import { isEtlSaveShortcut, shouldHandleEtlSave } from './etlSaveShortcut';

describe('ETL 保存快捷键', () => {
  it('识别 Ctrl+S 与 Cmd+S（含大写 / 非英文布局用 code）', () => {
    expect(isEtlSaveShortcut({ ctrlKey: true, key: 's' })).toBe(true);
    expect(isEtlSaveShortcut({ metaKey: true, key: 'S' })).toBe(true);
    expect(isEtlSaveShortcut({ ctrlKey: true, code: 'KeyS', key: 'ы' })).toBe(true);
  });

  it('不带修饰键或带 Alt / Shift 不算', () => {
    expect(isEtlSaveShortcut({ key: 's' })).toBe(false);
    expect(isEtlSaveShortcut({ ctrlKey: true, shiftKey: true, key: 's' })).toBe(false);
    expect(isEtlSaveShortcut({ ctrlKey: true, altKey: true, key: 's' })).toBe(false);
    expect(isEtlSaveShortcut({ ctrlKey: true, key: 'z' })).toBe(false);
  });

  it('重复按键、输入法组合中、编辑器已处理的事件跳过', () => {
    expect(shouldHandleEtlSave({ ctrlKey: true, key: 's' })).toBe(true);
    expect(shouldHandleEtlSave({ ctrlKey: true, key: 's', repeat: true })).toBe(false);
    expect(shouldHandleEtlSave({ ctrlKey: true, key: 's', isComposing: true })).toBe(false);
    expect(shouldHandleEtlSave({ ctrlKey: true, key: 's', defaultPrevented: true })).toBe(false);
  });
});
