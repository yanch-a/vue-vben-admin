/**
 * ETL 画布模型回归测试：画布看到的节点和连线与任务 JSON 一致，画布上的操作正确写回 JSON。
 *
 * @author yanch
 */
import type { EtlCanvasGroupLayout, EtlCanvasLayoutCache } from './etlCanvasModel';

import type { EtlNode, EtlPipeline } from '#/api/visual/etl';

import { describe, expect, it } from 'vitest';

import {
  connectEtlCanvasNodes,
  disconnectEtlCanvasNodes,
  ETL_CANVAS_GROUP_COLUMN_GAP,
  ETL_CANVAS_GROUP_HEADER,
  ETL_CANVAS_NODE_HEIGHT,
  ETL_CANVAS_NODE_WIDTH,
  etlCanvasEdges,
  etlCanvasLayout,
  etlCanvasSavedPositions,
  etlCanvasWouldCycle,
  etlTaskDependencyEdges,
  etlWorkspaceLayout,
  resetEtlCanvasLayout,
  resetEtlWorkspaceLayout,
  searchEtlCanvas,
  setEtlCanvasOrigin,
  setEtlCanvasPosition,
} from './etlCanvasModel';
import { syncStepDependencies } from './etlModel';
import { createFlexibleExamplePipeline, createOperatorConfig, etlInputReferences } from './etlOperators';

function step(id: string, type: string, config: EtlNode['config']): EtlNode {
  return { id, type, typeVersion: 1, config };
}

/** 参考流程：订单 → 金额转换 → 关联客户（右表）→ 汇总 → 排序，引用连线由 syncStepDependencies 生成。 */
function example(): EtlPipeline {
  const pipeline = createFlexibleExamplePipeline('p');
  for (const node of pipeline.nodes) syncStepDependencies(pipeline, node);
  return pipeline;
}

function pairs(pipeline: EtlPipeline) {
  return etlCanvasEdges(pipeline).map((item) => `${item.source}->${item.target}:${item.kind}`).sort();
}

describe('etlCanvasEdges', () => {
  it('合并 edges[] 和输入引用，同一对节点只画一条线', () => {
    const pipeline = example();
    expect(pairs(pipeline)).toEqual([
      'p-converted->p-joined:reference',
      'p-customers->p-joined:reference',
      'p-grouped->p-sorted:reference',
      'p-joined->p-grouped:reference',
      'p-orders->p-converted:reference',
    ]);
  });

  it('识别 inputStepIds、参数引用、手工连线和停用连线，忽略悬空与自环', () => {
    const pipeline: EtlPipeline = {
      id: 'p', name: 'p', enabled: true, dependsOn: [],
      nodes: [
        step('a', 'database.query', { sql: 'select 1' }),
        step('b', 'database.query', { sql: 'select :x', parameters: [{ name: 'x', stepId: 'a' }] }),
        step('u', 'transform.union', { inputStepIds: ['a', 'b'], schemaMode: 'strict' }),
        step('w', 'database.write', {}),
      ],
      edges: [
        { source: 'u', target: 'w' },
        { source: 'a', target: 'w', enabled: false },
        { source: 'ghost', target: 'w' },
        { source: 'w', target: 'w' },
        { source: 'a', target: 'u', generated: true },
      ],
    } as EtlPipeline;
    expect(pairs(pipeline)).toEqual([
      'a->b:parameter',
      'a->u:reference',
      'a->w:disabled',
      'b->u:reference',
      'u->w:manual',
    ]);
  });
});

