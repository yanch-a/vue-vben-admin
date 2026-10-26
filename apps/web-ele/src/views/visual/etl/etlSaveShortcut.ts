/**
 * ETL 页面全局保存快捷键（Ctrl+S / Cmd+S）的按键判断，纯函数便于单测。
 *
 * @author yanch
 */

export interface EtlSaveKeyEvent {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  key?: string;
  metaKey?: boolean;
  repeat?: boolean;
  shiftKey?: boolean;
}

/** 是否是保存快捷键：Ctrl+S 或 Cmd+S，不带 Alt / Shift（Ctrl+Shift+S 留给浏览器 / 其他功能）。 */
export function isEtlSaveShortcut(event: EtlSaveKeyEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.code === 'KeyS' || String(event.key || '').toLowerCase() === 's';
}

/**
 * 是否由页面级监听来保存：按住不放的重复事件、输入法组合中、
 * 已被编辑器（Monaco 自带 Ctrl+S 命令会 preventDefault）处理过的事件都跳过，避免重复保存。
 */
export function shouldHandleEtlSave(event: EtlSaveKeyEvent) {
  return isEtlSaveShortcut(event) && !event.defaultPrevented && !event.repeat && !event.isComposing;
}
