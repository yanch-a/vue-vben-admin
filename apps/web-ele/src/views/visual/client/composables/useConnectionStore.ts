/**
 * 打开连接会话状态（前端内存，非后端会话）
 * - openConnections：已打开的连接列表（同一 dbConfig 默认复用页签）
 * - id：dbConfigId（后端 API 用）
 * - sessionId：页签唯一键（切换/关闭/Tab 隔离用）
 * - activeConnectionId：当前工作页签的 sessionId
 * - 数量上限由 visualClientConfig 控制
 *
 * @author yanch
 */
import { computed, ref } from 'vue';

import { visualClientConfig } from '../config';
import { notifyClientSessionChange } from './clientSessionNotify';

export interface DbConnection {
  /** 数据库配置 ID（后端 API） */
  id: number | string;
  /**
   * 打开页签会话 ID；同一 id 可对应多个 sessionId。
   * 未传时由 openConnection 自动生成。
   */
  sessionId: string;
  dbName: string;
  schemaName?: string;
  dbType: string;
  dbHost?: string;
  dbPort?: number;
  username?: string;
  description?: string;
  connectionStatus?: number;
  /** 1=允许 AI 助手；缺省视为开启 */
  aiEnabled?: number;
  /** 1=允许把真实行数据发给模型；缺省 0=脱敏 */
  aiAllowSampleData?: number;
}

/** openConnection 结果，供 UI 提示 */
export type OpenConnectionResult =
  | { ok: true; switched: boolean; sessionId: string }
  | { ok: false; reason: 'max' | 'disabled' };

const openConnections = ref<DbConnection[]>([]);
/** 当前激活页签 = sessionId（不是 dbConfigId） */
const activeConnectionId = ref<number | string | null>(null);

let sessionSeq = 1;

/** 生成唯一页签会话 ID */
export function createConnectionSessionId(): string {
  return `sess-${Date.now()}-${sessionSeq++}`;
}

export function useConnectionStore() {
  const activeConnection = computed(
    () =>
      openConnections.value.find(
        (c) => c.sessionId === activeConnectionId.value,
      ) ?? null,
  );

  /**
   * 打开连接：同一 dbConfig 默认复用已有页签（避免「测试库 (2)」）。
   * - forceNew=true 时仍可新开
   * - allowMultipleConnections=false → 关闭其它连接后只保留当前
   * - 达到 maxOpenConnections → 拒绝打开并返回 reason
   */
  function openConnection(
    conn: Omit<DbConnection, 'sessionId'> & {
      sessionId?: string;
      forceNew?: boolean;
    },
  ): OpenConnectionResult {
    const forceNew = Boolean((conn as { forceNew?: boolean }).forceNew);
    const { forceNew: _ignoreForce, ...connRest } = conn as Omit<
      DbConnection,
      'sessionId'
    > & { sessionId?: string; forceNew?: boolean };

    if (!forceNew) {
      const existed = openConnections.value.find(
        (c) => String(c.id) === String(connRest.id),
      );
      if (existed) {
        activeConnectionId.value = existed.sessionId;
        notifyClientSessionChange();
        return { ok: true, switched: true, sessionId: existed.sessionId };
      }
    }

    const sessionId = connRest.sessionId || createConnectionSessionId();
    const next: DbConnection = { ...connRest, sessionId };

    const allowMulti = visualClientConfig.allowMultipleConnections;
    const max = visualClientConfig.maxOpenConnections;

    if (!allowMulti) {
      openConnections.value = [next];
      activeConnectionId.value = sessionId;
      notifyClientSessionChange();
      return { ok: true, switched: false, sessionId };
    }

    if (openConnections.value.length >= max) {
      return { ok: false, reason: 'max' };
    }

    openConnections.value.push(next);
    activeConnectionId.value = sessionId;
    notifyClientSessionChange();
    return { ok: true, switched: false, sessionId };
  }

  /** 按 sessionId 关闭连接页签 */
  function closeConnection(sessionId: number | string) {
    const idx = openConnections.value.findIndex(
      (c) => c.sessionId === sessionId,
    );
    if (idx < 0) return;
    openConnections.value.splice(idx, 1);
    if (activeConnectionId.value === sessionId) {
      activeConnectionId.value =
        openConnections.value[Math.max(0, idx - 1)]?.sessionId ?? null;
    }
    notifyClientSessionChange();
  }

  /** 按 sessionId 切换当前连接页签 */
  function setActiveConnection(sessionId: number | string) {
    if (openConnections.value.some((c) => c.sessionId === sessionId)) {
      activeConnectionId.value = sessionId;
      notifyClientSessionChange();
    }
  }

  /**
   * 同步已打开连接的展示信息（编辑连接后调用）。
   * 同一 dbConfigId 的多个页签一并更新，保留各自 sessionId。
   */
  function updateConnection(
    conn: Partial<DbConnection> & { id: number | string },
  ) {
    let changed = false;
    openConnections.value = openConnections.value.map((c) => {
      if (String(c.id) !== String(conn.id)) return c;
      changed = true;
      const { sessionId: _ignore, ...rest } = conn as Partial<DbConnection>;
      return { ...c, ...rest, sessionId: c.sessionId, id: c.id };
    });
    if (changed) notifyClientSessionChange();
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