describe('etlCanvasLayout', () => {
  it('按依赖最长路径从左到右分列，同列按 JSON 顺序排列', () => {
    const layout = etlCanvasLayout(example());
    expect(layout['p-orders']!.x).toBe(layout['p-customers']!.x);
    expect(layout['p-orders']!.y).toBeLessThan(layout['p-customers']!.y);
    expect(layout['p-converted']!.x).toBeGreaterThan(layout['p-orders']!.x);
    // 关联的右表在第 0 列，但关联本身取最长路径，在转换之后。
    expect(layout['p-joined']!.x).toBeGreaterThan(layout['p-converted']!.x);
    expect(layout['p-sorted']!.x).toBeGreaterThan(layout['p-grouped']!.x);
  });

  it('草稿里暂时有环也不会死循环', () => {
    const pipeline = { id: 'p', nodes: [step('a', 'transform.filter', { inputStepId: 'b' }), step('b', 'transform.filter', { inputStepId: 'a' })], edges: [] } as unknown as EtlPipeline;
    const layout = etlCanvasLayout(pipeline);
    expect(Object.keys(layout).sort()).toEqual(['a', 'b']);
  });
});

describe('节点位置', () => {
  it('保存后布局优先使用保存的位置，新节点避开已占用的位置', () => {
    const pipeline = example();
    const auto = etlCanvasLayout(pipeline);
    setEtlCanvasPosition(pipeline, 'p-sorted', { x: 20.4, y: 10.6 });
    expect(pipeline.ui?.canvas?.positions).toEqual([{ id: 'p-sorted', x: 20, y: 11 }]);
    const layout = etlCanvasLayout(pipeline);
    expect(layout['p-sorted']).toEqual({ x: 20, y: 11 });
    // 订单原本就在 (20,11)，被保存位置占用后向下让开。
    expect(layout['p-orders']!.y).toBeGreaterThan(auto['p-orders']!.y);
  });

  it('位置用数组保存，JSON 往返后可恢复，删除节点后自动清理旧位置', () => {
    const pipeline = example();
    setEtlCanvasPosition(pipeline, 'p-orders', { x: 10, y: 20 });
    setEtlCanvasPosition(pipeline, 'p-sorted', { x: 300, y: 20 });
    const restored = JSON.parse(JSON.stringify(pipeline)) as EtlPipeline;
    expect(etlCanvasSavedPositions(restored)).toEqual({ 'p-orders': { x: 10, y: 20 }, 'p-sorted': { x: 300, y: 20 } });
    restored.nodes = restored.nodes.filter((node) => node.id !== 'p-sorted');
    setEtlCanvasPosition(restored, 'p-orders', { x: 11, y: 20 });
    expect(restored.ui?.canvas?.positions).toEqual([{ id: 'p-orders', x: 11, y: 20 }]);
  });

  it('位置格式不对时忽略，不报错', () => {
    const pipeline = example();
    pipeline.ui = { canvas: { positions: { 'p-orders': { x: 1, y: 2 } } } };
    expect(etlCanvasSavedPositions(pipeline)).toEqual({});
    pipeline.ui = { canvas: { positions: [{ id: 'p-orders', x: 'a', y: 2 }, null] } };
    expect(etlCanvasSavedPositions(pipeline)).toEqual({});
  });

  it('自动布局清掉保存的位置，同时保留 ui 里的其他字段', () => {
    const pipeline = example();
    setEtlCanvasPosition(pipeline, 'p-orders', { x: 10, y: 20 });
    pipeline.ui!.color = 'blue';
    resetEtlCanvasLayout(pipeline);
    expect(pipeline.ui).toEqual({ color: 'blue' });
    const bare = example();
    setEtlCanvasPosition(bare, 'p-orders', { x: 10, y: 20 });
    resetEtlCanvasLayout(bare);
    expect(bare.ui).toBeUndefined();
  });
});

