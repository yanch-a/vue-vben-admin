<script lang="ts" setup>
/**
 * 对象浏览器（SQLyog 风格，全库通用）
 *
 * 树结构：
 * 默认是 MySQL 族树：实例 → Tables/Views/... → 对象。
 * PostgreSqlObjectTree / OracleObjectTree 通过 schemaMode 启用：
 * 实例 → Schema/Owner → Tables/Views/.../Queries → 对象。
 * 表节点可再展开字段。使用 ElTree lazy：每层展开时再请求。
 *
 * 库差异只体现在 dbTypes.ts 的能力开关上（不支持的分类不渲染文件夹），
 * 不再为每种数据库派生组件。新增数据库无需改本文件。
 *
 * 检索按当前选中节点决定范围：选中实例则加载并过滤其下全部分类，
 * 选中 Tables 等目录则只过滤这一类，其它目录保持完整列表。
 * 已经加载过的实例、目录和字段缓存在当前会话；切换桌面端地址或登录用户后失效。
 * 右键刷新、建表、建视图等主动刷新会重新请求并覆盖缓存。
 *
 * @author yanch
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { useUserStore } from '@vben/stores';
import { ElMessage } from 'element-plus';

import { getDesktopServerStorageKey } from '#/desktop/runtime';

import {
  getEvents,
  getFunctions,
  getInstances,
  getProcedures,
  getTableColumns,
  getTableTree,
  getTables,
  getTriggers,
  getViews,
} from '#/api/visual/database';
import { listSavedQueries } from '#/api/visual/savedQuery';

import { instanceLabelOf, resolveCapabilities } from '../../dialect/dbTypes';
import { rememberInstanceTables } from '../../utils/sqlEditorAssist';
import { useClientPreferences } from '../../composables/useClientPreferences';
import {
  bindObjectTreeCacheScope,
  objectTreeCache,
  resolveObjectTreeSessionScope,
} from './objectTreeCache';
import ObjectTreeContextMenu, {
  type TreeCtxAction,
} from './ObjectTreeContextMenu.vue';
import {
  foldersToSearch,
  objectNodeMatchesKeyword,
  resolveObjectSearchScope,
  shouldCollapseTablesOnClick,
  type ObjectSearchScope,
} from './objectTreeSearch';

defineOptions({ name: 'ObjectTree' });

const { preferences } = useClientPreferences();

/**
 * 缓存范围 = 桌面端服务地址 + 登录用户。
 * 地址或用户变了，下一次读取会丢掉旧缓存并重新请求。
 */
bindObjectTreeCacheScope(() => {
  let userKey = '';
  try {
    const info = useUserStore().userInfo as {
      userId?: number | string;
      username?: string;
    } | null;
    userKey = String(info?.userId ?? info?.username ?? '').trim();
  } catch {
    userKey = '';
  }
  return resolveObjectTreeSessionScope(getDesktopServerStorageKey(), userKey);
});

const props = defineProps<{
  dbConfigId: number | string;
  dbType: string;
  filterText?: string;
  /** SQL 编辑器当前选中的库/实例，对象树对应节点后显示绿点 */
  activeInstanceName?: string;
  /** 仅由 PG/Oracle 族包装组件传入；默认不启用，保持 MySQL 树路径独立。 */
  schemaMode?: 'oracle' | 'postgresql';
}>();

const emit = defineEmits<{
  openTable: [
    payload: { instanceName: string; tableName: string; schemaName?: string },
  ];
  insertName: [name: string];
  /** 单击库节点：同步编辑器当前库 */
  selectInstance: [instanceName: string];
  /** 单击 schema/owner：同步编辑器当前命名空间。 */
  selectSchema: [payload: { instanceName: string; schemaName: string }];
  /** 单击表节点：供 F11 打开表 */
  selectTable: [
    payload: { instanceName: string; tableName: string; schemaName?: string },
  ];
  openSavedQuery: [
    payload: {
      id: number | string;
      queryName: string;
      sqlText: string;
      instanceName: string;
      schemaName?: string;
    },
  ];
  contextAction: [
    payload: {
      action: TreeCtxAction;
      node: any;
    },
  ];
}>();

const treeRef = ref();
/** 根节点：数据库/模式列表 */
const treeData = ref<any[]>([]);
const loading = ref(false);
/** 定位高亮的节点 id（主题色背景） */
const locateKey = ref('');
let locateTimer: null | ReturnType<typeof setTimeout> = null;
/** 左侧树当前点中的节点，决定检索只查表还是查整个实例 */
const currentData = ref<any>(null);
/** 同一目录并发请求时，只让最后一次结果写入缓存 */
const folderRequestGen = new Map<string, number>();
const schemaRequestGen = new Map<string, number>();
let searchSeq = 0;
let searchTimer: null | ReturnType<typeof setTimeout> = null;
/** 切换连接后作废进行中的加载，避免旧请求把目录写进当前树 */
let treeEpoch = 0;

const capabilities = computed(() => resolveCapabilities(props.dbType));
/** 右键菜单文案：Oracle/达梦一级节点是「模式」而非「数据库」 */
const instanceLabel = computed(() => instanceLabelOf(props.dbType));

/** schema 分层只由独立的 PG/Oracle 包装组件开启，不根据 dbType 隐式改变 MySQL 树。 */
const hasSchemaLayer = computed(() => !!props.schemaMode);

