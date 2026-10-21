/**
 * 任务标签的本地状态：哪些任务被关掉，以及上次停留的工作区。
 * 任务下拉包含已关闭任务；重新进入页面时不能按这个下拉的第一项打开。
 * @author yanch
 */
import { getDesktopScopedStorageKey } from '../../../desktop/runtime';

const CLOSED_STORE_KEY = 'lemon-etl-closed-tabs-v1';
const LAST_WORKSPACE_KEY = 'lemon-etl-last-workspace-v1';

function closedStorageKey() {
  return getDesktopScopedStorageKey(CLOSED_STORE_KEY);
}

function readClosedStore(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(closedStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** 该工作区里用户关掉的任务。刷新后标签栏仍按这个列表收起。 */
export function loadClosedPipelineIds(workspaceId: string | number): string[] {
  const list = readClosedStore()[String(workspaceId)];
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}

/** 写入已关闭任务。空列表时删掉这一项，避免本地缓存越积越大。 */
export function saveClosedPipelineIds(
  workspaceId: string | number,
  ids: string[],
) {
  const store = readClosedStore();
  const key = String(workspaceId);
  const next = [...new Set(ids.map(String).filter(Boolean))];
  if (!next.length) delete store[key];
  else store[key] = next;
  try {
    if (!Object.keys(store).length) {
      localStorage.removeItem(closedStorageKey());
    } else {
      localStorage.setItem(closedStorageKey(), JSON.stringify(store));
    }
  } catch {
    /* 配额不足时忽略，不影响当前会话 */
  }
}

/**
 * 决定重新打开工作区时看哪个任务。
 * 已经开着的标签优先：上次正在看的任务如果还开着，就留在它上面；
 * 否则用已打开标签里的第一个。下拉第一项若已关闭，不能把它重新打开。
 * 一个都没开时返回空字符串，交给标签栏显示「用下拉重新打开」。
 */
export function preferredOpenPipelineId(
  pipelines: { id: string }[],
  workspaceId: string | number,
  hintedId?: string,
): string {
  const closed = new Set(loadClosedPipelineIds(workspaceId));
  const opened = pipelines.filter(
    (item) => item.id && !closed.has(String(item.id)),
  );
  if (hintedId && opened.some((item) => item.id === hintedId)) return hintedId;
  return opened[0]?.id || '';
}

/** 记住这次真正打开的工作区，下次进来不要落到列表第一项。 */
export function rememberEtlWorkspace(id: string | number) {
  if (id == null || id === '') return;
  try {
    localStorage.setItem(
      getDesktopScopedStorageKey(LAST_WORKSPACE_KEY),
      String(id),
    );
  } catch {
    /* 记不住时退回列表第一项 */
  }
}

export function readLastEtlWorkspace(): string {
  try {
    return (
      localStorage.getItem(getDesktopScopedStorageKey(LAST_WORKSPACE_KEY)) ||
      ''
    );
  } catch {
    return '';
  }
}