describe('connectEtlCanvasNodes', () => {
  function base(): EtlPipeline {
    return {
      id: 'p', name: 'p', enabled: true, dependsOn: [],
      nodes: [
        step('q1', 'database.query', { sql: 'select 1' }),
        step('q2', 'database.query', { sql: 'select 2' }),
        step('f', 'transform.filter', createOperatorConfig('transform.filter')),
        step('u', 'transform.union', createOperatorConfig('transform.union', 'q1')),
        step('j', 'transform.join', createOperatorConfig('transform.join', 'q1')),
        step('w', 'database.write', { inputStepId: '' }),
      ],
      edges: [],
    } as EtlPipeline;
  }

  it('目标缺输入时填入 inputStepId，并生成引用连线', () => {
    const pipeline = base();
    expect(connectEtlCanvasNodes(pipeline, 'q1', 'f')).toBe('');
    expect(pipeline.nodes[2]!.config.inputStepId).toBe('q1');
    expect(pipeline.edges).toEqual([expect.objectContaining({ source: 'q1', target: 'f', generated: true })]);
  });

  it('合并步骤追加到 inputStepIds，关联步骤填入右表', () => {
    const pipeline = base();
    syncStepDependencies(pipeline, pipeline.nodes[3]!);
    syncStepDependencies(pipeline, pipeline.nodes[4]!);
    expect(connectEtlCanvasNodes(pipeline, 'q2', 'u')).toBe('');
    expect(pipeline.nodes[3]!.config.inputStepIds).toEqual(['q1', 'q2']);
    expect(connectEtlCanvasNodes(pipeline, 'q2', 'j')).toBe('');
    expect(pipeline.nodes[4]!.config.rightStepId).toBe('q2');
    expect(pairs(pipeline)).toContain('q2->j:reference');
  });

  it('输入已满时退回为普通依赖连线，停用的同名连线直接恢复', () => {
    const pipeline = base();
    expect(connectEtlCanvasNodes(pipeline, 'q1', 'q2')).toBe('');
    expect(pipeline.edges).toEqual([{ source: 'q1', sourcePort: 'output', target: 'q2', targetPort: 'input' }]);
    pipeline.edges[0]!.enabled = false;
    expect(connectEtlCanvasNodes(pipeline, 'q1', 'q2')).toBe('');
    expect(pipeline.edges).toHaveLength(1);
    expect(pipeline.edges[0]!.enabled).toBeUndefined();
  });

  it('拒绝自连、重复、循环和不存在的节点', () => {
    const pipeline = base();
    expect(connectEtlCanvasNodes(pipeline, 'f', 'f')).toBe('不能连接到自身');
    expect(connectEtlCanvasNodes(pipeline, 'q1', 'f')).toBe('');
    expect(connectEtlCanvasNodes(pipeline, 'q1', 'f')).toBe('这两个步骤已经连接');
    expect(connectEtlCanvasNodes(pipeline, 'f', 'w')).toBe('');
    expect(etlCanvasWouldCycle(pipeline, 'w', 'q1')).toBe(true);
    expect(connectEtlCanvasNodes(pipeline, 'w', 'q1')).toBe('这条连线会形成循环依赖');
    expect(connectEtlCanvasNodes(pipeline, 'x', 'q1')).toBe('节点不存在');
    expect(pipeline.edges.some((item) => item.target === 'q1')).toBe(false);
  });

  it('参数引用形成的环也会被拒绝', () => {
    const pipeline = base();
    pipeline.nodes[1]!.config.parameters = [{ name: 'x', stepId: 'q1' }];
    expect(connectEtlCanvasNodes(pipeline, 'q2', 'q1')).toBe('这条连线会形成循环依赖');
  });
});

