import { ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import type { DbConnection } from './useConnectionStore';
import type { QueryTab } from './useQueryTabs';
import {
  legacyClientSessionStorageKey,
  readSessionForUser,
  resetClientSessionMemoryOwner,
  resolveClientSessionStorageKey,
  setupClientSessionPersist,
  type PersistHandles,
} from './useClientSessionPersist';

/**
 * 已打开连接和 SQL 编辑器缓存按 userId 隔离。
 *
 * @author yanch
 */
describe('SQL 编辑器会话缓存', () => {
  afterEach(() => {
    localStorage.clear();
    resetClientSessionMemoryOwner();
  });

  it('缓存键带上 userId，没有用户时不生成键', () => {
    expect(resolveClientSessionStorageKey('')).toBe('');
    expect(resolveClientSessionStorageKey(' 12 ')).toContain(':u12');
    expect(resolveClientSessionStorageKey('12')).not.toBe(
      resolveClientSessionStorageKey('34'),
    );
    expect(legacyClientSessionStorageKey()).not.toContain(':u');
  });

  it('只读取当前用户的缓存，并把旧的共享缓存迁走', () => {
    const storage = memoryStorage();
    const legacy = legacySnapshot('select legacy');
    storage.setItem(legacyClientSessionStorageKey(), JSON.stringify(legacy));
    storage.setItem(
      resolveClientSessionStorageKey('2'),
      JSON.stringify(legacySnapshot('select user2', '2')),
    );

    const user1 = readSessionForUser('1', storage);
    expect(user1?.tabsByConnection['sess-1']?.[0]?.sql).toBe('select legacy');
    expect(user1?.userId).toBe('1');
    expect(storage.getItem(legacyClientSessionStorageKey())).toBeNull();

    const user2 = readSessionForUser('2', storage);
    expect(user2?.tabsByConnection['sess-1']?.[0]?.sql).toBe('select user2');
    expect(readSessionForUser('3', storage)).toBeNull();
  });

  it('缓存里的 userId 与键不一致时不加载', () => {
    const storage = memoryStorage();
    storage.setItem(
      resolveClientSessionStorageKey('8'),
      JSON.stringify(legacySnapshot('select other', '7')),
    );
    expect(readSessionForUser('8', storage)).toBeNull();
  });

  it('切换用户后不恢复上一用户的编辑器，各自缓存互不影响', () => {
    let userId = '1';
    const first = handles(true);
    const firstPersist = setupClientSessionPersist({
      ...first,
      getUserId: () => userId,
    });
    try {
      firstPersist.restore();
      firstPersist.flushNow();
    } finally {
      firstPersist.stop();
    }

    userId = '2';
    const second = handles(true);
    const secondPersist = setupClientSessionPersist({
      ...second,
      getUserId: () => userId,
    });
    try {
      expect(secondPersist.restore()).toBeNull();
      expect(second.openConnections.value).toEqual([]);
      expect(second.getTabsSnapshot().tabsByConnection).toEqual({});
    } finally {
      secondPersist.stop();
    }

    userId = '1';
    const back = handles(false);
    const backPersist = setupClientSessionPersist({
      ...back,
      getUserId: () => userId,
    });
    try {
      const restored = backPersist.restore();
      expect(restored?.connections[0]?.dbName).toBe('demo');
      expect(restored?.tabsByConnection['sess-1']?.[0]?.sql).toBe('select 1');
      expect(back.openConnections.value[0]?.dbName).toBe('demo');
    } finally {
      backPersist.stop();
    }
  });

  it('持久化编号只留在当前用户的本地缓存，切换用户不会带走', () => {
    let userId = '1';
    const first = handles(true);
    const firstPersist = setupClientSessionPersist({
      ...first,
      getUserId: () => userId,
    });
    try {
      firstPersist.restore();
      firstPersist.setPersistMeta('88', '客户库');
      expect(firstPersist.getPersistMeta()).toEqual({ id: '88', alias: '客户库' });
      expect(localStorage.getItem(resolveClientSessionStorageKey('1'))).toContain(
        '"persistId":"88"',
      );
    } finally {
      firstPersist.stop();
    }

    userId = '2';
    const second = handles(true);
    const secondPersist = setupClientSessionPersist({
      ...second,
      getUserId: () => userId,
    });
    try {
      secondPersist.restore();
      expect(secondPersist.getPersistMeta()).toEqual({ id: '', alias: '' });
      secondPersist.flushNow();
    } finally {
      secondPersist.stop();
    }
    expect(localStorage.getItem(resolveClientSessionStorageKey('2')) || '').not.toContain('88');
    expect(localStorage.getItem(resolveClientSessionStorageKey('1')) || '').toContain(
      '"persistId":"88"',
    );
  });

  it('加载服务器现场后记住这份记录的编号', () => {
    const state = handles(false);
    const persist = setupClientSessionPersist({
      ...state,
      getUserId: () => '5',
    });
    try {
      persist.restore();
      const snap = persist.applyOwnedSnapshot(legacySnapshot('select remote'), {
        id: '66',
        alias: '家里',
      });
      expect(snap?.tabsByConnection['sess-1']?.[0]?.sql).toBe('select remote');
      expect(state.openConnections.value[0]?.dbName).toBe('demo');
      expect(persist.getPersistMeta()).toEqual({ id: '66', alias: '家里' });
    } finally {
      persist.stop();
    }
  });

  it('退出登录后用户 id 已清空，仍写回原用户的缓存键', () => {
    let userId = '7';
    const state = handles(true);
    const persist = setupClientSessionPersist({
      ...state,
      getUserId: () => userId,
    });
    try {
      persist.restore();
      userId = '';
      persist.flushNow();
    } finally {
      persist.stop();
    }
    const raw = localStorage.getItem(resolveClientSessionStorageKey('7'));
    expect(raw).toContain('select 1');
    expect(localStorage.getItem(resolveClientSessionStorageKey('8'))).toBeNull();
  });
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function legacySnapshot(sql: string, userId?: string) {
  return {
    version: 2,
    userId,
    updatedAt: 1,
    activeConnectionId: 'sess-1',
    connections: [
      { id: 1, sessionId: 'sess-1', dbName: 'demo', dbType: 'mysql' },
    ],
    tabsByConnection: {
      'sess-1': [
        {
          id: 't1',
          title: 'Query',
          sql,
          resultVisible: false,
          resultTab: 'result',
        },
      ],
    },
    activeTabByConnection: { 'sess-1': 't1' },
  };
}

function handles(withEditor: boolean): PersistHandles & {
  getTabsSnapshot: () => {
    tabsByConnection: Record<string, QueryTab[]>;
    activeTabByConnection: Record<string, string>;
  };
} {
  const connection: DbConnection = {
    id: 1,
    sessionId: 'sess-1',
    dbName: 'demo',
    dbType: 'mysql',
  };
  const tabs: QueryTab[] = [
    {
      id: 't1',
      title: 'Query',
      sql: 'select 1',
      resultVisible: false,
      resultTab: 'result',
      executing: false,
      result: null,
    },
  ];
  const snapshot = {
    tabsByConnection: withEditor
      ? { 'sess-1': tabs }
      : ({} as Record<string, QueryTab[]>),
    activeTabByConnection: withEditor ? { 'sess-1': 't1' } : {},
  };
  return {
    openConnections: ref(withEditor ? [connection] : []),
    activeConnectionId: ref<number | string | null>(withEditor ? 'sess-1' : null),
    getTabsSnapshot: () => snapshot,
    applyTabsSnapshot: (data) => {
      snapshot.tabsByConnection = data.tabsByConnection as Record<string, QueryTab[]>;
      snapshot.activeTabByConnection = data.activeTabByConnection;
    },
    replaceConnectionTabs: () => {},
    leftWidth: ref(280),
    resultHeight: ref(240),
  };
}
