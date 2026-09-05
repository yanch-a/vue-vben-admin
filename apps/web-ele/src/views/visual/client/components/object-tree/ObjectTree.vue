<script lang="ts" setup>
/**
 * 对象浏览器（SQLyog 风格，全库通用）
 *
 * 树结构：实例(库/模式) → Tables/Views/Procedures/Functions/Triggers/Events/Queries → 叶子
 * 表节点可再展开字段。使用 ElTree lazy：每层展开时再请求。
 *
 * 库差异只体现在 dbTypes.ts 的能力开关上（不支持的分类不渲染文件夹），
 * 不再为每种数据库派生组件。新增数据库无需改本文件。
 *
 * @author yanch
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

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

import { instanceLabelOf, resolveCapabilities } from '../../dialect/dbTypes';
import { rememberInstanceTables } from '../../utils/sqlEditorAssist';
import ObjectTreeContextMenu, {
  type TreeCtxAction,
} from './ObjectTreeContextMenu.vue';

defineOptions({ name: 'ObjectTree' });

const props = defineProps<{
  dbConfigId: number | string;
  dbType: string;
  filterText?: string;
}>();

const emit = defineEmits<{
  openTable: [
    payload: { instanceName: string; tableName: string; schemaName?: string },
  ];
  insertName: [name: string];
  /** 单击库节点：同步编辑器当前库 */
  selectInstance: [instanceName: string];
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

const capabilities = computed(() => resolveCapabilities(props.dbType));
/** 右键菜单文案：Oracle/达梦一级节点是「模式」而非「数据库」 */
const instanceLabel = computed(() => instanceLabelOf(props.dbType));

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
 * 实例下的对象文件夹，按当前库的能力开关裁剪。
 * Queries 恒定存在：存的是「当前登录用户 + 当前连接 + 当前库」的已保存 SQL，
 * 属于客户端自身数据，与数据库是否支持 Event Scheduler 无关。
 */
function buildFolderNodes(instanceName: string) {
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
  return specs
    .filter((s) => s.enabled)
    .map((s) => ({
      id: `${s.kind}-${instanceName}`,
      label: s.label,
      nodeType: 'folder',
      objectKind: s.kind,
      instanceName,
      isLeaf: false,
    }));
}

function matchFilter(label: string) {
  const q = (props.filterText || '').trim().toLowerCase();
  if (!q) return true;
  return String(label || '')
    .toLowerCase()
    .includes(q);
}

/** 加载连接下的库/模式列表；不预置 children，交给 lazy */
async function loadInstances() {
  loading.value = true;
  try {
    const res: any = await getInstances(props.dbConfigId);
    const trees = res?.data || res || [];
    const instances = trees[0]?.instances || [];
    // 整表替换，清掉 lazy 展开缓存
    treeData.value = instances.map((ins: any) => ({
      id: `ins-${ins.instanceName}`,
      label: ins.instanceName,
      nodeType: 'instance',
      instanceName: ins.instanceName,
      isLeaf: false,
    }));
  } catch (error: any) {
    ElMessage.error(error?.message || '加载实例失败');
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

const OBJECT_API: Record<string, (a: any, b: any) => Promise<any>> = {
  views: getViews,
  procedures: getProcedures,
  functions: getFunctions,
  triggers: getTriggers,
  events: getEvents,
};

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
        /** 真实 schema（PG=public；达梦=OWNER）；打开表 SQL 优先用此字段 */
        schemaName: t.schemaName || undefined,
        isLeaf: false,
      }));
    } else if (objectKind === 'queries') {
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
      const api = OBJECT_API[objectKind];
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
    resolve(
      props.filterText
        ? list.filter((n) => matchFilter(n.name || n.label))
        : list,
    );
  } catch (error: any) {
    ElMessage.error(error?.message || '加载失败');
    resolve([]);
  }
}

/** 展开表节点时加载字段 */
async function loadColumns(node: any, resolve: (data: any[]) => void) {
  const { instanceName, name } = node.data;
  try {
    const res: any = await getTableColumns(props.dbConfigId, instanceName, name);
    resolve(
      (res?.data || res || []).map((c: any) => ({
        id: `col-${instanceName}-${name}-${c.fieldName}`,
        label: `${c.fieldName}${c.dataType ? ` : ${c.dataType}` : ''}`,
        name: c.fieldName,
        nodeType: 'column',
        instanceName,
        tableName: name,
        isLeaf: true,
      })),
    );
  } catch {
    resolve([]);
  }
}