describe('disconnectEtlCanvasNodes', () => {
  it('删除引用连线时清掉 inputStepId / rightStepId / inputStepIds', () => {
    const pipeline = example();
    expect(disconnectEtlCanvasNodes(pipeline, 'p-customers', 'p-joined')).toBe('');
    const joined = pipeline.nodes.find((node) => node.id === 'p-joined')!;
    expect(joined.config.rightStepId).toBe('');
    expect(joined.config.inputStepId).toBe('p-converted');
    expect(pairs(pipeline)).not.toContain('p-customers->p-joined:reference');
    expect(disconnectEtlCanvasNodes(pipeline, 'p-orders', 'p-converted')).toBe('');
    expect(pipeline.nodes.find((node) => node.id === 'p-converted')!.config.inputStepId).toBe('');

    const union: EtlPipeline = { id: 'u', nodes: [step('a', 'database.query', {}), step('b', 'database.query', {}), step('u', 'transform.union', { inputStepIds: ['a', 'b'] })], edges: [] } as unknown as EtlPipeline;
    syncStepDependencies(union, union.nodes[2]!);
    disconnectEtlCanvasNodes(union, 'a', 'u');
    expect(union.nodes[2]!.config.inputStepIds).toEqual(['b']);
    expect(union.edges.map((item) => item.source)).toEqual(['b']);
  });

  it('删除手工连线；参数引用不自动清除并给出提示', () => {
    const pipeline: EtlPipeline = {
      id: 'p', nodes: [step('a', 'database.query', {}), step('b', 'database.query', { parameters: [{ name: 'x', stepId: 'a' }] }), step('c', 'database.query', {})],
      edges: [{ source: 'a', target: 'c' }],
    } as unknown as EtlPipeline;
    syncStepDependencies(pipeline, pipeline.nodes[1]!);
    expect(disconnectEtlCanvasNodes(pipeline, 'a', 'c')).toBe('');
    expect(pairs(pipeline)).toEqual(['a->b:parameter']);
    expect(disconnectEtlCanvasNodes(pipeline, 'a', 'b')).toBe('这条连线来自查询参数，请双击节点修改参数来源');
    expect(pipeline.nodes[1]!.config.parameters).toEqual([{ name: 'x', stepId: 'a' }]);
    expect(pairs(pipeline)).toEqual(['a->b:parameter']);
  });
});

describe('删除节点规则', () => {
  it('仍被引用的节点不能删（与 index.vue removeStep 判断一致），删除后画布不残留悬空连线', () => {
    const pipeline = example();
    const referenced = (id: string) => pipeline.nodes.some((node) => etlInputReferences(node.config).includes(id));
    expect(referenced('p-customers')).toBe(true);
    expect(referenced('p-sorted')).toBe(false);
    pipeline.nodes = pipeline.nodes.filter((node) => node.id !== 'p-sorted');
    pipeline.edges = pipeline.edges.filter((item) => item.source !== 'p-sorted' && item.target !== 'p-sorted');
    expect(pairs(pipeline).some((item) => item.includes('p-sorted'))).toBe(false);
    expect(Object.keys(etlCanvasLayout(pipeline))).not.toContain('p-sorted');
  });
});

