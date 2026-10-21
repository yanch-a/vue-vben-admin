/**
 * ETL 画布模型：把任务 JSON（nodes / edges / 输入引用）换算成画布上的节点和连线，
 * 画布上的连线、断开和拖动位置也只通过这里写回同一份任务 JSON。
 *
 * <p>连线来源有两种：edges 中保存的连线，以及 config 里的输入引用
 * （inputStepId / rightStepId / inputStepIds / parameters[].stepId）。
 * 两者在画布上合并为一条线；引用连线删除时同步清掉对应的引用字段。</p>
 *
 * <p>节点位置保存在 pipeline.ui.canvas.positions，格式为 [{ id, x, y }]。用数组而不是以节点 id 为键的对象，
 * 避免节点 id 恰好叫 token / password 时被后端的敏感字段扫描误拦。</p>
 *
 * @author yanch
 */
import type { EtlEdge, EtlNode, EtlPipeline } from '#/api/visual/etl';

import { syncStepDependencies } from './etlModel';
import { etlInputReferences } from './etlOperators';

// 紧凑尺寸：上百个任务也能在一屏里看出整体结构。
export const ETL_CANVAS_NODE_WIDTH = 148;
export const ETL_CANVAS_NODE_HEIGHT = 30;
const COLUMN_GAP = 178;
const ROW_GAP = 40;

export type EtlCanvasEdgeKind = 'disabled' | 'manual' | 'parameter' | 'reference';

export interface EtlCanvasEdge {
  id: string;
  kind: EtlCanvasEdgeKind;
  source: string;
  target: string;
}

export interface EtlCanvasPoint {
  x: number;
  y: number;
}

/** 节点类别决定画布配色：读取 / 转换 / 写入。 */
export function etlCanvasCategory(type: string): 'source' | 'transform' | 'write' {
  if (['database.query', 'database.table.read', 'source.inline'].includes(type)) return 'source';
  if (['database.table.write', 'database.upsert', 'database.write'].includes(type)) return 'write';
  return 'transform';
}

function edgeKey(source: string, target: string) {
  return `${source}->${target}`;
}

/** 合并保存的连线和输入引用，同一对节点只画一条线。 */
export function etlCanvasEdges(pipeline: EtlPipeline): EtlCanvasEdge[] {
  const ids = new Set(pipeline.nodes.map((node) => node.id));
  const result = new Map<string, EtlCanvasEdge>();
  for (const node of pipeline.nodes) {
    const parameterRefs = new Set<string>(
      (node.config?.parameters || [])
        .map((parameter: any) => parameter?.stepId)
        .filter((value: unknown): value is string => typeof value === 'string'),
    );
    for (const ref of etlInputReferences(node.config || {})) {
      if (!ids.has(ref) || ref === node.id) continue;
      const directInput = [node.config?.inputStepId, node.config?.rightStepId, ...(node.config?.inputStepIds || [])].includes(ref);
      result.set(edgeKey(ref, node.id), {
        id: edgeKey(ref, node.id),
        kind: directInput || !parameterRefs.has(ref) ? 'reference' : 'parameter',
        source: ref,
        target: node.id,
      });
    }
  }
  for (const item of pipeline.edges || []) {
    if (!ids.has(item.source) || !ids.has(item.target) || item.source === item.target) continue;
    const key = edgeKey(item.source, item.target);
    if (result.has(key)) continue;
    result.set(key, {
      id: key,
      kind: item.enabled === false ? 'disabled' : 'manual',
      source: item.source,
      target: item.target,
    });
  }
  return [...result.values()];
}

/** 读取保存的节点位置。 */
export function etlCanvasSavedPositions(pipeline: EtlPipeline): Record<string, EtlCanvasPoint> {
  const positions = pipeline.ui?.canvas?.positions;
  const result: Record<string, EtlCanvasPoint> = {};
  if (Array.isArray(positions)) {
    for (const item of positions) {
      if (item && typeof item.id === 'string' && Number.isFinite(item.x) && Number.isFinite(item.y)) result[item.id] = { x: item.x, y: item.y };
    }
  }
  return result;
}

