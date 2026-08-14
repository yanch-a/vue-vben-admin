<script lang="ts" setup>
/**
 * MySQL 对象浏览器（SQLyog 风格）
 * 树结构：库 → Tables/Views/Procedures/Functions/Triggers/Events → 叶子（表可再展开字段）
 * 使用 ElTree lazy：每一层展开时再请求，避免「预置 children + lazy」互相覆盖。
 */
import {
  getEvents,
  getFunctions,
  getInstances,
  getProcedures,
  getTableColumns,
  getTables,
  getTriggers,
  getViews,
} from '#/api/visual/database';
import { listSavedQueries } from '#/api/visual/savedQuery'
import { rememberInstanceTables } from '../../utils/sqlEditorAssist';

import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import ObjectTreeContextMenu, {
  type TreeCtxAction,
} from './ObjectTreeContextMenu.vue';

defineOptions({ name: 'MysqlObjectTree' });

const props = defineProps<{
  dbConfigId: number | string;
  filterText?: string;
}>();

const emit = defineEmits<{
  openTable: [payload: { instanceName: string; tableName: string }];
  insertName: [name: string];
  /** 单击库节点：同步编辑器当前库 */
  selectInstance: [instanceName: string];
  openSavedQuery: [
    payload: {
      id: number | string;
      queryName: string;
      sqlText: string;
      instanceName: string;
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
/** 根节点：数据库实例列表 */
const treeData = ref<any[]>([]);
const loading = ref(false);

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

/**
 * 库下对象文件夹。
 * Queries 挂在 Events 之后：存的是「当前登录用户 + 当前连接 + 当前库」的已保存 SQL，
 * 不是 MySQL Event Scheduler 对象。
 */
function buildFolderNodes(instanceName: string) {
  return [
    {
      id: `tables-${instanceName}`,
      label: 'Tables',
      nodeType: 'folder',
      objectKind: 'tables',
      instanceName,
      isLeaf: false,
    },
    {
      id: `views-${instanceName}`,
      label: 'Views',
      nodeType: 'folder',
      objectKind: 'views',
      instanceName,
      isLeaf: false,
    },
    {
      id: `procs-${instanceName}`,
      label: 'Procedures',
      nodeType: 'folder',
      objectKind: 'procedures',
      instanceName,
      isLeaf: false,
    },
    {
      id: `funcs-${instanceName}`,
      label: 'Functions',
      nodeType: 'folder',
      objectKind: 'functions',
      instanceName,
      isLeaf: false,
    },
    {
      id: `trigs-${instanceName}`,
      label: 'Triggers',
      nodeType: 'folder',
      objectKind: 'triggers',
      instanceName,
      isLeaf: false,
    },
    {
      id: `events-${instanceName}`,
      label: 'Events',
      nodeType: 'folder',
      objectKind: 'events',
      instanceName,
      isLeaf: false,
    },
    {
      id: `queries-${instanceName}`,
      label: 'Queries',
      nodeType: 'folder',
      objectKind: 'queries',
      instanceName,
      isLeaf: false,
    },
  ];
}

function matchFilter(label: string) {
  const q = (props.filterText || '').trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

/** 加载连接下的数据库（实例）列表；不预置 children，交给 lazy */
async function loadInstances() {
  loading.value = true;
  try {
    const res: any = await getInstances(props.dbConfigId);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    treeData.value = instances.map((ins: any) => ({
      id: `ins-${ins.instanceName}`,
      label: ins.instanceName,
      nodeType: 'instance',
      instanceName: ins.instanceName,
      isLeaf: false,
    }));
  } catch (e: any) {
    ElMessage.error(e?.message || '加载实例失败');
  } finally {
    loading.value = false;
  }
}

/** 展开「Tables/Views/...」文件夹时拉取对应对象列表 */
async function loadFolder(node: any, resolve: (data: any[]) => void) {
  const { objectKind, instanceName } = node.data;
  try {
    let list: any[] = [];
    if (objectKind === 'tables') {
      const res: any = await getTables(props.dbConfigId, instanceName);
      const raw = res?.data || res || [];
      // 写入客户端表清单，供 SQL 编辑器表名补全
      rememberInstanceTables(
        props.dbConfigId,
        instanceName,
        raw.map((t: any) => t.tableName).filter(Boolean),
      );
      list = raw.map((t: any) => ({
        id: `table-${instanceName}-${t.tableName}`,
        label:
          t.displayName && t.displayName !== t.tableName
            ? `${t.tableName} (${t.displayName})`
            : t.tableName,
        name: t.tableName,
        nodeType: 'table',
        instanceName,
        isLeaf: false,
      }));
    } else if (objectKind === 'queries') {
      // 已保存查询：仅当前登录用户可见
      const res: any = await listSavedQueries({
        dbConfigId: props.dbConfigId,
        instanceName,
      });
      list = (res?.data || res || []).map((q: any) => ({
        id: `saved-${q.id}`,
        label: q.queryName,
        name: q.queryName,
        nodeType: 'savedQuery',
        objectKind: 'queries',
        instanceName,
        savedQueryId: q.id,
        sqlText: q.sqlText,
        isLeaf: true,
      }));
    } else {
      const apiMap: Record<string, (a: any, b: any) => Promise<any>> = {
        views: getViews,
        procedures: getProcedures,
        functions: getFunctions,
        triggers: getTriggers,
        events: getEvents,
      };
      const api = apiMap[objectKind];
      if (!api) {
        resolve([]);
        return;
      }
      const res: any = await api(props.dbConfigId, instanceName);
      list = (res?.data || res || []).map((o: any) => ({
        id: `${objectKind}-${instanceName}-${o.objectName}`,
        label: o.objectName,
        name: o.objectName,
        nodeType: objectKind,
        instanceName,
        isLeaf: true,
      }));
    }
    if (props.filterText) {
      list = list.filter((n) => matchFilter(n.name || n.label));
    }
    resolve(list);
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
    resolve([]);
  }
}

/** 展开表节点时加载字段 */
async function loadColumns(node: any, resolve: (data: any[]) => void) {
  const { instanceName, name } = node.data;
  try {
    const res: any = await getTableColumns(props.dbConfigId, instanceName, name);
    const cols = (res?.data || res || []).map((c: any) => ({
      id: `col-${instanceName}-${name}-${c.fieldName}`,
      label: `${c.fieldName}${c.dataType ? ' : ' + c.dataType : ''}`,
      name: c.fieldName,
      nodeType: 'column',
      instanceName,
      tableName: name,
      isLeaf: true,
    }));
    resolve(cols);
  } catch {
    resolve([]);
  }
}

/**
 * ElTree lazy 回调：
 * - 展开库 → 返回六类文件夹
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
    resolve(buildFolderNodes(data.instanceName));
    return;
  }
  if (data.nodeType === 'folder') {
    loadFolder(node, resolve);
    return;
  }
  if (data.nodeType === 'table') {
    loadColumns(node, resolve);
    return;
  }
  resolve([]);
}

/** 双击表：生成 SELECT；双击已保存查询：打开编辑器；其它：插入名称 */
function onNodeDblClick(data: any) {
  if (data.nodeType === 'table') {
    emit('openTable', { instanceName: data.instanceName, tableName: data.name });
    return;
  }
  if (data.nodeType === 'savedQuery') {
    emit('openSavedQuery', {
      id: data.savedQueryId,
      queryName: data.name || data.label,
      sqlText: data.sqlText || '',
      instanceName: data.instanceName,
    });
    return;
  }
  if (data.name) {
    emit('insertName', data.name);
  }
}

/** 单击：选中库时同步编辑器当前库 */
function onNodeClick(data: any) {
  if (data?.nodeType === 'instance' && data.instanceName) {
    emit('selectInstance', data.instanceName);
  }
}

/** 右键：库 / Tables / 表 / 已保存查询 */
function onNodeContextMenu(event: MouseEvent, data: any) {
  const allow =
    data.nodeType === 'instance' ||
    data.nodeType === 'table' ||
    data.nodeType === 'savedQuery' ||
    (data.nodeType === 'folder' && data.objectKind === 'tables');
  if (!allow) return;
  event.preventDefault();
  event.stopPropagation();
  const pad = 8;
  const menuW = 220;
  const menuH = 180;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.targetType = data.nodeType;
  ctxMenu.objectKind = data.objectKind || '';
  ctxMenu.node = data;
  ctxMenu.visible = true;
}

function closeCtxMenu() {
  ctxMenu.visible = false;
  ctxMenu.node = null;
}

function onCtxAction(action: TreeCtxAction) {
  if (!ctxMenu.node) return;
  emit('contextAction', { action, node: { ...ctxMenu.node } });
}

function filterNode(value: string, data: any) {
  if (!value) return true;
  return (data.label || '').toLowerCase().includes(value.toLowerCase());
}

/**
 * 刷新某库下 Queries 文件夹（保存/删除后调用）
 * ElTree lazy：清掉子节点缓存后重新展开。
 */
function reloadQueries(instanceName: string) {
  const tree = treeRef.value;
  if (!tree || !instanceName) return;
  const node = tree.getNode(`queries-${instanceName}`);
  if (!node) return;
  node.loaded = false;
  node.expand();
}

watch(
  () => props.filterText,
  (val) => {
    treeRef.value?.filter(val || '');
  },
);

watch(
  () => props.dbConfigId,
  () => loadInstances(),
);

onMounted(() => {
  loadInstances();
  document.addEventListener('click', closeCtxMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeCtxMenu);
});

defineExpose({ reload: loadInstances, reloadQueries });
</script>

<template>
  <div v-loading="loading" class="object-tree">
    <ElTree
      ref="treeRef"
      :data="treeData"
      :props="propsTree"
      node-key="id"
      lazy
      :load="loadNode"
      highlight-current
      :expand-on-click-node="false"
      :filter-node-method="filterNode"
      @node-click="(_: any, node: any) => onNodeClick(node.data)"
      @node-dblclick="(_: any, node: any) => onNodeDblClick(node.data)"
      @node-contextmenu="(e: MouseEvent, data: any) => onNodeContextMenu(e, data)"
    />
    <ObjectTreeContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :target-type="ctxMenu.targetType"
      :object-kind="ctxMenu.objectKind"
      @close="closeCtxMenu"
      @action="onCtxAction"
    />
  </div>
</template>

<style scoped>
.object-tree {
  height: 100%;
  overflow: auto;
  padding: 4px;
}
</style>