const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  targetType: '',
  objectKind: '',
  node: null as any,
});

const propsTree = {
  label: 'label',
  children: 'children',
  isLeaf: 'isLeaf',
};

function cacheIdentity() {
  return {
    dbConfigId: props.dbConfigId,
    dbType: props.dbType || '',
    schemaMode: props.schemaMode || '',
  };
}

/**
 * 实例下的对象文件夹，按当前库的能力开关裁剪。
 * Queries 恒定存在：存的是「当前登录用户 + 当前连接 + 当前库」的已保存 SQL。
 */
function folderSpecs() {
  const caps = capabilities.value;
  const specs: Array<{ enabled: boolean; kind: string; label: string }> = [
    { kind: 'tables', label: 'Tables', enabled: true },
    { kind: 'views', label: 'Views', enabled: caps.views },
    { kind: 'procedures', label: 'Procedures', enabled: caps.procedures },
    { kind: 'functions', label: 'Functions', enabled: caps.functions },
    { kind: 'triggers', label: 'Triggers', enabled: caps.triggers },
    { kind: 'events', label: 'Events', enabled: caps.events },
    { kind: 'queries', label: 'Queries', enabled: true },
  ];
  return specs.filter((item) => item.enabled);
}

function buildFolderNodes(
  instanceName: string,
  schemaName?: string,
  prefetched?: Record<string, any[]>,
) {
  return folderSpecs()
    .map((s) => ({
      id: `${s.kind}-${instanceName}${schemaName ? `-${schemaName}` : ''}`,
      label: s.label,
      nodeType: 'folder',
      objectKind: s.kind,
      instanceName,
      schemaName,
      prefetchedNodes: prefetched?.[s.kind],
      isLeaf: false,
    }));
}

/** 把 Schema 预取结果里的表名记给编辑器补全。 */
function rememberSchemaTables(
  dbConfigId: number | string,
  instanceName: string,
  schemaNodes: any[],
) {
  const names = (schemaNodes || []).flatMap((schema) =>
    (schema?.objectNodes?.tables || [])
      .map((table: any) => table?.name)
      .filter(Boolean),
  );
  rememberInstanceTables(dbConfigId, instanceName, names);
}

/**
 * 加载连接下的库/模式列表。
 * force=false 时优先用会话缓存；主动刷新传入 force，清掉该连接的目录缓存后再请求。
 */
async function loadInstances(force = false) {
  const epoch = treeEpoch;
  loading.value = true;
  const identity = cacheIdentity();
  const dbConfigId = props.dbConfigId;
  try {
    if (force) objectTreeCache.invalidateConnection(identity);
    if (!force) {
      const cached = objectTreeCache.readInstances(identity);
      if (cached) {
        if (epoch === treeEpoch) treeData.value = cached;
        return;
      }
    }
    const res: any = await getInstances(dbConfigId);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    const nodes = instances.map((ins: any) => ({
      id: `ins-${ins.instanceName}`,
      label: ins.instanceName,
      nodeType: 'instance',
      instanceName: ins.instanceName,
      isLeaf: false,
    }));
    objectTreeCache.writeInstances(identity, nodes);
    if (epoch !== treeEpoch) return;
    treeData.value = objectTreeCache.readInstances(identity) || nodes;
  } catch (error: any) {
    if (epoch !== treeEpoch) return;
    ElMessage.error(error?.message || '加载实例失败');
    treeData.value = [];
  } finally {
    if (epoch === treeEpoch) loading.value = false;
  }
}

const OBJECT_API: Record<string, (a: any, b: any) => Promise<any>> = {
  views: getViews,
  procedures: getProcedures,
  functions: getFunctions,
  triggers: getTriggers,
  events: getEvents,
};

/**
 * 将后端表元数据转为树节点。
 * qualifiedName 用于权限判断和元数据请求，rawTableName 仅用于展示与 SQL 拆分。
 */
function toTableNode(instanceName: string, table: any) {
  return {
    id: `table-${instanceName}-${table.qualifiedName || table.tableName}`,
    label:
      table.displayName && table.displayName !== (table.rawTableName || table.tableName)
        ? `${table.rawTableName || table.tableName} (${table.displayName})`
        : table.rawTableName || table.tableName,
    name: table.qualifiedName || table.tableName,
    rawTableName: table.rawTableName || table.tableName,
    qualifiedName: table.qualifiedName || table.tableName,
    displayName: table.displayName || '',
    nodeType: 'table',
    instanceName,
    schemaName: table.schemaName || undefined,
    isLeaf: false,
  };
}

/** 将视图/例程/触发器等元数据转为树节点，保留 schema 身份。 */
function toProgramNode(instanceName: string, objectKind: string, object: any) {
  const qualifiedName = object.objectName || '';
  const rawName = object.schemaName && qualifiedName.includes('.')
    ? qualifiedName.slice(qualifiedName.indexOf('.') + 1)
    : qualifiedName;
  return {
    id: `${objectKind}-${instanceName}-${object.schemaName || ''}-${qualifiedName}`,
    label: object.displayName && object.displayName !== qualifiedName
      ? `${rawName} (${object.displayName})`
      : rawName,
    name: qualifiedName,
    rawObjectName: rawName,
    nodeType: objectKind,
    objectKind,
    instanceName,
    schemaName: object.schemaName || undefined,
    isLeaf: true,
  };
}

