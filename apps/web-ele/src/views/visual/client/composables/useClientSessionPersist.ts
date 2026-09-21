/**
 * 数据库客户端会话持久化（localStorage）
 * - 保存：已打开连接 + 各连接下 SQL 编辑器 Tab（不含结果集大表，避免撑爆存储）
 * - 触发：状态 change 时 debounce 写入；另每 10s 定时增量落盘
 * - 恢复：挂载时校验结构后再回显，校验失败则跳过，避免弄乱页面
 *
 * @author yanch
 */
import { watch, type Ref, type WatchStopHandle } from 'vue';

import { getDesktopScopedStorageKey } from '#/desktop/runtime';

import { bindClientSessionChangeNotifier } from './clientSessionNotify';
import type { DbConnection } from './useConnectionStore';
import type { PersistedQueryTab, QueryTab } from './useQueryTabs';
import { visualClientConfig } from '../config';

// Electron 按服务端隔离已打开连接和 SQL Tab；Web 端仍使用原有键。
const STORAGE_KEY = getDesktopScopedStorageKey('visual-client-session-v1');
/** v2：连接页签用 sessionId，同一 dbConfig 可多开 */
const VERSION = 2;
/** 单 Tab SQL 最大字符，防止异常大文本写爆 localStorage */
const MAX_SQL_CHARS = 500_000;
const MAX_CONNECTIONS = visualClientConfig.maxOpenConnections;
const MAX_TABS_PER_CONN = visualClientConfig.maxSqlEditorsPerConnection;
const SAVE_DEBOUNCE_MS = 400;
const INTERVAL_MS = 10_000;

export interface ClientSessionSnapshot {
  version: number;
  updatedAt: number;
  activeConnectionId: number | string | null;
  connections: DbConnection[];
  tabsByConnection: Record<string, PersistedQueryTab[]>;
  activeTabByConnection: Record<string, string>;
  leftWidth?: number;
  resultHeight?: number;
}

/** 单个连接的查询导出包（不含其它连接）。 */
export interface ConnectionQueriesBundle {
  kind: 'lemon-connection-queries-v1';
  version: 1;
  updatedAt: number;
  /** 导出时的连接元数据，导入时仅作提示，以右键目标连接为准写入 */
  connection: DbConnection;
  tabs: PersistedQueryTab[];
  activeTabId?: string;
}

/** 会话持久化控制器，同时提供整会话和单连接查询的导入导出。 */
export interface ClientSessionPersistController {
  stop: () => void;
  restore: () => ClientSessionSnapshot | null;
  flushNow: () => void;
  exportSnapshot: () => ClientSessionSnapshot;
  importSnapshot: (raw: unknown) => ClientSessionSnapshot | null;
  exportConnectionQueries: (
    sessionId: number | string,
  ) => ConnectionQueriesBundle | null;
  importConnectionQueries: (
    sessionId: number | string,
    raw: unknown,
  ) => ConnectionQueriesBundle | null;
}

export interface PersistHandles {
  openConnections: Ref<DbConnection[]>;
  activeConnectionId: Ref<number | string | null>;
  /** 模块级 tabs 快照读写（由 useQueryTabs 导出） */
  getTabsSnapshot: () => {
    tabsByConnection: Record<string, QueryTab[]>;
    activeTabByConnection: Record<string, string>;
  };
  applyTabsSnapshot: (data: {
    tabsByConnection: Record<string, PersistedQueryTab[]>;
    activeTabByConnection: Record<string, string>;
  }) => void;
  /** 仅替换某个连接下的查询 Tab */
  replaceConnectionTabs: (
    connectionId: number | string,
    tabs: PersistedQueryTab[],
    activeTabId?: string,
  ) => void;
  leftWidth: Ref<number>;
  resultHeight: Ref<number>;
}

function stripConnection(c: DbConnection): DbConnection {
  // 不落盘密码；执行仍走后端 dbConfigId 取密
  const sessionId =
    c.sessionId && String(c.sessionId).trim()
      ? String(c.sessionId)
      : `sess-${c.id}`;
  return {
    id: c.id,
    sessionId,
    dbName: String(c.dbName || ''),
    schemaName: c.schemaName,
    dbType: String(c.dbType || ''),
    dbHost: c.dbHost,
    dbPort: c.dbPort,
    username: c.username,
    description: c.description,
    connectionStatus: c.connectionStatus,
    aiEnabled: c.aiEnabled == null ? 1 : Number(c.aiEnabled),
    aiAllowSampleData:
      c.aiAllowSampleData == null ? 0 : Number(c.aiAllowSampleData),
  };
}

