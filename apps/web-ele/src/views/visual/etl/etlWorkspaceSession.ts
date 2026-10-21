/**
 * ETL 工作区页面状态的会话内缓存（按工作区 ID）。
 *
 * <p>左侧切换工作区时，把离开的工作区的编辑状态（未保存文档、当前任务、选中节点、视图、撤销历史、
 * 画布缩放/平移/搜索、滚动位置等）放进内存；切回来时如果服务端 revision 没变就原样恢复，
 * 不再用服务端数据覆盖未保存的修改。只在当前页面会话内有效，刷新页面即清空。</p>
 *
 * @author yanch
 */

export const ETL_SESSION_LIMIT = 10;
/** 非活动工作区缓存里保留的撤销 / 重做步数。 */
export const ETL_SESSION_HISTORY_STEPS = 20;
/** 单个预览结果超过这么多单元格（行 × 列）就不放进缓存，切回来需要重新预览。 */
export const ETL_SESSION_PREVIEW_CELLS = 5000;

/** 去掉大的预览结果，只保留小结果；返回新对象，不改原数据。 */
export function trimEtlSessionPreviews<T extends { columns?: unknown[]; rows?: unknown[] }>(
  previews: Record<string, T>,
  maxCells = ETL_SESSION_PREVIEW_CELLS,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(previews || {})) {
    const cells = (value?.rows?.length || 0) * Math.max(1, value?.columns?.length || 0);
    if (cells <= maxCells) result[key] = value;
  }
  return result;
}

/** 画布视图状态（缩放、平移、搜索词）。 */
export interface EtlCanvasViewState {
  keyword: string;
  matchIndex: number;
  scale: number;
  tx: number;
  ty: number;
}

export interface EtlWorkspaceSessionCache<T extends { remoteRevision: number }> {
  clear: () => void;
  delete: (id: number | string) => void;
  get: (id: number | string) => T | undefined;
  has: (id: number | string) => boolean;
  keys: () => string[];
  set: (id: number | string, state: T) => void;
  /** 取出缓存：服务端 revision 与缓存时一致才可完整复用（未保存修改、撤销历史）。 */
  take: (id: number | string, remoteRevision: number) => undefined | { full: boolean; state: T };
}

export function createEtlWorkspaceSessionCache<T extends { remoteRevision: number }>(
  limit = ETL_SESSION_LIMIT,
): EtlWorkspaceSessionCache<T> {
  const map = new Map<string, T>();
  return {
    clear: () => map.clear(),
    delete: (id) => {
      map.delete(String(id));
    },
    get: (id) => map.get(String(id)),
    has: (id) => map.has(String(id)),
    keys: () => [...map.keys()],
    set(id, state) {
      const key = String(id);
      map.delete(key);
      map.set(key, state);
      // 最近最少使用的先淘汰，避免上百个工作区来回切换时内存无限增长。
      while (map.size > Math.max(1, limit)) map.delete(map.keys().next().value!);
    },
    take(id, remoteRevision) {
      const key = String(id);
      const state = map.get(key);
      if (!state) return undefined;
      map.delete(key);
      return { full: Number(state.remoteRevision) === Number(remoteRevision), state };
    },
  };
}