/** 将已保存查询转为 Queries 叶子节点。 */
function toSavedQueryNode(instanceName: string, query: any) {
  return {
    id: `saved-${query.id}`,
    label: query.queryName,
    name: query.queryName,
    nodeType: 'savedQuery',
    objectKind: 'queries',
    instanceName,
    schemaName: query.schemaName || undefined,
    savedQueryId: query.id,
    sqlText: query.sqlText,
    isLeaf: true,
  };
}

/** 读取可选对象列表；单类对象无权时不影响其它 schema 节点。 */
async function readOptionalList(loader: () => Promise<any>): Promise<any[]> {
  try {
    const res: any = await loader();
    return res?.data || res || [];
  } catch {
    return [];
  }
}

/** 向后台拉取某个库下的 Schema/Owner 以及各分类对象，不写缓存。 */
async function fetchSchemaChildren(instanceName: string, dbConfigId: number | string) {
  const caps = capabilities.value;
  const [schemas, views, procedures, functions, triggers, events, queries] = await Promise.all([
    readOptionalList(() => getTableTree(dbConfigId, instanceName)),
    caps.views ? readOptionalList(() => getViews(dbConfigId, instanceName)) : [],
    caps.procedures ? readOptionalList(() => getProcedures(dbConfigId, instanceName)) : [],
    caps.functions ? readOptionalList(() => getFunctions(dbConfigId, instanceName)) : [],
    caps.triggers ? readOptionalList(() => getTriggers(dbConfigId, instanceName)) : [],
    caps.events ? readOptionalList(() => getEvents(dbConfigId, instanceName)) : [],
    readOptionalList(() => listSavedQueries({ dbConfigId, instanceName })),
  ]);
  const grouped = new Map<string, Record<string, any[]>>();
  const ensureSchema = (schemaName: string) => {
    const key = String(schemaName || '').trim();
    if (!key) return undefined;
    if (!grouped.has(key)) {
      grouped.set(key, {
        tables: [], views: [], procedures: [], functions: [],
        triggers: [], events: [], queries: [],
      });
    }
    return grouped.get(key);
  };
  for (const schema of schemas) {
    const bucket = ensureSchema(schema.schemaName);
    if (bucket) {
      bucket.tables = (schema.tables || []).map((table: any) => toTableNode(instanceName, table));
    }
  }
  const objectLists: Array<[string, any[]]> = [
    ['views', views], ['procedures', procedures], ['functions', functions],
    ['triggers', triggers], ['events', events],
  ];
  for (const [kind, objects] of objectLists) {
    for (const object of objects) {
      const bucket = ensureSchema(object.schemaName);
      if (bucket) bucket[kind]!.push(toProgramNode(instanceName, kind, object));
    }
  }
  // 旧版查询没有 schemaName：PG 归 public，Oracle 归当前可见的第一个 owner。
  const fallbackSchema = props.schemaMode === 'postgresql'
    ? 'public'
    : (grouped.keys().next().value || instanceName);
  for (const query of queries) {
    const schemaName = query.schemaName || fallbackSchema;
    const bucket = ensureSchema(schemaName);
    if (bucket) bucket.queries!.push(toSavedQueryNode(instanceName, { ...query, schemaName }));
  }
  if (grouped.size === 0) ensureSchema(fallbackSchema);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([schemaName, objectNodes]) => ({
      id: `schema-${instanceName}-${schemaName}`,
      label: schemaName,
      name: schemaName,
      nodeType: 'schema',
      instanceName,
      schemaName,
      objectNodes,
      isLeaf: false,
    }));
}

/**
 * 读取 Schema 分层的实例子节点。
 * 已缓存且不是主动刷新时直接返回；force 会重新请求并清掉该库的字段缓存。
 */
async function storeSchemaChildren(instanceName: string, force: boolean) {
  const identity = cacheIdentity();
  const dbConfigId = props.dbConfigId;
  if (!force) {
    const cached = objectTreeCache.readSchemaChildren(identity, instanceName);
    if (cached) {
      rememberSchemaTables(dbConfigId, instanceName, cached);
      return cached;
    }
  }
  const genKey = `${dbConfigId}::${instanceName}`;
  const gen = (schemaRequestGen.get(genKey) || 0) + 1;
  schemaRequestGen.set(genKey, gen);
  const nodes = await fetchSchemaChildren(instanceName, dbConfigId);
  if (schemaRequestGen.get(genKey) !== gen) {
    return objectTreeCache.readSchemaChildren(identity, instanceName) || nodes;
  }
  objectTreeCache.writeSchemaChildren(identity, instanceName, nodes);
  if (force) objectTreeCache.invalidateColumns(identity, instanceName);
  const stored = objectTreeCache.readSchemaChildren(identity, instanceName) || nodes;
  rememberSchemaTables(dbConfigId, instanceName, stored);
  return stored;
}

/**
 * 展开实例时构造第一层对象。
 * PG/瀚高与 Oracle 族先按 schema/owner 分组，避免同名表混在一起；
 * 其他数据库保持原来的实例级 Tables 文件夹。
 */