/**
 * 分层自动布局：按依赖的最长路径分列，从左到右；同列按 JSON 中的步骤顺序排列。
 * 已保存位置的节点保持原位，新节点取自动布局位置并避开已占用的位置。
 */
export function etlCanvasLayout(
  pipeline: EtlPipeline,
  edges = etlCanvasEdges(pipeline),
  cached?: Record<string, EtlCanvasPoint>,
): Record<string, EtlCanvasPoint> {
  const order = new Map(pipeline.nodes.map((node, index) => [node.id, index]));
  const incoming = new Map<string, string[]>();
  for (const node of pipeline.nodes) incoming.set(node.id, []);
  for (const item of edges) if (item.kind !== 'disabled') incoming.get(item.target)?.push(item.source);
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    // 草稿可能暂时有环，遇到环按 0 处理，避免死循环。
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) || [];
    const value = parents.length ? Math.max(...parents.map((parent) => rankOf(parent) + 1)) : 0;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  const columns = new Map<number, EtlNode[]>();
  for (const node of pipeline.nodes) {
    const column = rankOf(node.id);
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column)!.push(node);
  }
  const auto: Record<string, EtlCanvasPoint> = {};
  for (const [column, nodes] of columns) {
    nodes.sort((left, right) => (order.get(left.id) || 0) - (order.get(right.id) || 0));
    nodes.forEach((node, index) => {
      auto[node.id] = { x: column * COLUMN_GAP, y: index * ROW_GAP };
    });
  }
  const saved = etlCanvasSavedPositions(pipeline);
  const result: Record<string, EtlCanvasPoint> = {};
  const occupied: EtlCanvasPoint[] = [];
  for (const node of pipeline.nodes) {
    // 已保存的位置优先，其次是本次会话里已经算出来的位置（布局缓存），保证位置稳定。
    const point = saved[node.id] || cached?.[node.id];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      result[node.id] = { x: point.x, y: point.y };
      occupied.push(result[node.id]!);
    }
  }
  for (const node of pipeline.nodes) {
    if (result[node.id]) continue;
    const point = { ...auto[node.id]! };
    while (occupied.some((item) => Math.abs(item.x - point.x) < ETL_CANVAS_NODE_WIDTH && Math.abs(item.y - point.y) < ETL_CANVAS_NODE_HEIGHT + 10)) {
      point.y += ROW_GAP;
    }
    result[node.id] = point;
    occupied.push(point);
  }
  return result;
}

/** 拖动结束后保存位置，同时清理已删除节点的旧位置。 */
export function setEtlCanvasPosition(pipeline: EtlPipeline, id: string, point: EtlCanvasPoint): void {
  const ids = new Set(pipeline.nodes.map((node) => node.id));
  const saved = etlCanvasSavedPositions(pipeline);
  saved[id] = { x: Math.round(point.x), y: Math.round(point.y) };
  const positions = pipeline.nodes.filter((node) => ids.has(node.id) && saved[node.id]).map((node) => ({ id: node.id, ...saved[node.id]! }));
  const current = etlCanvasSavedPositions(pipeline)[id];
  // 位置没变时不写 JSON，避免无意义的重绘和草稿变更。
  if (current && current.x === saved[id].x && current.y === saved[id].y) return;
  pipeline.ui = { ...pipeline.ui, canvas: { ...pipeline.ui?.canvas, positions } };
}

/** 自动布局：清掉保存的位置，全部按依赖重新排列。 */
export function resetEtlCanvasLayout(pipeline: EtlPipeline): void {
  if (!pipeline.ui?.canvas) return;
  const canvas = { ...pipeline.ui.canvas };
  delete canvas.positions;
  const ui = { ...pipeline.ui, canvas };
  if (!Object.keys(canvas).length) delete (ui as Record<string, any>).canvas;
  pipeline.ui = ui;
  if (!Object.keys(ui).length) delete pipeline.ui;
}

/** 加这条线后是否会形成环（含输入引用）。 */
export function etlCanvasWouldCycle(pipeline: EtlPipeline, source: string, target: string): boolean {
  const next = new Map<string, string[]>();
  for (const item of etlCanvasEdges(pipeline)) {
    if (item.kind === 'disabled') continue;
    if (!next.has(item.source)) next.set(item.source, []);
    next.get(item.source)!.push(item.target);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) || []));
  }
  return false;
}

