/**
 * SQL 编辑器页签级快捷键判定（避免 keep-alive 下多 Monaco 实例 addCommand 串台/抢键导致全失效）。
 * @author yanch
 */

export interface SqlEditorShortcutGate {
  pageActive: boolean;
  readOnly: boolean;
  focusInEditor: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

export type SqlEditorShortcutAction =
  | 'execute'
  | 'save'
  | 'format'
  | 'explain'
  | 'ask-ai'
  | null;

export interface SqlEditorKeyEvent {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  key?: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** 当前页激活、非只读、焦点在本编辑器内，且事件未被消费时才处理 */
export function shouldAcceptSqlEditorShortcut(gate: SqlEditorShortcutGate): boolean {
  if (!gate.pageActive || gate.readOnly) return false;
  if (gate.defaultPrevented || gate.isComposing || gate.repeat) return false;
  return !!gate.focusInEditor;
}

function keyIs(e: SqlEditorKeyEvent, letter: string): boolean {
  const lower = letter.toLowerCase();
  return (
    e.code === `Key${letter.toUpperCase()}` ||
    String(e.key || '').toLowerCase() === lower
  );
}

/**
 * 匹配编辑器快捷键动作。
 * embedded=true 时不处理仅查询客户端才有的 explain / ask-ai。
 */
export function matchSqlEditorShortcut(
  e: SqlEditorKeyEvent,
  embedded = false,
): SqlEditorShortcutAction {
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const alt = !!e.altKey;
  const shift = !!e.shiftKey;
  const key = String(e.key || '');

  if (key === 'F9' && !ctrl && !alt && !shift) return 'execute';
  if (ctrl && !alt && !shift && key === 'Enter') return 'execute';
  if (ctrl && !alt && !shift && keyIs(e, 's')) return 'save';
  if (key === 'F12' && !ctrl && !alt && !shift) return 'format';

  if (embedded) return null;

  if (ctrl && shift && !alt && keyIs(e, 'e')) return 'explain';
  if (ctrl && !shift && !alt && keyIs(e, 'k')) return 'ask-ai';
  return null;
}