async function loadInstanceChildren(instanceName: string, resolve: (data: any[]) => void) {
  const epoch = treeEpoch;
  if (!hasSchemaLayer.value) {
    resolve(buildFolderNodes(instanceName));
    return;
  }
  try {
    const nodes = await storeSchemaChildren(instanceName, false);
    if (epoch !== treeEpoch) {
      resolve([]);
      return;
    }
    resolve(nodes);
    const keyword = (props.filterText || '').trim();
    if (keyword) applyTreeVisibility(keyword);
  } catch (error: any) {
    if (epoch !== treeEpoch) {
      resolve([]);
      return;
    }
    ElMessage.error(error?.message || '加载 Schema 失败');
    resolve([]);
  }
}

/** 向后台拉取某一个对象目录，返回完整列表，不在这里做检索过滤。 */
async function fetchFolderChildren(
  objectKind: string,
  instanceName: string,
  dbConfigId: number | string,
) {
  if (objectKind === 'tables') {
    const res: any = await getTables(dbConfigId, instanceName);
    const raw = res?.data || res || [];
    return raw.map((table: any) => toTableNode(instanceName, table));
  }
  if (objectKind === 'queries') {
    const res: any = await listSavedQueries({
      dbConfigId,
      instanceName,
    });
    return (res?.data || res || []).map((query: any) => toSavedQueryNode(instanceName, query));
  }
  const api = OBJECT_API[objectKind];
  if (!api) return [];
  const res: any = await api(dbConfigId, instanceName);
  return (res?.data || res || []).map((object: any) => toProgramNode(instanceName, objectKind, object));
}

/**
 * 读取目录子节点。force 表示建表、建视图或右键刷新，必须请求后台并覆盖缓存。
 * 普通展开只在没有缓存时请求。检索不裁剪这份列表，过滤只影响显示。
 */
async function loadFolderNodes(
  folderId: string,
  objectKind: string,
  instanceName: string,
  force: boolean,
) {
  const identity = cacheIdentity();
  const dbConfigId = props.dbConfigId;
  if (!force) {
    const cached = objectTreeCache.readFolder(identity, folderId);
    if (cached) {
      if (objectKind === 'tables') {
        rememberInstanceTables(
          dbConfigId,
          instanceName,
          cached.map((node: any) => node.name).filter(Boolean),
        );
      }
      return cached;
    }
  }
  const genKey = `${dbConfigId}::${folderId}`;
  const gen = (folderRequestGen.get(genKey) || 0) + 1;
  folderRequestGen.set(genKey, gen);
  const list = await fetchFolderChildren(objectKind, instanceName, dbConfigId);
  if (folderRequestGen.get(genKey) !== gen) {
    return objectTreeCache.readFolder(identity, folderId) || list;
  }
  objectTreeCache.writeFolder(identity, folderId, list);
  if (objectKind === 'tables') {
    rememberInstanceTables(
      dbConfigId,
      instanceName,
      list.map((node: any) => node.name).filter(Boolean),
    );
    if (force) objectTreeCache.invalidateColumns(identity, instanceName);
  }
  return objectTreeCache.readFolder(identity, folderId) || list;
}

/** 展开「Tables/Views/...」文件夹时拉取对应对象列表 */
async function loadFolder(node: any, resolve: (data: any[]) => void) {
  const epoch = treeEpoch;
  const { objectKind, instanceName, prefetchedNodes, id } = node.data;
  try {
    if (Array.isArray(prefetchedNodes)) {
      // schema 下各分类已在实例展开时并行预取，避免重复扫描数据库目录。
      resolve(prefetchedNodes);
      const keyword = (props.filterText || '').trim();
      if (keyword) applyTreeVisibility(keyword);
      return;
    }
    const list = await loadFolderNodes(String(id), objectKind, instanceName, false);
    if (epoch !== treeEpoch) {
      resolve([]);
      return;
    }
    resolve(list);
    const keyword = (props.filterText || '').trim();
    if (keyword) applyTreeVisibility(keyword);
  } catch (error: any) {
    if (epoch !== treeEpoch) {
      resolve([]);
      return;
    }
    ElMessage.error(error?.message || '加载失败');
    resolve([]);
  }
}

/** 展开表节点时加载字段；改表后的主动刷新会先清掉这里的缓存。 */
async function loadColumns(node: any, resolve: (data: any[]) => void) {
  const epoch = treeEpoch;
  const { instanceName, name, schemaName, id } = node.data;
  const cacheKey = String(id || '');
  const identity = cacheIdentity();
  const dbConfigId = props.dbConfigId;
  const cached = objectTreeCache.readColumns(identity, cacheKey);
  if (cached) {
    resolve(cached);
    const keyword = (props.filterText || '').trim();
    if (keyword) applyTreeVisibility(keyword);
    return;
  }
  try {
    const res: any = await getTableColumns(dbConfigId, instanceName, name);
    if (epoch !== treeEpoch) {
      resolve([]);
      return;
    }
    const list = (res?.data || res || []).map((column: any) => ({
      id: `col-${instanceName}-${name}-${column.fieldName}`,
      label: `${column.fieldName}${column.dataType ? ` : ${column.dataType}` : ''}`,
      name: column.fieldName,
      nodeType: 'column',
      instanceName,
      schemaName: schemaName || undefined,
      tableName: name,
      isLeaf: true,
    }));
    objectTreeCache.writeColumns(identity, cacheKey, list);
    resolve(objectTreeCache.readColumns(identity, cacheKey) || list);
    const keyword = (props.filterText || '').trim();
    if (keyword) applyTreeVisibility(keyword);
  } catch {
    resolve([]);
  }
}

