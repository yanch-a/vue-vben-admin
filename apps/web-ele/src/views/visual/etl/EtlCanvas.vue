<script lang="ts" setup>
/**
 * ETL 工作区画布：一个画布显示工作区里的全部任务，每个任务是一个分组框，框内是它的步骤和连线。
 * 节点和分组都可以拖动；从节点右侧圆点拖到同一任务的另一节点即可连线；双击节点打开节点配置。
 * 所有改动直接写回对应任务的 JSON，表单和 JSON 视图看到的是同一份数据。
 *
 * @author yanch
 */
import type { Cell, Edge, Node } from '@antv/x6';

import type { EtlCanvasEdge, EtlCanvasGroupLayout, EtlCanvasMatch } from './etlCanvasModel';
import type { EtlCanvasViewState } from './etlWorkspaceSession';

import type { EtlNode, EtlPipeline } from '#/api/visual/etl';

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { Graph } from '@antv/x6';
import { Aim, ArrowDown, ArrowUp, Delete, FolderAdd, Grid, Plus, RefreshLeft, RefreshRight, Search, VideoPlay, ZoomIn, ZoomOut } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import { translateUiText } from '#/locales/ui-text';

import {
  connectEtlCanvasNodes,
  disconnectEtlCanvasNodes,
  ETL_CANVAS_NODE_HEIGHT,
  ETL_CANVAS_NODE_WIDTH,
  etlCanvasCategory,
  etlCanvasEdges,
  type EtlCanvasLayoutCache,
  etlTaskDependencyEdges,
  etlWorkspaceLayout,
  resetEtlWorkspaceLayout,
  searchEtlCanvas,
  setEtlCanvasOrigin,
  setEtlCanvasPosition,
} from './etlCanvasModel';
import {
  ETL_CANVAS_TYPE_ACCENTS,
  etlCanvasTheme,
  etlCardShadow,
  etlEdgeLabel,
  etlGroupAttrs,
  etlNodeAttrs,
} from './etlCanvasTheme';
import { ETL_OPERATORS } from './etlOperators';

const props = defineProps<{
  activePipelineId: string;
  canRedo?: boolean;
  canUndo?: boolean;
  pipelines: EtlPipeline[];
  running?: boolean;
  selectedId?: string;
  subtitleOf: (node: EtlNode) => string;
  titleOf: (node: EtlNode) => string;
}>();