function sanitizeTab(t: QueryTab | PersistedQueryTab): PersistedQueryTab | null {
  if (!t || typeof t !== 'object') return null;
  const id = String((t as any).id || '').trim();
  if (!id) return null;
  let sql = typeof (t as any).sql === 'string' ? (t as any).sql : '';
  if (sql.length > MAX_SQL_CHARS) {
    sql = sql.slice(0, MAX_SQL_CHARS);
  }
  const resultTab =
    (t as any).resultTab === 'messages' ? 'messages' : 'result';
  return {
    id,
    title: String((t as any).title || 'Query').slice(0, 200),
    sql,
    resultVisible: !!(t as any).resultVisible,
    resultTab,
    instanceName:
      (t as any).instanceName != null
        ? String((t as any).instanceName).slice(0, 200)
        : undefined,
    schemaName:
      (t as any).schemaName != null
        ? String((t as any).schemaName).slice(0, 200)
        : undefined,
    savedQueryId: (t as any).savedQueryId,
    savedSqlBaseline:
      typeof (t as any).savedSqlBaseline === 'string'
        ? (t as any).savedSqlBaseline.length > MAX_SQL_CHARS
          ? (t as any).savedSqlBaseline.slice(0, MAX_SQL_CHARS)
          : (t as any).savedSqlBaseline
        : undefined,
  };
}

/**
 * 导入场景：断开与远端「已保存查询」的 ID 关联，保留 Tab 标题（保存名）。
 * 避免导入后 Ctrl+S 误更新他人/他环境的库记录。
 */
function detachImportedSavedQueryIds(
  tabs: PersistedQueryTab[],
): PersistedQueryTab[] {
  return tabs.map((t) => ({
    ...t,
    savedQueryId: undefined,
    savedSqlBaseline: undefined,
  }));
}

/**
 * 校验并规范化快照；失败返回 null（调用方不得写入页面状态）
 */
export function validateSessionSnapshot(raw: unknown): ClientSessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  if (o.version !== VERSION) return null;
  if (!Array.isArray(o.connections)) return null;
  if (typeof o.tabsByConnection !== 'object' || o.tabsByConnection == null) {
    return null;
  }
  if (
    typeof o.activeTabByConnection !== 'object' ||
    o.activeTabByConnection == null
  ) {
    return null;
  }

  const connections: DbConnection[] = [];
  for (const item of o.connections.slice(0, MAX_CONNECTIONS)) {
    if (!item || item.id == null || item.id === '') continue;
    if (!item.dbName || !item.dbType) continue;
    connections.push(stripConnection(item as DbConnection));
  }

  // tabs / activeConnection 按 sessionId 隔离
  const sessionIds = new Set(connections.map((c) => String(c.sessionId)));
  const tabsByConnection: Record<string, PersistedQueryTab[]> = {};
  const activeTabByConnection: Record<string, string> = {};

  for (const [key, list] of Object.entries(o.tabsByConnection)) {
    if (!sessionIds.has(String(key))) continue;
    if (!Array.isArray(list)) continue;
    const tabs: PersistedQueryTab[] = [];
    for (const t of list.slice(0, MAX_TABS_PER_CONN)) {
      const s = sanitizeTab(t as PersistedQueryTab);
      if (s) tabs.push(s);
    }
    if (tabs.length === 0) continue;
    tabsByConnection[String(key)] = tabs;
    const activeId = o.activeTabByConnection[key];
    const pick =
      typeof activeId === 'string' && tabs.some((t) => t.id === activeId)
        ? activeId
        : tabs[0]!.id;
    activeTabByConnection[String(key)] = pick;
  }

  // activeConnectionId 存的是 sessionId
  let activeConnectionId: number | string | null = o.activeConnectionId ?? null;
  if (
    activeConnectionId != null &&
    !sessionIds.has(String(activeConnectionId))
  ) {
    activeConnectionId = connections[0]?.sessionId ?? null;
  }

  const leftWidth =
    typeof o.leftWidth === 'number' && o.leftWidth >= 100 && o.leftWidth <= 600
      ? o.leftWidth
      : undefined;
  const resultHeight =
    typeof o.resultHeight === 'number' &&
    o.resultHeight >= 80 &&
    o.resultHeight <= 1200
      ? o.resultHeight
      : undefined;

  return {
    version: VERSION,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    activeConnectionId,
    connections,
    tabsByConnection,
    activeTabByConnection,
    leftWidth,
    resultHeight,
  };
}