/**
 * ElTree lazy 回调：
 * - 展开库 → schema/owner 节点或对象文件夹
 * - 展开 schema/owner → Tables 文件夹
 * - 展开文件夹 → 请求远端对象
 * - 展开表 → 请求字段
 * 注意：lazy 首次展开一定会调 load，切勿 resolve([]) 覆盖子节点。
 */
function loadNode(node: any, resolve: (data: any[]) => void) {
  // 虚拟根（极少走到）；根数据已由 treeData 提供
  if (node.level === 0) {
    resolve(treeData.value);
    return;
  }
  const data = node.data;
  if (!data) {
    resolve([]);
    return;
  }
  if (data.nodeType === 'instance') {
    loadInstanceChildren(data.instanceName, resolve);
    return;
  }
  if (data.nodeType === 'folder') {
    loadFolder(node, resolve);
    return;
  }
  if (data.nodeType === 'schema') {
    resolve(buildFolderNodes(data.instanceName, data.schemaName, data.objectNodes || {}));
    return;
  }
  if (data.nodeType === 'table') {
    loadColumns(node, resolve);
    return;
  }
  resolve([]);
}

/** 双击表：生成 SELECT；双击已保存查询：打开编辑器；可编程对象：改变（拉定义）；其它：插入名称 */
function onNodeDblClick(data: any) {
  if (data.nodeType === 'table') {
    emit('openTable', {
      instanceName: data.instanceName,
      tableName: data.name,
      schemaName: data.schemaName,
    });
    return;
  }
  if (data.nodeType === 'savedQuery') {
    emit('openSavedQuery', {
      id: data.savedQueryId,
      queryName: data.name || data.label,
      sqlText: data.sqlText || '',
      instanceName: data.instanceName,
      schemaName: data.schemaName,
    });
    return;
  }
  if (
    data.nodeType === 'views' ||
    data.nodeType === 'procedures' ||
    data.nodeType === 'functions' ||
    data.nodeType === 'triggers' ||
    data.nodeType === 'events'
  ) {
    emit('contextAction', {
      action: 'alterProgramObject',
      node: { ...data },
    });
    return;
  }
  if (data.name) {
    emit('insertName', data.name);
  }
}

/** 单击：实例/文件夹点行切换展开；表节点不展开列（仅箭头展开），并作为下一次检索范围 */
function onNodeClick(data: any, node: any) {
  currentData.value = data;
  // 点击只切换当前节点。检索不能改去展开别的实例或 Tables。
  if (
    (data?.nodeType === 'instance' || data?.nodeType === 'folder' || data?.nodeType === 'schema') &&
    node
  ) {
    if (node.expanded) {
      node.collapse?.();
    } else {
      node.expand?.();
    }
  }
  if (data?.nodeType === 'instance' && data.instanceName) {
    emit('selectInstance', data.instanceName);
  }
  if (data?.nodeType === 'schema' && data.instanceName && data.schemaName) {
    emit('selectSchema', {
      instanceName: data.instanceName,
      schemaName: data.schemaName,
    });
  }
  if (data?.nodeType === 'table' && data.name) {
    emit('selectTable', {
      instanceName: data.instanceName,
      tableName: data.name,
      schemaName: data.schemaName,
    });
  }
  const keyword = (props.filterText || '').trim();
  // 检索时点 Views 等非 Tables 节点，收起已展开的 Tables，避免整表列表把检索结果顶下去。
  // 表数据仍留在节点里，下次点开 Tables 还会按当前关键字过滤。
  if (keyword && shouldCollapseTablesOnClick(data)) {
    collapseExpandedTables();
  }
  if (keyword) applyTreeVisibility(keyword);
}

/** 收起当前树上所有已展开的 Tables 目录（含其它实例 / Schema） */
function collapseExpandedTables() {
  const nodesMap = treeRef.value?.store?.nodesMap || {};
  for (const node of Object.values(nodesMap) as any[]) {
    const data = node?.data;
    if (data?.nodeType !== 'folder' || data?.objectKind !== 'tables') continue;
    if (!node.expanded) continue;
    node.collapse?.();
  }
}

/** 右键：库 / Tables / 表 / 已保存查询 / 可编程对象；一律拦住浏览器菜单 */
function onNodeContextMenu(event: MouseEvent, data: any) {
  event.preventDefault();
  event.stopPropagation();
  if (data?.nodeType && data.nodeType !== 'blank') {
    currentData.value = data;
  }
  openCtxMenu(event, data, data?.nodeType || 'folder');
}

/** 点在树下方空白：创建数据库 / 刷新（点在节点上则交给 onNodeContextMenu） */
function onBlankContextMenu(event: MouseEvent) {
  const el = event.target as HTMLElement | null;
  if (el?.closest('.el-tree-node')) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  openCtxMenu(event, { nodeType: 'blank' }, 'blank');
}

function openCtxMenu(event: MouseEvent, data: any, targetType: string) {
  const pad = 8;
  const menuW = 220;
  const menuH = 240;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.targetType = targetType;
  ctxMenu.objectKind = data?.objectKind || data?.nodeType || '';
  ctxMenu.node = data;
  ctxMenu.visible = true;
}