const emit = defineEmits<{
  add: [type: string];
  addTask: [];
  redo: [];
  undo: [];
  deleteTask: [pipelineId: string];
  edit: [pipelineId: string, nodeId: string];
  enableTask: [pipelineId: string, enabled: boolean];
  remove: [pipelineId: string, nodeId: string];
  rename: [pipelineId: string, nodeId: string];
  renameTask: [pipelineId: string];
  move: [pipelineId: string, nodeId: string, delta: -1 | 1];
  run: [pipelineId: string];
  select: [pipelineId: string, nodeId?: string];
>();

const NODE_SHAPE = 'lemon-etl-step';
const shortcut = /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
const GROUP_SHAPE = 'lemon-etl-task';
const containerRef = ref<HTMLElement>();
const selectedEdge = ref<(EtlCanvasEdge & { pipelineId: string }) | null>(null);
const keyword = ref('');
const matchIndex = ref(0);
let graph: Graph | null = null;
let fitPending = true;
/** 画布自己触发的任务切换不再居中，避免点一下节点画面就跳。 */
let selectFromCanvas = false;
let layouts: Record<string, EtlCanvasGroupLayout> = {};
/** 画布右键菜单：任务组与步骤节点；坐标相对画布容器。 */
const taskMenu = ref<{ kind: 'task' | 'node'; pipelineId: string; nodeId?: string; x: number; y: number }>();
const taskMenuPipeline = computed(() => (taskMenu.value ? pipelineOf(taskMenu.value.pipelineId) : undefined));
const taskMenuNode = computed(() => {
  const menu = taskMenu.value;
  if (!menu?.nodeId || !taskMenuPipeline.value) return undefined;
  return taskMenuPipeline.value.nodes.find((item) => item.id === menu.nodeId);
});
const taskMenuTitle = computed(() => {
  if (taskMenu.value?.kind === 'node' && taskMenuNode.value) {
    return props.titleOf(taskMenuNode.value) || taskMenuNode.value.name || taskMenuNode.value.id;
  }
  return taskMenuPipeline.value?.name || taskMenuPipeline.value?.id || '';
});
function closeTaskMenu() {
  taskMenu.value = undefined;
}
function canMoveMenuNode(delta: -1 | 1) {
  const pipeline = taskMenuPipeline.value;
  const nodeId = taskMenu.value?.nodeId;
  if (!pipeline || !nodeId) return false;
  const index = pipeline.nodes.findIndex((item) => item.id === nodeId);
  const next = index + delta;
  return index >= 0 && next >= 0 && next < pipeline.nodes.length;
}
function taskMenuAction(action: 'delete' | 'enable' | 'rename' | 'run' | 'moveUp' | 'moveDown') {
  const menu = taskMenu.value;
  const pipeline = taskMenuPipeline.value;
  closeTaskMenu();
  if (!menu || !pipeline) return;
  if (menu.kind === 'node' && menu.nodeId) {
    if (action === 'rename') emit('rename', pipeline.id, menu.nodeId);
    else if (action === 'moveUp') emit('move', pipeline.id, menu.nodeId, -1);
    else if (action === 'moveDown') emit('move', pipeline.id, menu.nodeId, 1);
    else if (action === 'delete') emit('remove', pipeline.id, menu.nodeId);
    return;
  }
  if (action === 'rename') emit('renameTask', pipeline.id);
  else if (action === 'enable') emit('enableTask', pipeline.id, pipeline.enabled === false);
  else if (action === 'run') emit('run', pipeline.id);
  else emit('deleteTask', pipeline.id);
}

/** 单元格 ID：分组、节点和连线都带上任务 ID，不同任务里同名的节点 ID 不会冲突。 */
const groupCellId = (pipelineId: string) => `task|${pipelineId}`;
const nodeCellId = (pipelineId: string, nodeId: string) => `node|${pipelineId}|${nodeId}`;
interface CellRef { kind: 'group' | 'node'; nodeId?: string; pipelineId: string }

const CATEGORY_COLORS: Record<string, string> = {
  // 柔和的类型色（Element Plus light-3 色阶），深色主题下也不刺眼。
  source: '#79bbff',
  transform: '#95d475',
  write: '#eebe77',
};

const matches = computed<EtlCanvasMatch[]>(() => searchEtlCanvas(props.pipelines, keyword.value, props.titleOf));
const matchedCells = computed(() => {
  const groups = new Set<string>();
  const nodes = new Set<string>();
  for (const item of matches.value) {
    if (item.kind === 'group') groups.add(item.pipelineId);
    else nodes.add(nodeCellId(item.pipelineId, item.nodeId!));
  }
  return { groups, nodes };
});
const activePipeline = computed(() => props.pipelines.find((item) => item.id === props.activePipelineId));

const canvasTheme = () => etlCanvasTheme();
const cardShadow = etlCardShadow;
const TYPE_ACCENTS = ETL_CANVAS_TYPE_ACCENTS;


function cellRef(cell?: Cell | null): CellRef | undefined {
  const data = cell?.getData() as CellRef | undefined;
  return data && data.pipelineId ? data : undefined;
}

function pipelineOf(id: string) {
  return props.pipelines.find((item) => item.id === id);
}

function registerShapes() {
  Graph.registerNode(
    NODE_SHAPE,
    {
      inherit: 'rect',
      width: ETL_CANVAS_NODE_WIDTH,
      height: ETL_CANVAS_NODE_HEIGHT,
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'circle', selector: 'dot' },
        { tagName: 'text', selector: 'title' },
      ],
      // 单行：类型小圆点 + 标题（超长省略，完整名称和类型 / 数据源在悬停提示里）。
      attrs: {
        body: { refWidth: '100%', refHeight: '100%', rx: 6, ry: 6, stroke: 'none', strokeWidth: 0 },
        dot: { r: 3.5, refX: 11, refY: '50%' },
        // 标题超长由 etlFitText 预截断；X6 textWrap+height:16 对长中文会整段不显示
        title: {
          refX: 20, refY: '50%', fontSize: 12, fontWeight: 500, textAnchor: 'start', textVerticalAnchor: 'middle',
        },
      },
      ports: {
        groups: {
          in: { position: 'left', attrs: { circle: { r: 3, magnet: 'passive', strokeWidth: 1 } } },
          out: { position: 'right', attrs: { circle: { r: 4, magnet: true, strokeWidth: 1, cursor: 'crosshair' } } },
        },
      },
    },
    true,
  );
  Graph.registerNode(
    GROUP_SHAPE,
    {
      inherit: 'rect',
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'circle', selector: 'dot' },
        { tagName: 'text', selector: 'label' },
        { tagName: 'text', selector: 'status' },
        { tagName: 'text', selector: 'count' },
      ],
      // 没有单独的标题栏矩形（之前的 header 矩形继承了 SVG 默认描边，显示成一条框线）；标题只是文字。
      attrs: {
        body: { refWidth: '100%', refHeight: '100%', rx: 10, ry: 10, stroke: 'none', strokeWidth: 0, cursor: 'move' },
        dot: { refX: 14, refY: 13, r: 0 },
        label: { refX: 10, refY: 13, fontSize: 12, fontWeight: 500, textAnchor: 'start', textVerticalAnchor: 'middle' },
        status: { refX: 10, refY: 13, fontSize: 11, fontWeight: 500, textAnchor: 'start', textVerticalAnchor: 'middle' },
        count: { refX: 60, refY: 13, fontSize: 11, textAnchor: 'start', textVerticalAnchor: 'middle' },
      },
    },
    true,
  );
}

