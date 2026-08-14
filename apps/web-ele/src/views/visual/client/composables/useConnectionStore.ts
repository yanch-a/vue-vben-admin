/**
 * 打开连接会话状态（前端内存，非后端会话）
 * - openConnections：已打开的连接列表
 * - activeConnectionId：当前工作连接
 * - 数量上限由 visualClientConfig 控制
 *
 * @author yanch
 */
import { computed, ref } from 'vue';

import { visualClientConfig } from '../config';
import { notifyClientSessionChange } from './clientSessionNotify';

export interface DbConnection {
  id: number | string;
  dbName: string;
  schemaName?: string;
  dbType: string;
  dbHost?: string;
  dbPort?: number;
  username?: string;
  description?: string;
  connectionStatus?: number;
}

/** openConnection 结果，供 UI 提示 */
export type OpenConnectionResult =
  | { ok: true; switched: boolean }
  | { ok: false; reason: 'max' | 'disabled' };

const openConnections = ref<DbConnection[]>([]);
const activeConnectionId = ref<number | string | null>(null);

export function useConnectionStore() {
  const activeConnection = computed(
    () =>
      openConnections.value.find((c) => c.id === activeConnectionId.value) ??
      null,
  );

  /**
   * 打开连接。
   * - 已存在同 id → 切到该 Tab
   * - allowMultipleConnections=false → 关闭其它连接后只保留当前
   * - 达到 maxOpenConnections → 拒绝打开并返回 reason
   */
  function openConnection(conn: DbConnection): OpenConnectionResult {
    const existed = openConnections.value.some((c) => c.id === conn.id);
    if (existed) {
      activeConnectionId.value = conn.id;
      notifyClientSessionChange();
      return { ok: true, switched: true };
    }

    const allowMulti = visualClientConfig.allowMultipleConnections;
    const max = visualClientConfig.maxOpenConnections;

    if (!allowMulti) {
      // 只允许一个连接：清空后打开当前
      openConnections.value = [{ ...conn }];
      activeConnectionId.value = conn.id;
      notifyClientSessionChange();
      return { ok: true, switched: false };
    }

    if (openConnections.value.length >= max) {
      return { ok: false, reason: 'max' };
    }

    openConnections.value.push({ ...conn });
    activeConnectionId.value = conn.id;
    notifyClientSessionChange();
    return { ok: true, switched: false };
  }

  function closeConnection(id: number | string) {
    const idx = openConnections.value.findIndex((c) => c.id === id);
    if (idx < 0) return;
    openConnections.value.splice(idx, 1);
    if (activeConnectionId.value === id) {
      activeConnectionId.value =
        openConnections.value[Math.max(0, idx - 1)]?.id ?? null;
    }
    notifyClientSessionChange();
  }

  function setActiveConnection(id: number | string) {
    if (openConnections.value.some((c) => c.id === id)) {
      activeConnectionId.value = id;
      notifyClientSessionChange();
    }
  }

  /** 同步已打开连接的展示信息（编辑连接后调用） */
  function updateConnection(
    conn: Partial<DbConnection> & { id: number | string },
  ) {
    const idx = openConnections.value.findIndex((c) => c.id === conn.id);
    if (idx < 0) return;
    openConnections.value[idx] = {
      ...openConnections.value[idx],
      ...conn,
    };
    notifyClientSessionChange();
  }

  return {
    openConnections,
    activeConnectionId,
    activeConnection,
    openConnection,
    closeConnection,
    setActiveConnection,
    updateConnection,
  };
}