/** 校验「单连接查询」导出包。 */
export function validateConnectionQueriesBundle(
  raw: unknown,
): ConnectionQueriesBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  if (o.kind !== 'lemon-connection-queries-v1' || o.version !== 1) return null;
  if (!o.connection || o.connection.id == null || o.connection.id === '') {
    return null;
  }
  if (!o.connection.dbName || !o.connection.dbType) return null;
  if (!Array.isArray(o.tabs)) return null;

  const tabs: PersistedQueryTab[] = [];
  for (const item of o.tabs.slice(0, MAX_TABS_PER_CONN)) {
    const tab = sanitizeTab(item as PersistedQueryTab);
    if (tab) tabs.push(tab);
  }
  if (tabs.length === 0) return null;

  const activeTabId =
    typeof o.activeTabId === 'string' && tabs.some((t) => t.id === o.activeTabId)
      ? o.activeTabId
      : tabs[0]!.id;

  return {
    kind: 'lemon-connection-queries-v1',
    version: 1,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    connection: stripConnection(o.connection as DbConnection),
    tabs,
    activeTabId,
  };
}

export function readSessionFromStorage(): ClientSessionSnapshot | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return validateSessionSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

function buildSnapshot(h: PersistHandles): ClientSessionSnapshot {
  const { tabsByConnection, activeTabByConnection } = h.getTabsSnapshot();
  const tabsOut: Record<string, PersistedQueryTab[]> = {};
  const activeOut: Record<string, string> = {};

  for (const [key, list] of Object.entries(tabsByConnection)) {
    const tabs: PersistedQueryTab[] = [];
    for (const t of (list || []).slice(0, MAX_TABS_PER_CONN)) {
      const s = sanitizeTab(t);
      if (s) tabs.push(s);
    }
    if (tabs.length) {
      tabsOut[key] = tabs;
      const aid = activeTabByConnection[key];
      activeOut[key] =
        aid && tabs.some((t) => t.id === aid) ? aid : tabs[0]!.id;
    }
  }

  return {
    version: VERSION,
    updatedAt: Date.now(),
    activeConnectionId: h.activeConnectionId.value,
    connections: h.openConnections.value.map(stripConnection),
    tabsByConnection: tabsOut,
    activeTabByConnection: activeOut,
    leftWidth: h.leftWidth.value,
    resultHeight: h.resultHeight.value,
  };
}

function writeSnapshot(snap: ClientSessionSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch (e) {
    // quota 满等：静默失败，不打断编辑
    console.warn('[visual-client] session persist failed', e);
  }
}

/**
 * 启动持久化：change debounce + 每 10s 定时落盘；挂载时 restore
 * @author yanch
 */