function initGraph() {
  if (!containerRef.value) return;
  registerShapes();
  graph = new Graph({
    container: containerRef.value,
    autoResize: true,
    // 上百个任务时只渲染可见区域，并异步分批绘制，拖动和缩放不卡。
    async: true,
    virtual: true,
    background: { color: canvasTheme().background },
    grid: { visible: true, type: 'dot', size: 16, args: { color: canvasTheme().grid, thickness: 1 } },
    // 空白处左键拖动平移，滚轮缩放。
    panning: { enabled: true, eventTypes: ['leftMouseDown'] },
    mousewheel: { enabled: true, factor: 1.1, maxScale: 2, minScale: 0.15 },
    // 只用代码建立任务和节点的父子关系，不允许把节点拖进别的任务。
    embedding: { enabled: false },
    interacting: { nodeMovable: true, edgeMovable: false, edgeLabelMovable: false, arrowheadMovable: false, vertexMovable: false },
    connecting: {
      allowBlank: false,
      allowLoop: false,
      allowMulti: false,
      allowNode: true,
      allowPort: true,
      allowEdge: false,
      highlight: true,
      snap: { radius: 30 },
      connector: { name: 'smooth' },
      validateMagnet({ magnet }) {
        return magnet?.getAttribute('port-group') === 'out';
      },
      validateConnection({ sourceCell, targetCell, targetMagnet }) {
        const source = cellRef(sourceCell);
        const target = cellRef(targetCell);
        if (source?.kind !== 'node' || target?.kind !== 'node' || sourceCell?.id === targetCell?.id) return false;
        return !targetMagnet || targetMagnet.getAttribute('port-group') === 'in';
      },
      createEdge() {
        return graph!.createEdge({
          attrs: { line: { stroke: CATEGORY_COLORS.source, strokeWidth: 1.25, targetMarker: { name: 'block', width: 6, height: 4 } } },
          connector: { name: 'smooth' },
          zIndex: 3,
        });
      },
    },
    highlighting: {
      magnetAdsorbed: { name: 'stroke', args: { attrs: { stroke: CATEGORY_COLORS.source, strokeWidth: 2 } } },
    },
  });

  const focusCanvas = () => containerRef.value?.focus({ preventScroll: true });
  graph.on('cell:mousedown', focusCanvas);
  graph.on('blank:mousedown', focusCanvas);
  graph.on('node:click', ({ node }) => {
    const ref = cellRef(node);
    if (!ref) return;
    selectedEdge.value = null;
    selectFromCanvas = ref.pipelineId !== props.activePipelineId;
    emit('select', ref.pipelineId, ref.nodeId);
    render();
  });
  graph.on('node:dblclick', ({ node }) => {
    const ref = cellRef(node);
    if (ref?.kind === 'node') {
      selectFromCanvas = ref.pipelineId !== props.activePipelineId;
      emit('edit', ref.pipelineId, ref.nodeId!);
    }
  });
  graph.on('node:moved', ({ node }) => onMoved(node));
  // 节点只显示一行标题，悬停时用原生提示显示完整名称、类型和数据源。
  graph.on('node:mouseenter', ({ node }) => {
    const ref = cellRef(node);
    const pipeline = ref ? pipelineOf(ref.pipelineId) : undefined;
    if (!containerRef.value || !ref || !pipeline) return;
    const step = ref.nodeId ? pipeline.nodes.find((item) => item.id === ref.nodeId) : undefined;
    containerRef.value.title = step ? `${props.titleOf(step)}\n${props.subtitleOf(step)}` : pipeline.name || pipeline.id;
  });
  graph.on('node:mouseenter', ({ node }) => {
    if (cellRef(node)?.kind === 'node') node.setAttrByPath('body/filter', cardShadow(canvasTheme().shadowHover, 6));
  });
  graph.on('node:mouseleave', ({ node }) => {
    if (cellRef(node)?.kind === 'node') node.setAttrByPath('body/filter', cardShadow(canvasTheme().shadow));
    if (containerRef.value) containerRef.value.title = '';
  });
  // 任务分组：任务菜单；步骤节点：改名 / 删除。
  graph.on('node:contextmenu', ({ e, node }) => {
    const ref = cellRef(node);
    if (!ref || !containerRef.value) return;
    e.preventDefault();
    const box = containerRef.value.getBoundingClientRect();
    selectFromCanvas = ref.pipelineId !== props.activePipelineId;
    emit('select', ref.pipelineId, ref.nodeId);
    const pos = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (ref.kind === 'node' && ref.nodeId) {
      taskMenu.value = { kind: 'node', pipelineId: ref.pipelineId, nodeId: ref.nodeId, ...pos };
    } else {
      taskMenu.value = { kind: 'task', pipelineId: ref.pipelineId, ...pos };
    }
  });
  graph.on('blank:mousedown', closeTaskMenu);
  graph.on('cell:mousedown', closeTaskMenu);
  graph.on('scale', closeTaskMenu);
  graph.on('translate', closeTaskMenu);
  graph.on('edge:click', ({ edge }) => {
    const data = edge.getData() as (EtlCanvasEdge & { pipelineId: string }) | undefined | { kind: 'task' };
    // 任务依赖线只读，在任务设置里修改。
    if (!data || data.kind === 'task') return;
    selectedEdge.value = data as EtlCanvasEdge & { pipelineId: string };
    render();
  });
  graph.on('blank:click', () => {
    if (selectedEdge.value) {
      selectedEdge.value = null;
      render();
    }
  });
  graph.on('edge:connected', ({ isNew, edge }) => {
    if (!isNew) return;
    const source = cellRef(edge.getSourceCell());
    const target = cellRef(edge.getTargetCell());
    // 画布上的临时线不保存，统一按 JSON 重新绘制。
    graph?.removeEdge(edge);
    if (!source?.nodeId || !target?.nodeId) return;
    if (source.pipelineId !== target.pipelineId) {
      ElMessage.warning(translateUiText('不能跨任务连线；任务之间的先后顺序请在任务的依赖设置里配置'));
      return;
    }
    const pipeline = pipelineOf(source.pipelineId);
    if (!pipeline) return;
    const error = connectEtlCanvasNodes(pipeline, source.nodeId, target.nodeId);
    if (error) ElMessage.warning(translateUiText(error));
    render();
  });
  render();
}