function closeCtxMenu() {
  ctxMenu.visible = false;
  ctxMenu.node = null;
}

/** 点击菜单外区域关闭（capture 阶段，避免 ElTree 吞掉 click） */
function onDocMouseDown(e: MouseEvent) {
  if (!ctxMenu.visible) return;
  if (e.button === 2) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('.obj-ctx-menu')) return;
  closeCtxMenu();
}

function onCtxAction(action: TreeCtxAction) {
  emit('contextAction', {
    action,
    node: ctxMenu.node ? { ...ctxMenu.node } : { nodeType: 'blank' },
  });
}

/**
 * 直接改节点可见性。
 * 不用 ElTree.filter()：它会把所有可见目录自动展开，导致点 Views 时把 Tables 展开。
 */
function applyTreeVisibility(keyword: string) {
  const root = treeRef.value?.store?.root;
  if (!root) return;
  const scope = String(keyword || '').trim()
    ? resolveObjectSearchScope(currentData.value, props.activeInstanceName)
    : null;
  const walk = (node: any) => {
    const children = node?.childNodes || [];
    for (const child of children) {
      if (child?.data) {
        child.visible = objectNodeMatchesKeyword(child.data, keyword, scope);
      }
      walk(child);
      if (child?.childNodes?.length && child.childNodes.some((item: any) => item.visible)) {
        child.visible = true;
      }
    }
  };
  walk(root);
}

/** 勾选「隐藏表备注」后，表节点只显示物理表名 */
function formatNodeLabel(data: any, node: any) {
  if (data?.nodeType === 'table' && preferences.hideTableComments) {
    return data.rawTableName || data.name || node.label;
  }
  return node.label;
}

/** ElTree getNode 区分大小写；H2 的 public/PUBLIC 可能与节点 id 不一致 */
function findTreeNode(tree: any, id: string) {
  if (!tree || !id) return null;
  const exact = tree.getNode(id);
  if (exact) return exact;
  const nodesMap = tree.store?.nodesMap || {};
  const want = String(id).toLowerCase();
  for (const key of Object.keys(nodesMap)) {
    if (key.toLowerCase() === want) {
      return nodesMap[key];
    }
  }
  return null;
}

/**
 * 主动刷新某个目录：重新请求并覆盖会话缓存，再让树上已展开的节点显示新数据。
 * Schema 分层的对象是随实例一起预取的，所以刷新任意一类都会更新该实例的整份缓存。
 */
async function reloadFolder(
  objectKind: string,
  instanceName: string,
  refreshSearch = true,
): Promise<boolean> {
  if (!instanceName) return false;
  try {
    if (hasSchemaLayer.value) {
      await reloadSchemaInstance(instanceName);
      if (refreshSearch) await applyObjectSearch();
      else refilterTree();
      return true;
    }
    const folderId = `${objectKind}-${instanceName}`;
    await loadFolderNodes(folderId, objectKind, instanceName, true);
    const node = findTreeNode(treeRef.value, folderId);
    if (node) {
      node.loaded = false;
      if (node.expanded) node.collapse?.();
      await waitExpand(node);
    }
    if (refreshSearch) await applyObjectSearch();
    else refilterTree();
    return true;
  } catch (error: any) {
    ElMessage.error(error?.message || '刷新失败');
    return false;
  }
}

/** 主动刷新 Schema 分层实例，并覆盖该实例的目录缓存。 */
async function reloadSchemaInstance(instanceName: string) {
  await storeSchemaChildren(instanceName, true);
  const ins = findTreeNode(treeRef.value, `ins-${instanceName}`);
  if (!ins) return;
  ins.loaded = false;
  if (ins.expanded) ins.collapse?.();
  await waitExpand(ins);
}

/**
 * 右键刷新当前数据库/模式：重新拉实例列表，并重载该实例下的对象目录。
 */
async function reloadInstance(instanceName: string) {
  const keep = String(instanceName || '').trim();
  await loadInstances(true);
  await nextTick();
  if (!keep) return;
  const insNode = findTreeNode(treeRef.value, `ins-${keep}`);
  if (!insNode) return;
  if (hasSchemaLayer.value) {
    await reloadSchemaInstance(keep);
    await applyObjectSearch();
    return;
  }
  insNode.loaded = false;
  if (insNode.expanded) insNode.collapse?.();
  await waitExpand(insNode);
  for (const spec of folderSpecs()) {
    await reloadFolder(spec.kind, keep, false);
  }
  await applyObjectSearch();
}

/** 刷新某库下 Queries 文件夹（保存/删除后由父级调用），并覆盖本地缓存 */
function reloadQueries(instanceName: string) {
  return reloadFolder('queries', instanceName);
}

/** 刷新某库下 Tables 文件夹（建表/删表后由父级调用），并覆盖本地缓存 */
function reloadTables(instanceName: string) {
  return reloadFolder('tables', instanceName);
}

function clearLocateHighlight() {
  locateKey.value = '';
  if (locateTimer) {
    clearTimeout(locateTimer);
    locateTimer = null;
  }
}

