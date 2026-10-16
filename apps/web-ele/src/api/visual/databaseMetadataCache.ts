/**
 * 数据库元数据 IndexedDB 缓存。按服务端、用户、连接、实例和 schema 隔离，
 * 只缓存 API 成功响应；存储不可用时直接请求后台，不影响数据库操作。
 * @author yanch
 */
import { useUserStore } from '@vben/stores';

import { baseURL } from '#/config';
import { getDesktopServerStorageKey } from '#/desktop/runtime';

interface MetadataAddress {
  dbConfigId: number | string;
  instanceName?: string;
  schemaName?: string;
  resource: string;
  tableName?: string;
}

interface MetadataEntry extends MetadataAddress {
  key: string;
  connection: string;
  value: any;
}

const STORE_NAME = 'metadata';
let database: Promise<IDBDatabase | null> | undefined;
let unavailable = false;
const revisions = new Map<string, number>();
const pending = new Map<
  string,
  { address: MetadataAddress; connection: string; promise: Promise<any> }
>();

/** 使用实际 API 地址或桌面端服务标识，并在登录身份未就绪时跳过缓存。 */
export function getDatabaseMetadataScope(): string {
  try {
    const user = useUserStore().userInfo;
    const userId = user?.userId ?? user?.username;
    if (userId == null || userId === '') return '';
    const server =
      getDesktopServerStorageKey() ||
      new URL(baseURL, window.location.href).href;
    return JSON.stringify([server, String(userId)]);
  } catch {
    return '';
  }
}

/** 打开本地元数据库；升级被阻塞或存储报错后，本次页面会话改走后台。 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (unavailable || typeof window === 'undefined' || !window.indexedDB)
    return Promise.resolve(null);
  database ??= new Promise((resolve) => {
    const request = window.indexedDB.open('lemon-db-metadata', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, {
        keyPath: 'key',
      });
      store.createIndex('connection', 'connection');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (unavailable) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      disableCache(request.error);
      resolve(null);
    };
    request.onblocked = () => {
      disableCache(new Error('元数据库升级被其它页面阻塞'));
      resolve(null);
    };
  });
  return database;
}

/** 读写失败后不再读取可能未成功清理的旧记录，避免刷新后回到过期数据。 */
function disableCache(error: unknown) {
  if (!unavailable)
    console.warn('[database-metadata] IndexedDB 不可用，改为请求后台', error);
  unavailable = true;
}

/** 数组序列化可避免库名、schema 或表名内含分隔符时发生键碰撞。 */
function entryKey(connection: string, address: MetadataAddress): string {
  return JSON.stringify([
    connection,
    address.instanceName ?? null,
    address.schemaName ?? null,
    address.resource,
    address.tableName ?? null,
  ]);
}

/** 分层版本使刷新前已经发出的请求不能重新写回已清理的缓存。 */
function revisionKeys(
  connection: string,
  address: Partial<MetadataAddress>,
): string[] {
  const keys = [connection];
  if (address.instanceName !== undefined) {
    keys.push(JSON.stringify([connection, address.instanceName]));
    keys.push(
      JSON.stringify([
        connection,
        address.instanceName,
        address.schemaName ?? null,
      ]),
    );
  }
  return keys;
}

/** 读取一条响应；IDB 返回结构化副本，树组件修改节点不会污染持久化记录。 */
async function readEntry(key: string): Promise<MetadataEntry | undefined> {
  try {
    const db = await openDatabase();
    if (!db) return undefined;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    disableCache(error);
    return undefined;
  }
}

/** 提交响应时再次核对版本；事务完成后才允许后续查询命中。 */
async function writeEntries(
  entries: MetadataEntry[],
  isCurrent: () => boolean,
) {
  try {
    const db = await openDatabase();
    if (!db || !isCurrent()) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const entry of entries) store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    disableCache(error);
  }
}

/**
 * 请求前读缓存，同一地址的并发读取复用请求。
 * grouped 按响应 data[].schemaName 保存副本；schema 刷新只移除该分组及聚合结果，
 * 下一次整库扫描时沿用其它 schema 的副本，不覆盖未刷新的分组。
 */