/** 拖动结束：分组保存原点，节点保存相对所在分组原点的位置。 */
function onMoved(node: Node) {
  const ref = cellRef(node);
  if (!ref) return;
  const pipeline = pipelineOf(ref.pipelineId);
  const layout = layouts[ref.pipelineId];
  if (!pipeline || !layout) return;
  const position = node.getPosition();
  if (ref.kind === 'group') {
    setEtlCanvasOrigin(pipeline, { x: layout.origin.x + position.x - layout.x, y: layout.origin.y + position.y - layout.y });
  } else {
    setEtlCanvasPosition(pipeline, ref.nodeId!, { x: position.x - layout.origin.x, y: position.y - layout.origin.y });
  }
}

function edgeStyle(kind: 'task' | EtlCanvasEdge['kind'], selected: boolean, dim: boolean) {
  const theme = canvasTheme();
  const color = selected ? theme.edgeSelected : kind === 'disabled' ? theme.edgeDisabled : kind === 'task' ? theme.edgeTask : theme.edge;
  return {
    line: {
      stroke: color,
      strokeWidth: selected ? 1.5 : 1,
      strokeDasharray: kind === 'disabled' || kind === 'parameter' || kind === 'task' ? '6 4' : undefined,
      targetMarker: { name: 'block', width: 6, height: 4 },
      opacity: dim ? 0.2 : 1,
    },
  };
}