/**
 * 画布连线：目标节点还缺输入时直接写成输入引用（inputStepId / inputStepIds / 关联右表），
 * 否则保存为普通依赖连线（只决定执行顺序）。返回错误文案，成功返回空串。
 */
export function connectEtlCanvasNodes(pipeline: EtlPipeline, source: string, target: string): string {
  const targetNode = pipeline.nodes.find((node) => node.id === target);
  if (!targetNode || !pipeline.nodes.some((node) => node.id === source)) return '节点不存在';
  if (source === target) return '不能连接到自身';
  if (etlCanvasEdges(pipeline).some((item) => item.source === source && item.target === target && item.kind !== 'disabled')) {
    return '这两个步骤已经连接';
  }
  if (etlCanvasWouldCycle(pipeline, source, target)) return '这条连线会形成循环依赖';
  const config = targetNode.config || (targetNode.config = {});
  if (Object.hasOwn(config, 'inputStepId') && !config.inputStepId) {
    config.inputStepId = source;
  } else if (Array.isArray(config.inputStepIds)) {
    config.inputStepIds.push(source);
  } else if (targetNode.type === 'transform.join' && !config.rightStepId) {
    config.rightStepId = source;
  } else {
    // 已停用的同名连线直接恢复，避免重复。
    const disabled = pipeline.edges.find((item) => item.source === source && item.target === target);
    if (disabled) delete disabled.enabled;
    else pipeline.edges.push(manualEdge(source, target));
  }
  syncStepDependencies(pipeline, targetNode);
  return '';
}

/**
 * 删除画布连线：去掉保存的连线并清掉对应的输入引用。
 * 查询参数引用会影响 SQL，不自动清除，返回提示让用户在节点里修改。
 */
export function disconnectEtlCanvasNodes(pipeline: EtlPipeline, source: string, target: string): string {
  const targetNode = pipeline.nodes.find((node) => node.id === target);
  pipeline.edges = (pipeline.edges || []).filter((item) => item.source !== source || item.target !== target);
  if (!targetNode) return '';
  const config = targetNode.config || {};
  if (config.inputStepId === source) config.inputStepId = '';
  if (config.rightStepId === source) config.rightStepId = '';
  if (Array.isArray(config.inputStepIds)) config.inputStepIds = config.inputStepIds.filter((id: unknown) => id !== source);
  syncStepDependencies(pipeline, targetNode);
  const parameterRef = (config.parameters || []).some((parameter: any) => parameter?.stepId === source);
  return parameterRef ? '这条连线来自查询参数，请双击节点修改参数来源' : '';
}

function manualEdge(source: string, target: string): EtlEdge {
  return { source, sourcePort: 'output', target, targetPort: 'input' };
}

// ---------------------------------------------------------------------------
// 工作区画布：一个画布显示全部任务，每个任务是一个分组框，框内是它自己的节点和连线。
// 节点位置相对于任务分组的原点保存（pipeline.ui.canvas.positions），分组原点保存在
// pipeline.ui.canvas.origin。都只有 x / y / id 字段，不会碰到后端的敏感字段扫描。
// ---------------------------------------------------------------------------

export const ETL_CANVAS_GROUP_PADDING = 8;
export const ETL_CANVAS_GROUP_HEADER = 18;
export const ETL_CANVAS_GROUP_GAP = 16;
/** 自动布局时并排任务分组之间的水平间距（比行距更宽，便于区分） */
export const ETL_CANVAS_GROUP_COLUMN_GAP = 48;
const ETL_CANVAS_GROUP_MIN_WIDTH = 164;
/** 自动排版的目标宽高比，接近常见屏幕。 */
const ETL_CANVAS_ASPECT = 16 / 9;

export interface EtlCanvasGroupLayout {
  height: number;
  /** 节点绝对坐标。 */
  nodes: Record<string, EtlCanvasPoint>;
  /** 分组原点：节点绝对坐标 = 原点 + 相对坐标。 */
  origin: EtlCanvasPoint;
  pipelineId: string;
  width: number;
  x: number;
  y: number;
}