/**
 * ElTree lazy 回调：
 * - 展开库 → 返回对象文件夹
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

/** 单击：实例/文件夹点行切换展开；表节点不展开列（仅箭头展开），只记录选中供 F11 */
function onNodeClick(data: any, node: any) {
  // 实例、二级目录：点击名称行展开/收起（表节点除外）
  if (
    (data?.nodeType === 'instance' || data?.nodeType === 'folder') &&
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
  if (data?.nodeType === 'table' && data.name) {
    emit('selectTable', {
      instanceName: data.instanceName,
      tableName: data.name,
      schemaName: data.schemaName,
    });
  }
}

/** 右键：库 / Tables / 表 / 已保存查询 / 可编程对象 */
function onNodeContextMenu(event: MouseEvent, data: any) {
  const programKinds = new Set([
    'views',
    'procedures',
    'functions',
    'triggers',
    'events',
  ]);
  const allow =
    data.nodeType === 'instance' ||
    data.nodeType === 'table' ||
    data.nodeType === 'savedQuery' ||
    (data.nodeType === 'folder' &&
      (data.objectKind === 'tables' || programKinds.has(data.objectKind))) ||
    programKinds.has(data.nodeType);
  if (!allow) return;
  event.preventDefault();
  event.stopPropagation();
  const pad = 8;
  const menuW = 220;
  const menuH = 220;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.targetType = data.nodeType;
  ctxMenu.objectKind = data.objectKind || data.nodeType || '';
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
  const target = e.target as HTMLElement | null;
  if (target?.closest('.obj-ctx-menu')) return;
  closeCtxMenu();
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
 * 刷新指定实例下的某个文件夹。
 * ElTree lazy：清掉子节点缓存后重新展开。
 */
function reloadFolder(objectKind: string, instanceName: string) {
  const tree = treeRef.value;
  if (!tree || !instanceName) return;
  const node = tree.getNode(`${objectKind}-${instanceName}`);
  if (!node) return;
  node.loaded = false;
  node.expand();
}

/** 刷新某库下 Queries 文件夹（保存/删除后由父级调用） */
function reloadQueries(instanceName: string) {
  reloadFolder('queries', instanceName);
}

/** 刷新某库下 Tables 文件夹（删表后由父级调用） */
function reloadTables(instanceName: string) {
  reloadFolder('tables', instanceName);
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

/** 展开节点并等待 lazy 子节点加载完成 */
function waitExpand(node: any): Promise<void> {
  return new Promise((resolve) => {
    if (!node) {
      resolve();
      return;
    }
    if (node.expanded && node.loaded) {
      resolve();
      return;
    }
    try {
      node.expand(() => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * 在对象树中定位：
 * - 有 savedQueryId：展开实例 → Queries，高亮对应已保存查询
 * - 无 savedQueryId：高亮当前数据库实例节点
 */
async function locateTarget(opts: {
  instanceName?: string;
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
    await loadInstances();
  }
  const insKey = `ins-${instanceName}`;
  const insNode = tree.getNode(insKey);
  if (!insNode) {
    ElMessage.warning(`左侧未找到${instanceLabel.value}：${instanceName}`);
    return;
  }

  await waitExpand(insNode);

  if (opts.savedQueryId == null || opts.savedQueryId === '') {
    applyLocateHighlight(insKey);
    return;
  }

  const folderKey = `queries-${instanceName}`;
  const folderNode = tree.getNode(folderKey);
  if (!folderNode) {
    ElMessage.warning('未找到 Queries 目录');
    applyLocateHighlight(insKey);
    return;
  }
  // 强制刷新 Queries，避免缓存里没有刚保存的项
  folderNode.loaded = false;
  folderNode.expanded = false;
  await waitExpand(folderNode);

  const queryKey = `saved-${opts.savedQueryId}`;
  const queryNode = tree.getNode(queryKey);
  if (!queryNode) {
    ElMessage.warning('Queries 中未找到该已保存查询');
    applyLocateHighlight(folderKey);
    return;
  }
  applyLocateHighlight(queryKey);
}

watch(
  () => props.filterText,
  (val) => treeRef.value?.filter(val || ''),
);

watch(
  () => [props.dbConfigId, props.dbType],
  () => {
    clearLocateHighlight();
    loadInstances();
  },
);

onMounted(() => {
  loadInstances();
  document.addEventListener('mousedown', onDocMouseDown, true);
});

onBeforeUnmount(() => {
  clearLocateHighlight();
  document.removeEventListener('mousedown', onDocMouseDown, true);
});

defineExpose({
  reload: loadInstances,
  reloadQueries,
  reloadTables,
  reloadFolder,
  locateTarget,
  closeContextMenu: closeCtxMenu,
});
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
        >{{ node.label }}</span>
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
  height: 100%;
  padding: 4px;
  overflow: auto;
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
