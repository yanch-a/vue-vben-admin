/**
 * 已保存查询「按数据库树」视图的组装工具。
 *
 * <p>后端只返回「分组 → 查询」树，这里在前端把其中的查询叶子重新归类为
 * 「连接 → 数据库 → Schema（可选）→ 查询」，不需要额外接口。</p>
 *
 * @author yanch
 */

/** 按数据库树中的目录节点类型 */
export type SavedQueryDbFolderType = 'connection' | 'database' | 'schema';

/** 组装数据库树所需的查询字段（分组树中的查询叶子天然满足） */
export interface SavedQueryDbSource {
  label: string;
  nodeType: string;
  dbConfigId?: null | number | string;
  dbName?: null | string;
  instanceName?: null | string;
  schemaName?: null | string;
  children?: SavedQueryDbSource[];
}

/** 数据库树中的目录节点；查询叶子保持原对象不变，便于复用原有操作按钮 */
export interface SavedQueryDbFolder<T> {
  id: string;
  /** 与 id 相同，仅为了和分组树节点结构保持一致 */
  rawId: string;
  label: string;
  nodeType: SavedQueryDbFolderType;
  /** 该目录下（含所有子目录）的查询数量 */
  count: number;
  children: Array<SavedQueryDbFolder<T> | T>;
}

/** 缺失连接名 / 库名时的占位文案，由调用方传入已翻译的文本 */
export interface SavedQueryDbTreeTexts {
  unknownConnection: string;
  unspecifiedDatabase: string;
}

const DEFAULT_TEXTS: SavedQueryDbTreeTexts = {
  unknownConnection: '未知连接',
  unspecifiedDatabase: '未指定库',
};

/** 名称排序：忽略大小写，数字按数值比较（db2 排在 db10 之前） */
function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** 去掉首尾空白，空串视为未填写 */
function normalizeName(value?: null | string): string {
  return String(value ?? '').trim();
}

/**
 * 从分组树中递归收集全部查询叶子（分组节点本身不收集）。
 *
 * @param nodes 分组树根节点列表
 * @returns 扁平的查询节点列表，保持原对象引用
 */
export function collectSavedQueryLeaves<T extends SavedQueryDbSource>(
  nodes: T[],
): T[] {
  const result: T[] = [];
  const walk = (list: T[]) => {
    for (const node of list) {
      if (node.nodeType === 'query') {
        result.push(node);
      } else if (node.children?.length) {
        walk(node.children as T[]);
      }
    }
  };
  walk(nodes);
  return result;
}

/**
 * 把查询列表组装成「连接 → 数据库 → Schema → 查询」树。
 *
 * <ul>
 *   <li>连接按 dbConfigId 区分，显示连接名（dbName），缺失时显示「连接 #id」</li>
 *   <li>Schema 为空或与库名相同（如 MySQL）时不建 Schema 层，查询直接挂在库下</li>
 *   <li>同一层中目录在前、查询在后，均按名称排序</li>
 * </ul>
 *
 * @param queries 查询叶子列表
 * @param texts 占位文案（可选，默认中文）
 * @returns 数据库树根节点（连接）列表
 */
export function buildSavedQueryDbTree<T extends SavedQueryDbSource>(
  queries: T[],
  texts: Partial<SavedQueryDbTreeTexts> = {},
): SavedQueryDbFolder<T>[] {
  const t = { ...DEFAULT_TEXTS, ...texts };
  const connections = new Map<string, SavedQueryDbFolder<T>>();
  const folders = new Map<string, SavedQueryDbFolder<T>>();

  /** 取已有目录或在父级下新建，保证同 key 只出现一次 */
  const ensureFolder = (
    key: string,
    nodeType: SavedQueryDbFolderType,
    label: string,
    parent: null | SavedQueryDbFolder<T>,
  ): SavedQueryDbFolder<T> => {
    const pool = parent ? folders : connections;
    let folder = pool.get(key);
    if (!folder) {
      folder = { id: key, rawId: key, label, nodeType, count: 0, children: [] };
      pool.set(key, folder);
      parent?.children.push(folder);
    }
    return folder;
  };

  for (const query of queries) {
    const connId = normalizeName(
      query.dbConfigId == null ? '' : String(query.dbConfigId),
    );
    const connName = normalizeName(query.dbName);
    const instance = normalizeName(query.instanceName);
    const schema = normalizeName(query.schemaName);

    // key 中对名称做编码，避免库名含分隔符时与其他节点冲突
    const connKey = `conn:${encodeURIComponent(connId)}`;
    const connLabel =
      connName || (connId ? `#${connId}` : t.unknownConnection);
    const conn = ensureFolder(connKey, 'connection', connLabel, null);

    const dbKey = `${connKey}/db:${encodeURIComponent(instance)}`;
    const db = ensureFolder(
      dbKey,
      'database',
      instance || t.unspecifiedDatabase,
      conn,
    );

    let leafParent = db;
    if (schema && schema !== instance) {
      const schemaKey = `${dbKey}/schema:${encodeURIComponent(schema)}`;
      leafParent = ensureFolder(schemaKey, 'schema', schema, db);
      leafParent.count++;
    }
    leafParent.children.push(query);
    // 只对新增查询途经的目录计数，避免重复累加
    conn.count++;
    db.count++;
  }

  const isFolder = (
    node: SavedQueryDbFolder<T> | T,
  ): node is SavedQueryDbFolder<T> =>
    node.nodeType === 'connection' ||
    node.nodeType === 'database' ||
    node.nodeType === 'schema';

  const sortChildren = (folder: SavedQueryDbFolder<T>) => {
    folder.children.sort((a, b) => {
      const af = isFolder(a);
      const bf = isFolder(b);
      if (af !== bf) return af ? -1 : 1;
      return compareLabel(a.label, b.label);
    });
    for (const child of folder.children) {
      if (isFolder(child)) sortChildren(child);
    }
  };

  const roots = [...connections.values()].sort((a, b) =>
    compareLabel(a.label, b.label),
  );
  roots.forEach(sortChildren);
  return roots;
}