/** 读取保存的分组原点。 */
export function etlCanvasOrigin(pipeline: EtlPipeline): EtlCanvasPoint | undefined {
  const origin = pipeline.ui?.canvas?.origin;
  return origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) ? { x: origin.x, y: origin.y } : undefined;
}

/** 拖动任务分组后保存原点；没变时不写。 */
export function setEtlCanvasOrigin(pipeline: EtlPipeline, point: EtlCanvasPoint): void {
  const origin = { x: Math.round(point.x), y: Math.round(point.y) };
  const current = etlCanvasOrigin(pipeline);
  if (current && current.x === origin.x && current.y === origin.y) return;
  pipeline.ui = { ...pipeline.ui, canvas: { ...pipeline.ui?.canvas, origin } };
}

/** 清掉全部任务的分组位置和节点位置，整张画布重新排列。 */
export function resetEtlWorkspaceLayout(pipelines: EtlPipeline[]): void {
  for (const pipeline of pipelines) {
    resetEtlCanvasLayout(pipeline);
    if (pipeline.ui?.canvas?.origin) {
      const canvas = { ...pipeline.ui.canvas };
      delete canvas.origin;
      const ui = { ...pipeline.ui, canvas };
      if (!Object.keys(canvas).length) delete (ui as Record<string, any>).canvas;
      pipeline.ui = ui;
      if (!Object.keys(ui).length) delete pipeline.ui;
    }
  }
}

/**
 * 整个工作区的布局：每个任务内部先按依赖自动布局，再把任务分组按"货架"方式铺开：
 * 一行放满（行宽按全部分组面积和屏幕宽高比估算）就换下一行，上百个任务也排成接近屏幕比例的矩形。
 * 保存过原点的分组留在原位，其余分组铺在已占用区域的下方，互不重叠。复杂度 O(任务数 + 节点数)。
 */
/**
 * 客户端布局缓存：记录第一次自动排版得到的、尚未保存到 JSON 的分组原点和节点位置。
 * 有了它，拖动一个元素只会保存这个元素，其余元素保持原地，不会重新排版；
 * 缓存不写入 JSON，所以打开工作区不会变成"未保存"。只有点击"自动布局"才清空重排。
 */
export type EtlCanvasLayoutCache = Map<string, { nodes: Record<string, EtlCanvasPoint>; origin?: EtlCanvasPoint }>;