/** 增量更新：只改变化的分组、节点和连线。整张重建会打断双击、闪烁并丢掉缩放。 */
function render() {
  if (!graph) return;
  const g = graph;
  layouts = etlWorkspaceLayout(props.pipelines, layoutCache);
  const theme = canvasTheme();
  const { muted, primary } = theme;
  const fill = theme.nodeBase;
  const searching = keyword.value.trim().length > 0;
  const { groups: matchedGroups, nodes: matchedNodes } = matchedCells.value;
  const current = matches.value[matchIndex.value];
  const currentId = current ? (current.kind === 'group' ? groupCellId(current.pipelineId) : nodeCellId(current.pipelineId, current.nodeId!)) : '';
  if (selectedEdge.value && !pipelineOf(selectedEdge.value.pipelineId)) selectedEdge.value = null;

  const wantedNodes = new Set<string>();
  const wantedEdges = new Set<string>();
  const groupMeta: Node.Metadata[] = [];
  const nodeMeta: { meta: Node.Metadata; parent: string }[] = [];
  const edgeMeta: Edge.Metadata[] = [];

  for (const pipeline of props.pipelines) {
    const layout = layouts[pipeline.id]!;
    const gid = groupCellId(pipeline.id);
    const active = pipeline.id === props.activePipelineId;
    const groupHit = matchedGroups.has(pipeline.id);
    const groupDim = searching && !groupHit && !pipeline.nodes.some((node) => matchedNodes.has(nodeCellId(pipeline.id, node.id)));
    wantedNodes.add(gid);
    groupMeta.push({
      id: gid,
      shape: GROUP_SHAPE,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      zIndex: 1,
      data: { kind: 'group', pipelineId: pipeline.id },
      attrs: etlGroupAttrs(theme, {
        active,
        count: `· ${pipeline.nodes.length} ${translateUiText('个步骤')}`,
        current: gid === currentId,
        dim: groupDim,
        disabled: pipeline.enabled === false,
        hit: groupHit,
        name: pipeline.name || pipeline.id,
        status: pipeline.enabled === false ? translateUiText('停用') : '',
        width: layout.width,
      }),
    });
    for (const node of pipeline.nodes) {
      const id = nodeCellId(pipeline.id, node.id);
      const color = CATEGORY_COLORS[etlCanvasCategory(node.type)] || primary;
      const accent = TYPE_ACCENTS[etlCanvasCategory(node.type)] || primary;
      const selected = active && node.id === props.selectedId;
      const hit = matchedNodes.has(id);
      const dim = searching && !hit && !groupHit;
      wantedNodes.add(id);
      const disabled = node.enabled === false;
      nodeMeta.push({
        parent: gid,
        meta: {
          id,
          shape: NODE_SHAPE,
          ...layout.nodes[node.id]!,
          zIndex: 2,
          data: { kind: 'node', pipelineId: pipeline.id, nodeId: node.id },
          attrs: etlNodeAttrs(theme, { accent, current: id === currentId, dim, disabled, hit, selected, title: props.titleOf(node) }),
          ports: {
            items: [
              { id: 'in', group: 'in', attrs: { circle: { fill, stroke: muted } } },
              { id: 'out', group: 'out', attrs: { circle: { fill, stroke: color } } },
            ],
          },
        },
      });
    }
    for (const item of etlCanvasEdges(pipeline)) {
      const id = `edge|${pipeline.id}|${item.id}`;
      wantedEdges.add(id);
      const selected = selectedEdge.value?.pipelineId === pipeline.id && selectedEdge.value.id === item.id;
      edgeMeta.push({
        id,
        shape: 'edge',
        source: { cell: nodeCellId(pipeline.id, item.source), port: 'out' },
        target: { cell: nodeCellId(pipeline.id, item.target), port: 'in' },
        connector: { name: 'smooth' },
        attrs: edgeStyle(item.kind, selected, searching && !groupHit),
        labels: item.kind === 'parameter' ? [etlEdgeLabel(theme, translateUiText('参数'))] : [],
        data: { ...item, pipelineId: pipeline.id },
        zIndex: 3,
      });
    }
  }
  for (const item of etlTaskDependencyEdges(props.pipelines)) {
    const id = `task-edge|${item.source}|${item.target}`;
    wantedEdges.add(id);
    edgeMeta.push({
      id,
      shape: 'edge',
      source: { cell: groupCellId(item.source) },
      target: { cell: groupCellId(item.target) },
      connector: { name: 'smooth' },
      attrs: edgeStyle('task', false, searching),
      labels: [etlEdgeLabel(theme, translateUiText('任务依赖'))],
      data: { kind: 'task' },
      zIndex: 0,
    });
  }

  g.batchUpdate(() => {
    for (const edge of g.getEdges()) if (!wantedEdges.has(String(edge.id))) g.removeEdge(edge);
    for (const cell of g.getNodes()) if (!wantedNodes.has(String(cell.id))) g.removeNode(cell);
    const upsertNode = (meta: Node.Metadata) => {
      const existing = g.getCellById(String(meta.id));
      if (!existing?.isNode()) return g.addNode(meta);
      const position = existing.getPosition();
      if (position.x !== meta.x || position.y !== meta.y) existing.setPosition(meta.x!, meta.y!);
      if (meta.width && meta.height) {
        const size = existing.getSize();
        if (size.width !== meta.width || size.height !== meta.height) existing.setSize(meta.width, meta.height);
      }
      existing.setAttrs(meta.attrs!);
      for (const port of ((meta.ports as any)?.items || []) as { attrs: any; id: string }[]) existing.setPortProp(port.id, 'attrs', port.attrs);
      return existing;
    };
    // 先放分组再放节点，节点挂到所在任务分组下，拖动分组时节点跟着走。
    for (const meta of groupMeta) upsertNode(meta);
    for (const { meta, parent } of nodeMeta) {
      const node = upsertNode(meta);
      const group = g.getCellById(parent);
      if (group?.isNode() && node.getParentId() !== parent) group.addChild(node);
    }
    for (const meta of edgeMeta) {
      const existing = g.getCellById(String(meta.id)) as Edge | null;
      if (existing?.isEdge()) {
        existing.setAttrs(meta.attrs!);
        existing.setLabels((meta.labels || []) as any);
        existing.setData(meta.data, { overwrite: true });
      } else {
        g.addEdge(meta);
      }
    }
  });
  if (fitPending && props.pipelines.length) {
    fitPending = false;
    nextTick(() => fitView());
  }
}