function applyLocateHighlight(key: string) {
  locateKey.value = String(key);
  treeRef.value?.setCurrentKey?.(key);
  if (locateTimer) clearTimeout(locateTimer);
  locateTimer = setTimeout(() => {
    locateKey.value = '';
    locateTimer = null;
  }, 4500);
  nextTick(() => {
    const root = treeRef.value?.$el as HTMLElement | undefined;
    const el = root?.querySelector?.('.is-locate-target') as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  });
}

/** 展开节点并等待 lazy 子节点加载完成。节点正在加载时先等它结束，避免重复请求。 */
function waitExpand(node: any): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const expandNow = () => {
      if (!node || (node.expanded && node.loaded && !node.loading)) {
        finish();
        return;
      }
      try {
        node.expand(() => finish());
      } catch {
        finish();
      }
    };
    if (!node) {
      finish();
      return;
    }
    if (node.loading) {
      const started = Date.now();
      const timer = setInterval(() => {
        if (node.loading && Date.now() - started < 30_000) return;
        clearInterval(timer);
        expandNow();
      }, 40);
      return;
    }
    expandNow();
  });
}

/**
 * 在对象树中定位：
 * - 有 savedQueryId：展开实例 → Queries，高亮对应已保存查询
 * - 无 savedQueryId：高亮当前数据库实例节点
 */
async function locateTarget(opts: {
  instanceName?: string;
  schemaName?: string;
  savedQueryId?: number | string;
}) {
  const tree = treeRef.value;
  const instanceName = (opts.instanceName || '').trim();
  if (!tree) return;
  if (!instanceName) {
    ElMessage.warning('当前编辑器未选择数据库实例');
    return;
  }
  if (!treeData.value.length) {
    await loadInstances(false);
    await nextTick();
  }
  const hasQuery = opts.savedQueryId != null && opts.savedQueryId !== '';
  // 定位已保存查询前先刷新 Queries，并把新列表写回会话缓存
  if (hasQuery) {
    await reloadFolder('queries', instanceName, false);
  }
  const insKey = `ins-${instanceName}`;
  const insNode = findTreeNode(treeRef.value, insKey);
  if (!insNode) {
    ElMessage.warning(`左侧未找到${instanceLabel.value}：${instanceName}`);
    return;
  }

  await waitExpand(insNode);

  if (!hasQuery) {
    applyLocateHighlight(insKey);
    refilterTree();
    return;
  }

  let folderKey = `queries-${instanceName}`;
  if (hasSchemaLayer.value) {
    const schemaName = (opts.schemaName || '').trim();
    let schemaNode = schemaName
      ? findTreeNode(tree, `schema-${instanceName}-${schemaName}`)
      : null;
    if (!schemaNode && opts.savedQueryId != null) {
      // 兼容旧保存查询：没有 schemaName 时依次展开 schema 定位。
      const instanceChildren = insNode.childNodes || [];
      for (const candidate of instanceChildren) {
        await waitExpand(candidate);
        const queryFolder = (candidate.childNodes || []).find(
          (child: any) => child.data?.objectKind === 'queries',
        );
        if (!queryFolder) continue;
        await waitExpand(queryFolder);
        if (findTreeNode(tree, `saved-${opts.savedQueryId}`)) {
          schemaNode = candidate;
          break;
        }
      }
    }
    if (!schemaNode) {
      ElMessage.warning('未找到查询所属 Schema');
      applyLocateHighlight(insKey);
      return;
    }
    await waitExpand(schemaNode);
    folderKey = `queries-${instanceName}-${schemaNode.data.schemaName}`;
  }
  const folderNode = findTreeNode(treeRef.value, folderKey);
  if (!folderNode) {
    ElMessage.warning('未找到 Queries 目录');
    applyLocateHighlight(insKey);
    return;
  }
  if (!folderNode.loaded || !folderNode.expanded) {
    await waitExpand(folderNode);
  }

  const queryKey = `saved-${opts.savedQueryId}`;
  const queryNode = findTreeNode(treeRef.value, queryKey);
  if (!queryNode) {
    ElMessage.warning('Queries 中未找到该已保存查询');
    applyLocateHighlight(folderKey);
    return;
  }
  applyLocateHighlight(queryKey);
  refilterTree();
}

/** 按当前关键字重新计算可见性，不展开目录。 */
function refilterTree() {
  applyTreeVisibility((props.filterText || '').trim());
}

/**
 * 检索前把范围内的目录展开并加载。
 * 选中实例时加载其下全部分类；选中 Tables 时只加载表。
 * 列表始终是完整数据，过滤只隐藏不匹配的节点，换范围后可以还原。
 */
async function ensureSearchScopeLoaded(scope: ObjectSearchScope) {
  const tree = treeRef.value;
  if (!tree) return;
  const instanceNode = findTreeNode(tree, `ins-${scope.instanceName}`);
  if (!instanceNode) return;
  await waitExpand(instanceNode);
  await nextTick();
  if (!hasSchemaLayer.value) {
    const available = (instanceNode.childNodes || [])
      .map((node: any) => node.data?.objectKind)
      .filter(Boolean);
    const kinds = foldersToSearch(scope, available);
    await Promise.all(
      kinds.map((kind) => waitExpand(findTreeNode(tree, `${kind}-${scope.instanceName}`))),
    );
    return;
  }
  const schemaName = scope.type === 'instance' ? '' : scope.schemaName || '';
  const schemaNodes = schemaName
    ? [findTreeNode(tree, `schema-${scope.instanceName}-${schemaName}`)].filter(Boolean)
    : [...(instanceNode.childNodes || [])];
  for (const schemaNode of schemaNodes) {
    await waitExpand(schemaNode);
    await nextTick();
    const available = (schemaNode.childNodes || [])
      .map((node: any) => node.data?.objectKind)
      .filter(Boolean);
    const kinds = foldersToSearch(scope, available);
    await Promise.all(
      kinds.map((kind) => {
        const folder = (schemaNode.childNodes || []).find(
          (node: any) => node.data?.objectKind === kind,
        );
        return waitExpand(folder);
      }),
    );
  }
}

