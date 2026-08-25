/**
 * 跨页面打开已保存查询：管理页写入，客户端消费后打开编辑器
 * 使用模块级单例，与 useConnectionStore 一样在 SPA 内跨路由共享
 *
 * @author yanch
 */

export interface PendingSavedQueryOpen {
  id: number | string;
  queryName: string;
  sqlText: string;
  instanceName: string;
  dbConfigId: number | string;
}

let pending: PendingSavedQueryOpen | null = null;

/** 管理页 / 搜索结果：请求客户端打开某条已保存查询 */
export function setPendingSavedQueryOpen(payload: PendingSavedQueryOpen) {
  pending = { ...payload };
}

/** 客户端消费一次，消费后清空 */
export function consumePendingSavedQueryOpen(): PendingSavedQueryOpen | null {
  const cur = pending;
  pending = null;
  return cur;
}

/** 是否仍有待打开项（调试用） */
export function peekPendingSavedQueryOpen(): PendingSavedQueryOpen | null {
  return pending;
}