export function setupClientSessionPersist(
  h: PersistHandles,
): ClientSessionPersistController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let restoring = false;

  const flush = () => {
    if (stopped || restoring) return;
    writeSnapshot(buildSnapshot(h));
  };

  const schedule = () => {
    if (stopped || restoring) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  bindClientSessionChangeNotifier(schedule);

  const stops: WatchStopHandle[] = [];
  stops.push(watch(h.openConnections, schedule, { deep: true }));
  stops.push(watch(h.activeConnectionId, schedule));
  stops.push(watch(h.leftWidth, schedule));
  stops.push(watch(h.resultHeight, schedule));

  intervalId = setInterval(flush, INTERVAL_MS);

  const restore = (): ClientSessionSnapshot | null => {
    const snap = readSessionFromStorage();
    if (!snap) return null;
    restoring = true;
    try {
      h.openConnections.value = snap.connections.map(stripConnection);
      h.activeConnectionId.value = snap.activeConnectionId;
      h.applyTabsSnapshot({
        tabsByConnection: snap.tabsByConnection,
        activeTabByConnection: snap.activeTabByConnection,
      });
      if (snap.leftWidth != null) h.leftWidth.value = snap.leftWidth;
      if (snap.resultHeight != null) h.resultHeight.value = snap.resultHeight;
      return snap;
    } catch (e) {
      console.warn('[visual-client] session restore aborted', e);
      return null;
    } finally {
      // 下一 tick 后再允许落盘，避免把半成品写回
      setTimeout(() => {
        restoring = false;
      }, 0);
    }
  };

  return {
    restore,
    flushNow: flush,
    /** 导出当前内存中的连接与查询快照（已 sanitize，不含密码）。 */
    exportSnapshot: (): ClientSessionSnapshot => {
      flush();
      return buildSnapshot(h);
    },
    /**
     * 导入快照并覆盖当前会话。
     * Electron 下仍写入当前服务端隔离的 localStorage 键，避免串服。
     */
    importSnapshot: (raw: unknown): ClientSessionSnapshot | null => {
      const snap = validateSessionSnapshot(raw);
      if (!snap) return null;
      restoring = true;
      try {
        h.openConnections.value = snap.connections.map(stripConnection);
        h.activeConnectionId.value = snap.activeConnectionId;
        // 跨环境导入：清掉 savedQueryId，标题保留，下次保存走新建
        const tabsByConnection: Record<string, PersistedQueryTab[]> = {};
        for (const [sid, list] of Object.entries(snap.tabsByConnection)) {
          tabsByConnection[sid] = detachImportedSavedQueryIds(list || []);
        }
        h.applyTabsSnapshot({
          tabsByConnection,
          activeTabByConnection: snap.activeTabByConnection,
        });
        if (snap.leftWidth != null) h.leftWidth.value = snap.leftWidth;
        if (snap.resultHeight != null) h.resultHeight.value = snap.resultHeight;
        // 落盘也用剥离后的 tabs，避免刷新后又带上外源 ID
        writeSnapshot({
          ...snap,
          tabsByConnection,
        });
        return snap;
      } catch (e) {
        console.warn('[visual-client] session import aborted', e);
        return null;
      } finally {
        setTimeout(() => {
          restoring = false;
        }, 0);
      }
    },
    /** 导出指定连接下的查询 Tab（不含其它连接）。 */
    exportConnectionQueries: (
      sessionId: number | string,
    ): ConnectionQueriesBundle | null => {
      flush();
      const sid = String(sessionId);
      const conn = h.openConnections.value.find(
        (item) => String(item.sessionId) === sid,
      );
      if (!conn) return null;
      const { tabsByConnection, activeTabByConnection } = h.getTabsSnapshot();
      const tabs: PersistedQueryTab[] = [];
      for (const tab of (tabsByConnection[sid] || []).slice(0, MAX_TABS_PER_CONN)) {
        const sanitized = sanitizeTab(tab);
        if (sanitized) tabs.push(sanitized);
      }
      if (tabs.length === 0) return null;
      const activeId = activeTabByConnection[sid];
      return {
        kind: 'lemon-connection-queries-v1',
        version: 1,
        updatedAt: Date.now(),
        connection: stripConnection(conn),
        tabs,
        activeTabId:
          activeId && tabs.some((t) => t.id === activeId)
            ? activeId
            : tabs[0]!.id,
      };
    },
    /**
     * 把单连接查询包导入到指定已打开连接，仅替换该连接的查询 Tab。
     */
    importConnectionQueries: (
      sessionId: number | string,
      raw: unknown,
    ): ConnectionQueriesBundle | null => {
      const bundle = validateConnectionQueriesBundle(raw);
      if (!bundle) return null;
      const sid = String(sessionId);
      const exists = h.openConnections.value.some(
        (item) => String(item.sessionId) === sid,
      );
      if (!exists) return null;
      restoring = true;
      try {
        // 导入本连接查询：保留名称，清空外源 savedQueryId
        const tabs = detachImportedSavedQueryIds(bundle.tabs);
        h.replaceConnectionTabs(sid, tabs, bundle.activeTabId);
        flush();
        return bundle;
      } catch (e) {
        console.warn('[visual-client] connection queries import aborted', e);
        return null;
      } finally {
        setTimeout(() => {
          restoring = false;
        }, 0);
      }
    },
    stop: () => {
      stopped = true;
      bindClientSessionChangeNotifier(null);
      if (timer) clearTimeout(timer);
      if (intervalId) clearInterval(intervalId);
      stops.forEach((s) => s());
      flush();
    },
  };
}
