/**
 * SQL 工作台左侧对象树的会话缓存。
 *
 * 只活在当前页面内存里，不写 localStorage。组件销毁后缓存还在，
 * 因此离开工作台再进来不会重复请求已经加载过的实例和目录。
 * 缓存键带上桌面端服务地址和登录用户：切换地址或切换用户后读不到旧数据，会重新拉取。
 * 右键刷新、建表、建视图等主动刷新会覆盖对应条目。
 *
 * @author yanch
 */

export interface ObjectTreeCacheIdentity {
  dbConfigId: string | number;
  dbType: string;
  schemaMode?: string;
}

interface CacheBucket {
  instances: any[] | null;
  folders: Map<string, any[]>;
  schemaChildren: Map<string, any[]>;
  columns: Map<string, any[]>;
}

/** 没有登录用户时返回空串，调用方据此跳过缓存，避免身份未就绪时串数据。 */
export function resolveObjectTreeSessionScope(serverKey: string, userKey: string): string {
  const user = String(userKey || '').trim();
  if (!user) return '';
  const server = String(serverKey || '').trim() || 'web';
  return `${server}::${user}`;
}

function identityKey(identity: ObjectTreeCacheIdentity) {
  return `${String(identity.dbConfigId)}::${identity.dbType || ''}::${identity.schemaMode || ''}`;
}

function cloneData<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * 可注入 scope 读取函数，便于单测覆盖「切换用户 / 切换地址」。
 * 页面里使用模块单例，保证对象树反复挂载仍命中同一份缓存。
 */
export function createObjectTreeCache(getScope: () => string) {
  const buckets = new Map<string, Map<string, CacheBucket>>();

  function bucket(identity: ObjectTreeCacheIdentity, create: boolean): CacheBucket | null {
    const scope = getScope();
    if (!scope) return null;
    for (const key of [...buckets.keys()]) {
      if (key !== scope) buckets.delete(key);
    }
    let connections = buckets.get(scope);
    if (!connections) {
      if (!create) return null;
      connections = new Map();
      buckets.set(scope, connections);
    }
    const key = identityKey(identity);
    let item = connections.get(key);
    if (!item && create) {
      item = {
        instances: null,
        folders: new Map(),
        schemaChildren: new Map(),
        columns: new Map(),
      };
      connections.set(key, item);
    }
    return item ?? null;
  }

  return {
    readInstances(identity: ObjectTreeCacheIdentity): any[] | null {
      const item = bucket(identity, false);
      if (!item?.instances) return null;
      return cloneData(item.instances);
    },
    writeInstances(identity: ObjectTreeCacheIdentity, nodes: any[]) {
      const item = bucket(identity, true);
      if (!item) return;
      item.instances = cloneData(nodes);
    },
    readFolder(identity: ObjectTreeCacheIdentity, folderId: string): any[] | null {
      const list = bucket(identity, false)?.folders.get(folderId);
      return list ? cloneData(list) : null;
    },
    writeFolder(identity: ObjectTreeCacheIdentity, folderId: string, nodes: any[]) {
      const item = bucket(identity, true);
      if (!item) return;
      item.folders.set(folderId, cloneData(nodes));
    },
    readSchemaChildren(identity: ObjectTreeCacheIdentity, instanceName: string): any[] | null {
      const list = bucket(identity, false)?.schemaChildren.get(instanceName);
      return list ? cloneData(list) : null;
    },
    writeSchemaChildren(identity: ObjectTreeCacheIdentity, instanceName: string, nodes: any[]) {
      const item = bucket(identity, true);
      if (!item) return;
      item.schemaChildren.set(instanceName, cloneData(nodes));
    },
    readColumns(identity: ObjectTreeCacheIdentity, tableNodeId: string): any[] | null {
      const list = bucket(identity, false)?.columns.get(tableNodeId);
      return list ? cloneData(list) : null;
    },
    writeColumns(identity: ObjectTreeCacheIdentity, tableNodeId: string, nodes: any[]) {
      const item = bucket(identity, true);
      if (!item) return;
      item.columns.set(tableNodeId, cloneData(nodes));
    },
    /** 表目录刷新后丢掉该库下的字段缓存，下次展开字段会重新请求。 */
    invalidateColumns(identity: ObjectTreeCacheIdentity, instanceName: string) {
      const item = bucket(identity, false);
      if (!item || !instanceName) return;
      const prefix = `table-${instanceName}-`;
      for (const key of [...item.columns.keys()]) {
        if (key.startsWith(prefix)) item.columns.delete(key);
      }
    },
    /** 主动刷新整棵连接树时清掉该连接的实例、目录和字段。 */
    invalidateConnection(identity: ObjectTreeCacheIdentity) {
      const scope = getScope();
      if (!scope) return;
      buckets.get(scope)?.delete(identityKey(identity));
    },
    clear() {
      buckets.clear();
    },
  };
}

let scopeReader: () => string = () => '';

/** 由对象树在挂载时绑定当前桌面端地址和登录用户。 */
export function bindObjectTreeCacheScope(reader: () => string) {
  scopeReader = reader;
}

export const objectTreeCache = createObjectTreeCache(() => scopeReader());