function fitView() {
  if (!graph || !containerRef.value?.clientWidth || !containerRef.value.clientHeight) return;
  graph.zoomToFit({ padding: 40, maxScale: 1 });
}

function zoom(delta: number) {
  graph?.zoom(delta);
}

function centerOn(cellId: string) {
  const cell = graph?.getCellById(cellId);
  if (cell) graph?.centerCell(cell);
}

// 本次会话的布局缓存（不写入 JSON），见 etlWorkspaceLayout。
const layoutCache: EtlCanvasLayoutCache = new Map();

function autoLayout() {
  layoutCache.clear();
  resetEtlWorkspaceLayout(props.pipelines);
  render();
  nextTick(() => fitView());
}

/** 在搜索结果之间切换并居中显示。 */
function stepMatch(delta: number) {
  const total = matches.value.length;
  if (!total) return;
  matchIndex.value = (matchIndex.value + delta + total) % total;
  const item = matches.value[matchIndex.value]!;
  render();
  centerOn(item.kind === 'group' ? groupCellId(item.pipelineId) : nodeCellId(item.pipelineId, item.nodeId!));
}

function onSearchKey(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    stepMatch(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    keyword.value = '';
  }
}

async function removeSelectedEdge() {
  const item = selectedEdge.value;
  if (!item) return;
  try {
    await ElMessageBox.confirm(translateUiText('删除这条连线？'), translateUiText('删除连线'), { type: 'warning' });
  } catch {
    return;
  }
  const pipeline = pipelineOf(item.pipelineId);
  selectedEdge.value = null;
  if (!pipeline) return;
  const message = disconnectEtlCanvasNodes(pipeline, item.source, item.target);
  if (message) ElMessage.warning(translateUiText(message));
  render();
}

function removeSelected() {
  if (selectedEdge.value) {
    void removeSelectedEdge();
    return;
  }
  if (props.selectedId && props.activePipelineId) emit('remove', props.activePipelineId, props.selectedId);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && taskMenu.value) {
    closeTaskMenu();
    return;
  }
  if (event.target !== containerRef.value) return;
  // 撤销 / 重做只在画布获得焦点时响应；输入框、抽屉、JSON 编辑器里保留浏览器自带的撤销。
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) emit('redo');
      else emit('undo');
      return;
    }
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    removeSelected();
  } else if (event.key === 'Enter' && props.selectedId && props.activePipelineId) {
    emit('edit', props.activePipelineId, props.selectedId);
  }
}

// 名称、类型、引用、连线、位置、任务依赖变化都要更新画布；双击编辑后画布立即更新。
watch(
  () =>
    JSON.stringify([
      props.activePipelineId,
      props.selectedId,
      props.pipelines.map((pipeline) => [
        pipeline.id,
        pipeline.name,
        pipeline.enabled,
        pipeline.dependsOn,
        pipeline.edges,
        pipeline.ui?.canvas,
        pipeline.nodes.map((node) => [node.id, node.enabled, props.titleOf(node), props.subtitleOf(node), node.config?.inputStepId, node.config?.rightStepId, node.config?.inputStepIds, (node.config?.parameters || []).map((item: any) => item?.stepId)]),
      ]),
    ]),
  () => render(),
);
watch(keyword, () => {
  matchIndex.value = 0;
  render();
  const first = matches.value[0];
  if (first) centerOn(first.kind === 'group' ? groupCellId(first.pipelineId) : nodeCellId(first.pipelineId, first.nodeId!));
});
// 从任务标签切换任务时把该任务移到画面中间；画布里点出来的切换不动画面。
watch(
  () => props.activePipelineId,
  (id) => {
    if (selectFromCanvas) {
      selectFromCanvas = false;
      return;
    }
    if (id) nextTick(() => centerOn(groupCellId(id)));
  },
);