/** 按当前选中节点加载检索范围，再交给 ElTree 只隐藏范围内不匹配的节点。 */
async function applyObjectSearch() {
  const seq = ++searchSeq;
  const keyword = (props.filterText || '').trim();
  const scope = keyword
    ? resolveObjectSearchScope(currentData.value, props.activeInstanceName)
    : null;
  if (keyword && scope) {
    await ensureSearchScopeLoaded(scope);
  }
  if (seq !== searchSeq) return;
  await nextTick();
  applyTreeVisibility(keyword);
}

/** 输入中的检索稍等一拍，避免每个字符都去展开目录；清空和切换选中项立即生效。 */
function scheduleObjectSearch(immediate = false) {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  const keyword = (props.filterText || '').trim();
  if (immediate || !keyword) {
    void applyObjectSearch();
    return;
  }
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void applyObjectSearch();
  }, 200);
}

/** 工具栏和空白处右键「刷新」：重新拉取实例列表，并清掉该连接已缓存的目录。 */
async function reload() {
  await loadInstances(true);
  await applyObjectSearch();
}

watch(
  () => props.filterText,
  () => scheduleObjectSearch(false),
);

watch(
  () => props.activeInstanceName,
  () => {
    // 用户已经在树上点过节点时，检索范围以树选中项为准
    if (currentData.value) return;
    if ((props.filterText || '').trim()) scheduleObjectSearch(true);
  },
);

watch(
  () => [props.dbConfigId, props.dbType],
  () => {
    treeEpoch += 1;
    clearLocateHighlight();
    currentData.value = null;
    void loadInstances(false).then(() => applyObjectSearch());
  },
);

onMounted(() => {
  void loadInstances(false).then(() => applyObjectSearch());
  document.addEventListener('mousedown', onDocMouseDown, true);
});

onBeforeUnmount(() => {
  clearLocateHighlight();
  if (searchTimer) clearTimeout(searchTimer);
  document.removeEventListener('mousedown', onDocMouseDown, true);
});

defineExpose({
  reload,
  reloadInstance,
  reloadQueries,
  reloadTables,
  reloadFolder,
  locateTarget,
  closeContextMenu: closeCtxMenu,
  openBlankContextMenu: onBlankContextMenu,
});
</script>

<template>
  <div
    v-loading="loading"
    class="object-tree"
    @contextmenu="onBlankContextMenu"
  >
    <ElTree
      ref="treeRef"
      :data="treeData"
      :props="propsTree"
      node-key="id"
      lazy
      :load="loadNode"
      highlight-current
      :expand-on-click-node="false"
      @node-click="(data: any, node: any) => onNodeClick(data, node)"
      @node-contextmenu="(e: MouseEvent, data: any) => onNodeContextMenu(e, data)"
    >
      <!-- ElTree 无 node-dblclick，需在节点内容上自行绑定 -->
      <template #default="{ node, data }">
        <span
          class="tree-node-label"
          :class="{
            'is-locate-target':
              !!locateKey && String(data.id) === String(locateKey),
          }"
          @dblclick.stop="onNodeDblClick(data)"
        >
          <span class="tree-node-text">{{ formatNodeLabel(data, node) }}</span>
          <span
            v-if="
              data?.nodeType === 'instance' &&
              props.activeInstanceName &&
              data.instanceName === props.activeInstanceName
            "
            class="instance-active-dot"
            :title="$tr('当前 SQL 编辑器选中的库实例')"
          />
        </span>
      </template>
    </ElTree>
    <ObjectTreeContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :target-type="ctxMenu.targetType"
      :object-kind="ctxMenu.objectKind"
      :instance-label="instanceLabel"
      :can-manage-instance="capabilities.manageInstance"
      @close="closeCtxMenu"
      @action="onCtxAction"
    />
  </div>
</template>

<style scoped>
.object-tree {
  flex: 1;
  min-height: 0;
  padding: 4px;
  overflow: auto;
}
.tree-node-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tree-node-text {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.instance-active-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-success) 28%, transparent);
}
.tree-node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--vc-ui-font-size, 13px);
  user-select: none;
}
/* 定位高亮：跟随 Element Plus 主题色（亮/暗模式均可用） */
.tree-node-label.is-locate-target {
  padding: 0 6px;
  border-radius: 4px;
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-8);
  box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
  animation: locate-pulse 1s ease-in-out 2;
}
@keyframes locate-pulse {
  0%,
  100% {
    background-color: var(--el-color-primary-light-8);
  }
  50% {
    background-color: var(--el-color-primary-light-7);
  }
}
</style>
