/**
 * 每个连接下的查询编辑器 Tab（最多 MAX_TABS 个）
 * 状态按 connectionId 隔离，切换连接不丢草稿 SQL / 结果。
 * 支持会话快照读写（localStorage 持久化，不含结果集行数据）。
 *
 * @author yanch
 */
import { computed, reactive } from 'vue';

import { visualClientConfig } from '../config';
import { notifyClientSessionChange } from './clientSessionNotify';

export interface QueryResultState {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  elapsedMs?: number;
  message?: string;
  error?: string;
  /** 产生该结果的 SQL，用于解析目标表 */
  sourceSql?: string;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  resultVisible: boolean;
  resultTab: 'result' | 'messages';
  executing: boolean;
  result: QueryResultState | null;
  /** 当前编辑器所属数据库/Schema（因库类型含义不同） */
  instanceName?: string;
  /** 已关联的保存查询 ID（有则 Ctrl+S 可覆盖更新） */
  savedQueryId?: number | string;
}

/** 可序列化的编辑器 Tab（不含 rows / executing） */
export interface PersistedQueryTab {
  id: string;
  title: string;
  sql: string;
  resultVisible: boolean;
  resultTab: 'result' | 'messages';
  instanceName?: string;
  savedQueryId?: number | string;
}

/** 每个连接最多 SQL 编辑器数（来自配置文件） */
const MAX_TABS = visualClientConfig.maxSqlEditorsPerConnection;

/** key = connectionId */
const tabsByConnection = reactive<Record<string, QueryTab[]>>({});
const activeTabByConnection = reactive<Record<string, string>>({});

let seq = 1;

function connKey(connectionId: number | string) {
  return String(connectionId);
}

function createTab(
  title?: string,
  sql = '',
  instanceName?: string,
  savedQueryId?: number | string,
): QueryTab {
  const id = `q-${Date.now()}-${seq++}`;
  return {
    id,
    title: title || `Query ${seq}`,
    sql,
    resultVisible: false,
    resultTab: 'result',
    executing: false,
    result: null,
    instanceName,
    savedQueryId,
  };
}

/** 确保连接至少有一个查询 Tab */
function ensureTabs(connectionId: number | string) {
  const key = connKey(connectionId);
  if (!tabsByConnection[key] || tabsByConnection[key]!.length === 0) {
    const tab = createTab('Query 1');
    tabsByConnection[key] = [tab];
    activeTabByConnection[key] = tab.id;
  }
  return tabsByConnection[key]!;
}

/** 供 localStorage 快照：原始模块状态 */
export function getQueryTabsSnapshot() {
  return {
    tabsByConnection: { ...tabsByConnection } as Record<string, QueryTab[]>,
    activeTabByConnection: { ...activeTabByConnection } as Record<
      string,
      string
    >,
  };
}

/**
 * 回放持久化的 Tab 状态。校验已在 persist 层完成；此处再清执行态/结果集。
 * @author yanch
 */
export function applyQueryTabsSnapshot(data: {
  tabsByConnection: Record<string, PersistedQueryTab[]>;
  activeTabByConnection: Record<string, string>;
}) {
  // 先清空，避免残留脏 key
  for (const k of Object.keys(tabsByConnection)) {
    delete tabsByConnection[k];
  }
  for (const k of Object.keys(activeTabByConnection)) {
    delete activeTabByConnection[k];
  }

  for (const [key, list] of Object.entries(data.tabsByConnection || {})) {
    const tabs: QueryTab[] = (list || []).map((t) => ({
      id: t.id,
      title: t.title || 'Query',
      sql: t.sql || '',
      resultVisible: !!t.resultVisible,
      resultTab: t.resultTab === 'messages' ? 'messages' : 'result',
      executing: false,
      // 不回放结果集，避免过期/巨大数据弄乱 UI
      result: null,
      instanceName: t.instanceName,
      savedQueryId: t.savedQueryId,
    }));
    if (tabs.length === 0) continue;
    tabsByConnection[key] = tabs;
    const aid = data.activeTabByConnection?.[key];
    activeTabByConnection[key] =
      aid && tabs.some((x) => x.id === aid) ? aid : tabs[0]!.id;
  }
}

export function useQueryTabs(connectionId: () => number | string | null) {
  const tabs = computed(() => {
    const id = connectionId();
    if (id == null) return [] as QueryTab[];
    return ensureTabs(id);
  });

  const activeTabId = computed({
    get() {
      const id = connectionId();
      if (id == null) return '';
      ensureTabs(id);
      return activeTabByConnection[connKey(id)] || '';
    },
    set(val: string) {
      const id = connectionId();
      if (id == null) return;
      activeTabByConnection[connKey(id)] = val;
      notifyClientSessionChange();
    },
  });

  const activeTab = computed(
    () => tabs.value.find((t) => t.id === activeTabId.value) ?? null,
  );

  function addTab(opts?: {
    title?: string;
    sql?: string;
    instanceName?: string;
    savedQueryId?: number | string;
    activate?: boolean;
  }) {
    const id = connectionId();
    if (id == null) return null;
    const list = ensureTabs(id);
    if (list.length >= MAX_TABS) {
      return null;
    }
    // 若已有同 savedQueryId 的 Tab，直接激活
    if (opts?.savedQueryId != null) {
      const exist = list.find(
        (t) => String(t.savedQueryId) === String(opts.savedQueryId),
      );
      if (exist) {
        if (opts?.activate !== false) {
          activeTabByConnection[connKey(id)] = exist.id;
        }
        exist.sql = opts.sql ?? exist.sql;
        exist.title = opts.title || exist.title;
        exist.instanceName = opts.instanceName || exist.instanceName;
        notifyClientSessionChange();
        return exist;
      }
    }
    const tab = createTab(
      opts?.title,
      opts?.sql || '',
      opts?.instanceName,
      opts?.savedQueryId,
    );
    list.push(tab);
    if (opts?.activate !== false) {
      activeTabByConnection[connKey(id)] = tab.id;
    }
    notifyClientSessionChange();
    return tab;
  }

  function closeTab(tabId: string) {
    const id = connectionId();
    if (id == null) return;
    const key = connKey(id);
    const list = tabsByConnection[key];
    if (!list) return;
    const idx = list.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    list.splice(idx, 1);
    if (list.length === 0) {
      const tab = createTab('Query 1');
      list.push(tab);
      activeTabByConnection[key] = tab.id;
      notifyClientSessionChange();
      return;
    }
    if (activeTabByConnection[key] === tabId) {
      activeTabByConnection[key] = list[Math.max(0, idx - 1)]!.id;
    }
    notifyClientSessionChange();
  }

  function openSqlInNewTab(
    sql: string,
    title?: string,
    instanceName?: string,
    savedQueryId?: number | string,
  ) {
    return addTab({ title, sql, instanceName, savedQueryId, activate: true });
  }

  return {
    MAX_TABS,
    tabs,
    activeTabId,
    activeTab,
    addTab,
    closeTab,
    openSqlInNewTab,
  };
}