describe('工作区画布', () => {
  function workspace(): EtlPipeline[] {
    const first = example();
    first.name = '订单汇总';
    const second = createFlexibleExamplePipeline('q');
    second.name = 'Customer Sync';
    for (const node of second.nodes) syncStepDependencies(second, node);
    second.dependsOn = ['p', 'missing', 'q'];
    const empty = { id: 'e', name: '空任务', enabled: true, dependsOn: [], nodes: [], edges: [] } as unknown as EtlPipeline;
    return [first, second, empty];
  }
  const overlap = (a: EtlCanvasGroupLayout, b: EtlCanvasGroupLayout) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('每个任务一个分组，分组互不重叠，节点都在自己的分组框内', () => {
    const pipelines = workspace();
    const layout = etlWorkspaceLayout(pipelines);
    expect(Object.keys(layout)).toEqual(['p', 'q', 'e']);
    const groups = Object.values(layout);
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) expect(overlap(groups[i]!, groups[j]!)).toBe(false);
    for (const pipeline of pipelines) {
      const group = layout[pipeline.id]!;
      for (const node of pipeline.nodes) {
        const point = group.nodes[node.id]!;
        expect(point.x).toBeGreaterThanOrEqual(group.x);
        expect(point.y).toBeGreaterThanOrEqual(group.y + ETL_CANVAS_GROUP_HEADER);
        expect(point.x + ETL_CANVAS_NODE_WIDTH).toBeLessThanOrEqual(group.x + group.width);
        expect(point.y + ETL_CANVAS_NODE_HEIGHT).toBeLessThanOrEqual(group.y + group.height);
      }
    }
    expect(layout.e!.width).toBeGreaterThan(0);
  });

  it('拖动分组只改原点，节点相对位置不变；未保存位置的分组排在已放好的分组下方', () => {
    const pipelines = workspace();
    const before = etlWorkspaceLayout(pipelines);
    setEtlCanvasOrigin(pipelines[1]!, { x: before.q!.origin.x + 500, y: before.q!.origin.y + 30 });
    expect(pipelines[1]!.ui?.canvas?.origin).toEqual({ x: before.q!.origin.x + 500, y: before.q!.origin.y + 30 });
    const after = etlWorkspaceLayout(pipelines);
    const id = pipelines[1]!.nodes[0]!.id;
    expect(after.q!.nodes[id]!.x - before.q!.nodes[id]!.x).toBe(500);
    expect(after.q!.nodes[id]!.y - before.q!.nodes[id]!.y).toBe(30);
    expect(after.p!.y).toBeGreaterThanOrEqual(after.q!.y + after.q!.height);
    expect(overlap(after.e!, after.p!)).toBe(false);
    expect(overlap(after.e!, after.q!)).toBe(false);
    // 原点和节点位置在 JSON 往返后仍然有效。
    const restored = JSON.parse(JSON.stringify(pipelines)) as EtlPipeline[];
    expect(etlWorkspaceLayout(restored).q).toEqual(after.q);
  });

  it('全部自动布局清掉分组原点和节点位置', () => {
    const pipelines = workspace();
    setEtlCanvasOrigin(pipelines[0]!, { x: 900, y: 900 });
    setEtlCanvasPosition(pipelines[0]!, 'p-orders', { x: 1, y: 1 });
    resetEtlWorkspaceLayout(pipelines);
    expect(pipelines[0]!.ui).toBeUndefined();
    expect(etlWorkspaceLayout(pipelines).p!.y).toBe(0);
  });

  // 布局缓存：第一次算出的位置保持稳定，拖动 / 新增只影响自己，"自动布局"才重排。
  const stable = (layout: Record<string, EtlCanvasGroupLayout>) =>
    Object.fromEntries(Object.values(layout).map((group) => [group.pipelineId, { x: group.x, y: group.y, nodes: group.nodes }]));

  it('拖动一个分组，其他分组和节点的位置都不变', () => {
    const pipelines = [...workspace(), ...workspace().map((item) => ({ ...item, id: `${item.id}2` }))];
    const cache: EtlCanvasLayoutCache = new Map();
    const before = stable(etlWorkspaceLayout(pipelines, cache));
    setEtlCanvasOrigin(pipelines[0]!, { x: 3000, y: 3000 });
    const after = stable(etlWorkspaceLayout(pipelines, cache));
    for (const pipeline of pipelines.slice(1)) expect(after[pipeline.id]).toEqual(before[pipeline.id]);
    expect(after.p!.x).not.toBe(before.p!.x);
    // 撤销（去掉保存的原点）回到原来的位置。
    resetEtlWorkspaceLayout([pipelines[0]!]);
    expect(stable(etlWorkspaceLayout(pipelines, cache))).toEqual(before);
  });

  it('拖动一个节点，同一任务里的其他节点和其他分组都不动', () => {
    const pipelines = workspace();
    const cache: EtlCanvasLayoutCache = new Map();
    const before = etlWorkspaceLayout(pipelines, cache);
    const moved = pipelines[1]!.nodes[0]!.id;
    setEtlCanvasPosition(pipelines[1]!, moved, { x: 900, y: 600 });
    const after = etlWorkspaceLayout(pipelines, cache);
    for (const node of pipelines[1]!.nodes) {
      if (node.id !== moved) expect(after.q!.nodes[node.id]).toEqual(before.q!.nodes[node.id]);
    }
    expect(after.p).toEqual(before.p);
    expect({ x: after.e!.x, y: after.e!.y }).toEqual({ x: before.e!.x, y: before.e!.y });
  });

  it('新增任务放到空位，不移动已有分组；自动布局清缓存后重新排版', () => {
    const pipelines = workspace();
    const cache: EtlCanvasLayoutCache = new Map();
    const before = stable(etlWorkspaceLayout(pipelines, cache));
    const added = createFlexibleExamplePipeline('n');
    pipelines.push(added);
    const after = etlWorkspaceLayout(pipelines, cache);
    for (const id of ['p', 'q', 'e']) expect(stable(after)[id]).toEqual(before[id]);
    for (const id of ['p', 'q', 'e']) expect(overlap(after.n!, after[id]!)).toBe(false);
    setEtlCanvasOrigin(pipelines[0]!, { x: 5000, y: 5000 });
    etlWorkspaceLayout(pipelines, cache);
    cache.clear();
    resetEtlWorkspaceLayout(pipelines);
    const repacked = etlWorkspaceLayout(pipelines, cache);
    expect(repacked.p!.x).toBe(0);
    expect(repacked.p!.y).toBe(0);
  });

  it('上百个任务铺成接近屏幕比例的多行多列，互不重叠，并且足够快', () => {
    const many: EtlPipeline[] = [];
    for (let i = 0; i < 300; i++) {
      const pipeline = createFlexibleExamplePipeline(`t${i}`);
      pipeline.nodes = pipeline.nodes.slice(0, 1 + (i % 6));
      for (const node of pipeline.nodes) syncStepDependencies(pipeline, node);
      many.push(pipeline);
    }
    const started = performance.now();
    const layout = etlWorkspaceLayout(many);
    const elapsed = performance.now() - started;
    const groups = Object.values(layout);
    expect(groups).toHaveLength(300);
    const columns = new Set(groups.map((item) => item.x));
    const rows = new Set(groups.map((item) => item.y));
    expect(columns.size).toBeGreaterThan(5);
    expect(rows.size).toBeGreaterThan(5);
    const width = Math.max(...groups.map((item) => item.x + item.width));
    const height = Math.max(...groups.map((item) => item.y + item.height));
    expect(width / height).toBeGreaterThan(0.8);
    expect(width / height).toBeLessThan(4);
    // 按行扫描检查重叠：同一行内相邻不重叠，行与行之间不交叠。
    const sorted = [...groups].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j]!.y < sorted[i]!.y + sorted[i]!.height; j++) {
        expect(overlap(sorted[i]!, sorted[j]!)).toBe(false);
      }
    }
    expect(elapsed).toBeLessThan(500);
    const searchStarted = performance.now();
    expect(searchEtlCanvas(many, '订单')).toHaveLength(300);
    expect(performance.now() - searchStarted).toBeLessThan(200);
  });

  it('任务依赖只连存在的任务，忽略自身和重复', () => {
    expect(etlTaskDependencyEdges(workspace())).toEqual([{ source: 'p', target: 'q' }]);
  });

  it('按任务名或节点名搜索，不区分大小写，空关键词无结果', () => {
    const pipelines = workspace();
    expect(searchEtlCanvas(pipelines, '  ')).toEqual([]);
    expect(searchEtlCanvas(pipelines, 'CUSTOMER')).toEqual([{ kind: 'group', pipelineId: 'q' }]);
    expect(searchEtlCanvas(pipelines, '客户样例').map((item) => item.nodeId)).toEqual(['p-customers', 'q-customers']);
    expect(searchEtlCanvas(pipelines, '订单').map((item) => `${item.kind}:${item.nodeId || item.pipelineId}`)).toEqual([
      'group:p',
      'node:p-orders',
      'node:q-orders',
    ]);
    expect(searchEtlCanvas(pipelines, 'SQL 查询', () => 'SQL 查询')).toHaveLength(12);
  });
});

describe('自动布局分组水平间距', () => {
  it('并排分组之间至少留出 ETL_CANVAS_GROUP_COLUMN_GAP', () => {
    expect(ETL_CANVAS_GROUP_COLUMN_GAP).toBeGreaterThanOrEqual(48);
  });
});
