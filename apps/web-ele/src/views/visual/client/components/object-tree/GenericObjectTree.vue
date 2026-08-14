<script lang="ts" setup>
/**
 * 非 MySQL 库的对象树骨架（PostgreSQL / Oracle / SQL Server）
 * 结构与 MySQL 一致；Views 等若后端暂未实现则展开为空列表。
 * Queries 与 MySQL 相同：按「当前用户 + 连接 + 库」加载已保存 SQL。
 *
 * @author yanch
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
import { listSavedQueries } from '#/api/visual/savedQuery';
import { rememberInstanceTables } from '../../utils/sqlEditorAssist';

import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import ObjectTreeContextMenu, {
  type TreeCtxAction,
} from './ObjectTreeContextMenu.vue';

defineOptions({ name: 'GenericObjectTree' });

const props = defineProps<{
  dbConfigId: number | string;
  filterText?: string;
  dbTypeLabel?: string;
}>();

const emit = defineEmits<{
  openTable: [payload: { instanceName: string; tableName: string; schemaName?: string }];
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
 * 不是数据库 Event Scheduler 对象。
 *
 * @author yanch
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

async function loadFolder(node: any, resolve: (data: any[]) => void) {
  const { objectKind, instanceName } = node.data;
  try {
    let list: any[] = [];
    if (objectKind === 'tables') {
      const res: any = await getTables(props.dbConfigId, instanceName);
      const raw = res?.data || res || [];
      rememberInstanceTables(
        props.dbConfigId,
        instanceName,
        raw.map((t: any) => t.tableName).filter(Boolean),
      );
      list = raw.map((t: any) => ({
        id: `table-${instanceName}-${t.tableName}`,
        label: t.tableName,
        name: t.tableName,
        nodeType: 'table',
        instanceName,
        /** 真实 schema（PG=public；达梦=OWNER）；打开表 SQL 优先用此字段 */
        schemaName: t.schemaName || undefined,
        isLeaf: false,
      }));
    } else if (objectKind === 'queries') {
      // 已保存查询：仅当前登录用户可见（与 MySQL 树一致）
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
      const res: any = api ? await api(props.dbConfigId, instanceName) : { data: [] };
      list = (res?.data || res || []).map((o: any) => ({
        id: `${objectKind}-${instanceName}-${o.objectName}`,
        label: o.objectName,
        name: o.objectName,
        nodeType: objectKind,
        instanceName,
        isLeaf: true,
      }));
    }
    resolve(list);
  } catch {
    resolve([]);
  }
}

async function loadColumns(node: any, resolve: (data: any[]) => void) {
  const { instanceName, name } = node.data;
  try {
    const res: any = await getTableColumns(props.dbConfigId, instanceName, name);
    resolve(
      (res?.data || res || []).map((c: any) => ({
        id: `col-${instanceName}-${name}-${c.fieldName}`,
        label: c.fieldName,
        name: c.fieldName,
        nodeType: 'column',
        isLeaf: true,
      })),
    );
  } catch {
    resolve([]);
  }
}

function loadNode(node: any, resolve: (data: any[]) => void) {
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
  let x = event.clientX;
  let y = event.clientY;
  if (x + 220 > window.innerWidth - 8) x = window.innerWidth - 228;
  if (y + 180 > window.innerHeight - 8) y = window.innerHeight - 188;
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
 *
 * @author yanch
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
  (val) => treeRef.value?.filter(val || ''),
);

watch(
  () => props.dbConfigId,
  () => loadInstances(),
);

onMounted(() => {
  loadInstances();
  document.addEventListener('click', closeCtxMenu);
});
onBeforeUnmount(() => document.removeEventListener('click', closeCtxMenu));
defineExpose({ reload: loadInstances, reloadQueries });
</script>

<template>
  <div v-loading="loading" class="object-tree">
    <div v-if="dbTypeLabel" class="hint">
      {{ dbTypeLabel }} 对象树（部分对象类型以后端能力为准）
    </div>
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
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 4px 8px;
}
</style>