export function etlWorkspaceLayout(pipelines: EtlPipeline[], cache?: EtlCanvasLayoutCache): Record<string, EtlCanvasGroupLayout> {
  if (cache) {
    const ids = new Set(pipelines.map((pipeline) => pipeline.id));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  }
  const result: Record<string, EtlCanvasGroupLayout> = {};
  const pending: { box: { height: number; width: number; x: number; y: number }; pipeline: EtlPipeline; relative: Record<string, EtlCanvasPoint> }[] = [];
  let bottom = 0;
  let placed = false;
  for (const pipeline of pipelines) {
    const entry = cache?.get(pipeline.id);
    const relative = etlCanvasLayout(pipeline, undefined, entry?.nodes);
    if (cache) {
      // 只缓存没有保存位置的节点：撤销拖动时能回到原来的自动位置。
      const saved = etlCanvasSavedPositions(pipeline);
      const nodes: Record<string, EtlCanvasPoint> = {};
      for (const [id, point] of Object.entries(relative)) nodes[id] = saved[id] ? entry?.nodes[id] || point : point;
      cache.set(pipeline.id, { nodes, origin: entry?.origin });
    }
    const points = Object.values(relative);
    const minX = points.length ? Math.min(...points.map((item) => item.x)) : 0;
    const minY = points.length ? Math.min(...points.map((item) => item.y)) : 0;
    const maxX = points.length ? Math.max(...points.map((item) => item.x)) + ETL_CANVAS_NODE_WIDTH : ETL_CANVAS_NODE_WIDTH;
    const maxY = points.length ? Math.max(...points.map((item) => item.y)) + ETL_CANVAS_NODE_HEIGHT : ETL_CANVAS_NODE_HEIGHT;
    // 分组框相对原点的矩形，留出标题栏和内边距。
    const box = {
      x: minX - ETL_CANVAS_GROUP_PADDING,
      y: minY - ETL_CANVAS_GROUP_PADDING - ETL_CANVAS_GROUP_HEADER,
      width: Math.max(maxX - minX + ETL_CANVAS_GROUP_PADDING * 2, ETL_CANVAS_GROUP_MIN_WIDTH),
      height: maxY - minY + ETL_CANVAS_GROUP_PADDING * 2 + ETL_CANVAS_GROUP_HEADER,
    };
    const origin = etlCanvasOrigin(pipeline) || entry?.origin;
    if (!origin) {
      pending.push({ box, pipeline, relative });
      continue;
    }
    result[pipeline.id] = group(pipeline.id, origin, box, relative);
    bottom = Math.max(bottom, result[pipeline.id]!.y + result[pipeline.id]!.height);
    placed = true;
  }
  if (!pending.length) return result;
  let area = 0;
  let widest = 0;
  for (const { box } of pending) {
    area += (box.width + ETL_CANVAS_GROUP_COLUMN_GAP) * (box.height + ETL_CANVAS_GROUP_GAP);
    widest = Math.max(widest, box.width);
  }
  const rowWidth = Math.max(widest, Math.sqrt(area * ETL_CANVAS_ASPECT));
  let x = 0;
  let y = placed ? bottom + ETL_CANVAS_GROUP_GAP : 0;
  let rowHeight = 0;
  for (const { box, pipeline, relative } of pending) {
    if (x > 0 && x + box.width > rowWidth) {
      x = 0;
      y += rowHeight + ETL_CANVAS_GROUP_GAP;
      rowHeight = 0;
    }
    result[pipeline.id] = group(pipeline.id, { x: x - box.x, y: y - box.y }, box, relative);
    const entry = cache?.get(pipeline.id);
    if (entry) entry.origin = result[pipeline.id]!.origin;
    x += box.width + ETL_CANVAS_GROUP_COLUMN_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  }
  return result;
}

function group(
  pipelineId: string,
  origin: EtlCanvasPoint,
  box: { height: number; width: number; x: number; y: number },
  relative: Record<string, EtlCanvasPoint>,
): EtlCanvasGroupLayout {
  const nodes: Record<string, EtlCanvasPoint> = {};
  for (const [id, point] of Object.entries(relative)) nodes[id] = { x: origin.x + point.x, y: origin.y + point.y };
  return { pipelineId, origin, nodes, x: origin.x + box.x, y: origin.y + box.y, width: box.width, height: box.height };
}

/** 任务之间的依赖（dependsOn），画成分组之间的虚线，只读。 */
export function etlTaskDependencyEdges(pipelines: EtlPipeline[]): { source: string; target: string }[] {
  const ids = new Set(pipelines.map((item) => item.id));
  const result: { source: string; target: string }[] = [];
  for (const pipeline of pipelines) {
    for (const dep of new Set(pipeline.dependsOn || [])) {
      if (dep !== pipeline.id && ids.has(dep)) result.push({ source: dep, target: pipeline.id });
    }
  }
  return result;
}

export interface EtlCanvasMatch {
  kind: 'group' | 'node';
  nodeId?: string;
  pipelineId: string;
}

/** 按任务名称或节点名称搜索，不区分大小写；结果按任务顺序，任务本身在它的节点之前。 */
export function searchEtlCanvas(pipelines: EtlPipeline[], query: string, titleOf: (node: EtlNode) => string = (node) => node.name || node.type): EtlCanvasMatch[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return [];
  const hit = (...values: (string | undefined)[]) => values.some((value) => (value || '').toLocaleLowerCase().includes(keyword));
  const result: EtlCanvasMatch[] = [];
  for (const pipeline of pipelines) {
    if (hit(pipeline.name)) result.push({ kind: 'group', pipelineId: pipeline.id });
    for (const node of pipeline.nodes) {
      if (hit(node.name, titleOf(node))) result.push({ kind: 'node', pipelineId: pipeline.id, nodeId: node.id });
    }
  }
  return result;
}