export async function withDatabaseMetadataCache(
  address: MetadataAddress,
  loader: () => Promise<any>,
  grouped = false,
): Promise<any> {
  const scope = getDatabaseMetadataScope();
  if (!scope) return loader();
  const connection = JSON.stringify([scope, String(address.dbConfigId)]);
  const key = entryKey(connection, address);
  const existing = pending.get(key);
  if (existing) return structuredClone(await existing.promise);
  const versions = revisionKeys(connection, address).map(
    (key) => [key, revisions.get(key) || 0] as const,
  );
  const isCurrent = () =>
    getDatabaseMetadataScope() === scope &&
    versions.every(([key, version]) => (revisions.get(key) || 0) === version);
  /** 刷新使请求失效时改读新结果；身份切换后禁止把旧响应交给新会话。 */
  const reloadCurrent = () => {
    if (getDatabaseMetadataScope() !== scope) {
      throw new Error('服务端或登录用户已切换，请重新加载数据库元数据');
    }
    return withDatabaseMetadataCache(address, loader, grouped);
  };
  const promise = (async () => {
    const cached = await readEntry(key);
    if (!isCurrent()) return reloadCurrent();
    if (cached) return cached.value;
    const response = await loader();
    if (!isCurrent()) return reloadCurrent();
    const entries: MetadataEntry[] = [];
    let value = response;
    if (grouped && Array.isArray(response?.data)) {
      const groups = new Map<string, any[]>();
      for (const item of response.data) {
        const schema = String(item.schemaName || '');
        if (!groups.has(schema)) groups.set(schema, []);
        groups.get(schema)!.push(item);
      }
      const data: any[] = [];
      for (const [schemaName, items] of groups) {
        const groupAddress = { ...address, schemaName };
        const groupKey = entryKey(connection, groupAddress);
        const saved = await readEntry(groupKey);
        const groupValue = saved?.value ?? { ...response, data: items };
        data.push(...groupValue.data);
        if (!saved)
          entries.push({
            ...groupAddress,
            key: groupKey,
            connection,
            value: groupValue,
          });
      }
      value = { ...response, data };
    }
    entries.push({ ...address, key, connection, value });
    await writeEntries(entries, isCurrent);
    return isCurrent() ? value : reloadCurrent();
  })();
  pending.set(key, { address, connection, promise });
  try {
    return structuredClone(await promise);
  } finally {
    if (pending.get(key)?.promise === promise) pending.delete(key);
  }
}

/**
 * 清理当前服务端/用户下指定连接、实例或 schema 的全部元数据。
 * schema 刷新同时清掉整库聚合响应，保留其它 schema 的表、列及对象分组。
 */
export async function clearDatabaseMetadataCache(
  dbConfigId: number | string,
  instanceName?: string,
  schemaName?: string,
): Promise<void> {
  const scope = getDatabaseMetadataScope();
  if (!scope) return;
  const connection = JSON.stringify([scope, String(dbConfigId)]);
  const keys = revisionKeys(connection, { instanceName, schemaName });
  const changed =
    schemaName === undefined
      ? [keys[instanceName === undefined ? 0 : 1]!]
      : [keys[2]!, JSON.stringify([connection, instanceName, null])];
  for (const key of changed) revisions.set(key, (revisions.get(key) || 0) + 1);
  const matches = (entry: MetadataAddress) =>
    (instanceName === undefined || entry.instanceName === instanceName) &&
    (schemaName === undefined ||
      entry.schemaName === undefined ||
      entry.schemaName === '' ||
      entry.schemaName === schemaName);
  for (const [key, item] of pending) {
    if (item.connection === connection && matches(item.address))
      pending.delete(key);
  }
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const cursor = tx
        .objectStore(STORE_NAME)
        .index('connection')
        .openCursor(connection);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (matches(row.value)) row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    disableCache(error);
  }
}