/** 点击画布以外的地方关闭任务菜单。 */
function onDocumentPointer(event: PointerEvent) {
  if (!taskMenu.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.etl-canvas__menu')) closeTaskMenu();
}
// 画布高度随父容器变化（隐藏标签栏、切换工具栏、拖动窗口），显式同步 x6 尺寸。
let resizeObserver: null | ResizeObserver = null;
// 主题（白天 / 夜间）切换时，html 的 class / style 会变；直接用新的 CSS 变量重画背景、网格和所有元素颜色，不重建画布。
let themeObserver: MutationObserver | null = null;
let themeFrame = 0;
function applyTheme() {
  cancelAnimationFrame(themeFrame);
  themeFrame = requestAnimationFrame(() => {
    if (!graph) return;
    graph.drawBackground({ color: canvasTheme().background });
    graph.drawGrid({ type: 'dot', args: { color: canvasTheme().grid, thickness: 1 } });
    render();
  });
}
let resizeFrame = 0;
function syncGraphSize() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const el = containerRef.value;
    if (graph && el && el.clientWidth && el.clientHeight) graph.resize(el.clientWidth, el.clientHeight);
  });
}
onMounted(() => {
  initGraph();
  document.addEventListener('pointerdown', onDocumentPointer, true);
  window.addEventListener('resize', syncGraphSize);
  themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(syncGraphSize);
    resizeObserver.observe(containerRef.value);
  }
});
/** 画布视图状态（缩放、平移、搜索词），切换工作区时由父组件按工作区保存 / 恢复。 */
function captureView(): EtlCanvasViewState | undefined {
  if (!graph) return undefined;
  const { tx, ty } = graph.translate();
  return { keyword: keyword.value, matchIndex: matchIndex.value, scale: graph.zoom(), tx, ty };
}
async function restoreView(view?: EtlCanvasViewState) {
  if (!view) return;
  fitPending = false;
  keyword.value = view.keyword;
  // 等搜索 / 选中任务触发的自动居中先跑完，再覆盖为保存的视图。
  await nextTick();
  await nextTick();
  matchIndex.value = Math.min(view.matchIndex, Math.max(0, matches.value.length - 1));
  render();
  if (!graph) return;
  graph.zoomTo(view.scale);
  graph.translate(view.tx, view.ty);
}
defineExpose({ captureView, restoreView });

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true);
  window.removeEventListener('resize', syncGraphSize);
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  themeObserver = null;
  cancelAnimationFrame(themeFrame);
  resizeObserver = null;
  cancelAnimationFrame(resizeFrame);
  graph?.dispose();
  graph = null;
});
</script>

<template>
  <div class="etl-canvas">
    <div class="etl-canvas__toolbar">
      <el-dropdown trigger="click" :disabled="!activePipeline" @command="(type: string) => emit('add', type)">
        <el-button size="small" type="primary" :icon="Plus" :disabled="!activePipeline">
          {{ $tr('添加节点') }}
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>{{ $tr('添加到任务') }}：{{ activePipeline?.name || activePipeline?.id }}</el-dropdown-item>
            <el-dropdown-item divided command="database.query">{{ $tr('查询步骤') }}</el-dropdown-item>
            <el-dropdown-item command="transform.select">{{ $tr('字段处理步骤') }}</el-dropdown-item>
            <el-dropdown-item v-for="operator in ETL_OPERATORS" :key="operator.type" :command="operator.type">{{ $tr(operator.label) }}</el-dropdown-item>
            <el-dropdown-item command="database.write">{{ $tr('写入步骤') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button size="small" :icon="FolderAdd" @click="emit('addTask')">{{ $tr('新增任务') }}</el-button>
      <el-button size="small" :icon="RefreshLeft" circle :disabled="!canUndo" :title="`${$tr('撤销')} (${shortcut}+Z)`" @click="emit('undo')" />
      <el-button size="small" :icon="RefreshRight" circle :disabled="!canRedo" :title="`${$tr('重做')} (${shortcut}+Y / ${shortcut}+Shift+Z)`" @click="emit('redo')" />
      <el-button size="small" :icon="Grid" @click="autoLayout">{{ $tr('自动布局') }}</el-button>
      <el-button size="small" :icon="Aim" @click="fitView">{{ $tr('适应画布') }}</el-button>
      <el-button size="small" :icon="ZoomIn" circle :title="$tr('放大')" @click="zoom(0.1)" />
      <el-button size="small" :icon="ZoomOut" circle :title="$tr('缩小')" @click="zoom(-0.1)" />
      <el-button size="small" :icon="Delete" :disabled="!selectedEdge && !selectedId" @click="removeSelected">
        {{ $tr(selectedEdge ? '删除连线' : '删除节点') }}
      </el-button>
      <el-button
        size="small"
        :icon="VideoPlay"
        :loading="running"
        :disabled="!activePipeline"
        :title="activePipeline ? `${$tr('运行任务')}：${activePipeline.name || activePipeline.id}` : ''"
        @click="activePipeline && emit('run', activePipeline.id)"
      >
        {{ $tr('运行') }}
      </el-button>
      <div class="etl-canvas__search">
        <el-input
          v-model="keyword"
          size="small"
          clearable
          :prefix-icon="Search"
          :placeholder="$tr('搜索任务或节点名称')"
          @keydown="onSearchKey"
        />
        <span v-if="keyword.trim()" class="etl-canvas__count">
          {{ matches.length ? `${matchIndex + 1} / ${matches.length}` : $tr('无匹配') }}
        </span>
        <el-button size="small" :icon="ArrowUp" circle :disabled="!matches.length" :title="$tr('上一个')" @click="stepMatch(-1)" />
        <el-button size="small" :icon="ArrowDown" circle :disabled="!matches.length" :title="$tr('下一个')" @click="stepMatch(1)" />
      </div>
    </div>
    <div class="etl-canvas__hint">
      {{ $tr('双击节点编辑；从节点右侧圆点拖到同一任务的另一节点连线；拖动任务标题栏移动整个任务；空白处拖动平移，滚轮缩放。') }}
    </div>
    <div class="etl-canvas__body">
      <div ref="containerRef" class="etl-canvas__graph" tabindex="0" @keydown="onKeydown" @contextmenu.prevent></div>
      <div
        v-if="taskMenu && taskMenuPipeline"
        class="etl-canvas__menu"
        role="menu"
        :style="{ left: `${taskMenu.x}px`, top: `${taskMenu.y}px` }"
        @keydown.esc="closeTaskMenu"
      >
        <div class="etl-canvas__menu-title">{{ taskMenuTitle }}</div>
        <template v-if="taskMenu.kind === 'node'">
          <button type="button" role="menuitem" @click="taskMenuAction('rename')">{{ $tr('改名') }}</button>
          <button type="button" role="menuitem" :disabled="!canMoveMenuNode(-1)" @click="taskMenuAction('moveUp')">{{ $tr('上移') }}</button>
          <button type="button" role="menuitem" :disabled="!canMoveMenuNode(1)" @click="taskMenuAction('moveDown')">{{ $tr('下移') }}</button>
          <button type="button" role="menuitem" class="danger" @click="taskMenuAction('delete')">{{ $tr('删除') }}</button>
        </template>
        <template v-else>
          <button type="button" role="menuitem" @click="taskMenuAction('rename')">{{ $tr('改名') }}</button>
          <button type="button" role="menuitem" @click="taskMenuAction('enable')">
            {{ $tr(taskMenuPipeline.enabled === false ? '启用' : '停用') }}
          </button>
          <button type="button" role="menuitem" :disabled="running" @click="taskMenuAction('run')">{{ $tr('运行任务') }}</button>
          <button type="button" role="menuitem" class="danger" @click="taskMenuAction('delete')">{{ $tr('删除任务') }}</button>
        </template>
      </div>
    </div>
    <el-empty v-if="!pipelines.length" class="etl-canvas__empty" :image-size="60" :description="$tr('还没有任务')" />
  </div>
</template>

<style scoped>
/* 不再用 100vh 估算高度：由父级 flex 撑满剩余空间，底部不留白、不出页面滚动条。 */
.etl-canvas { position: relative; display: flex; flex: 1 1 auto; flex-direction: column; box-sizing: border-box; min-height: 0; height: 100%; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; overflow: hidden; }
.etl-canvas__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--el-border-color-lighter); background: var(--el-bg-color); }
.etl-canvas__toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.etl-canvas__search { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.etl-canvas__search .el-input { width: 220px; }
.etl-canvas__count { min-width: 48px; color: var(--el-text-color-secondary); font-size: 12px; text-align: center; white-space: nowrap; }
.etl-canvas__hint { padding: 4px 10px; color: var(--el-text-color-secondary); font-size: 12px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-extra-light); }
.etl-canvas__body { position: relative; flex: 1; min-height: 0; }
.etl-canvas__graph { position: absolute; inset: 0; outline: none; }
/* 连接点平时隐藏，悬停节点或正在连线时才显示，画面更干净。 */
.etl-canvas__graph :deep(.x6-port-body) { opacity: 0; transition: opacity 0.12s; }
.etl-canvas__graph :deep(.x6-node:hover .x6-port-body),
.etl-canvas__graph :deep(.x6-graph-connecting .x6-port-body),
.etl-canvas__graph :deep(.available .x6-port-body) { opacity: 1; }
.etl-canvas__menu { position: absolute; z-index: 10; display: flex; flex-direction: column; min-width: 140px; max-width: 240px; padding: 4px; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-bg-color-overlay); box-shadow: var(--el-box-shadow-light); }
.etl-canvas__menu-title { padding: 4px 8px 6px; overflow: hidden; color: var(--el-text-color-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--el-border-color-extra-light); margin-bottom: 2px; }
.etl-canvas__menu button { padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-regular); font-size: 13px; text-align: left; cursor: pointer; }
.etl-canvas__menu button:hover:not(:disabled) { background: var(--el-fill-color-light); }
.etl-canvas__menu button:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.etl-canvas__menu button.danger { color: var(--el-color-danger); }
.etl-canvas__empty { position: absolute; inset: 80px 0 0; pointer-events: none; }
</style>