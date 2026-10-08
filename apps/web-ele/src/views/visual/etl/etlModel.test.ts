/**
 * ETL 三种编辑模式共享模型的基础回归测试。
 *
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import {
  createSimplePipeline,
  insertTransform,
  removeNodeFromGraph,
  sourceNode,
  targetNode,
  createSqlPipeline,
  syncStepDependencies,
  appendImportedPipelines,
  createWorkspaceDocument,
  normalizeSqlDocument,
} from './etlModel';

describe('etlModel', () => {
  it('uses page size instead of total row cap and defaults to 2000 rows per batch', () => {
    const document = createWorkspaceDocument('1', '分页');
    document.pipelines.push(createSqlPipeline(['a', 'b']));
    const task = document.pipelines[0]!;
    expect(task.name).toBe('数据同步');
    expect(task.nodes[0]!.name).toBe('源数据');
    expect(task.nodes[0]!.config.pageSize).toBe(50000);
    expect(task.nodes[1]!.config.batchSize).toBe(2000);
    delete task.nodes[0]!.config.pageSize;
    task.nodes[0]!.config.maxRows = 1000;
    const migrated = normalizeSqlDocument(document).pipelines[0]!.nodes[0]!;
    expect(migrated.config.pageSize).toBe(1000);
    expect(migrated.config.maxRows).toBeUndefined();
    expect(task.nodes[0]!.config.maxRows).toBe(1000);
  });
  it('appends imports using explicit authorized aliases without overwriting existing tasks', () => {
    const current = createWorkspaceDocument('1', '当前');
    current.resources.a = {
      kind: 'database',
      bindingRef: 'local.a',
      instance: 'sales',
    };
    current.pipelines.push(createSqlPipeline(['a']));
    const imported = createWorkspaceDocument('imported', '导入');
    imported.resources.legacy = { kind: 'database', bindingRef: 'legacy' };
    imported.pipelines.push(createSqlPipeline(['legacy']));
    const next = appendImportedPipelines(current, imported, { legacy: 'a' });
    expect(next.pipelines).toHaveLength(2);
    expect(
      next.pipelines[1]?.nodes.every((step) => step.resourceRef === 'a'),
    ).toBe(true);
    expect(Object.keys(next.resources)).toEqual(['a']);
    expect(current.pipelines).toHaveLength(1);
    expect(() => appendImportedPipelines(current, imported, {})).toThrow(
      '请为每个导入连接',
    );
  });
  it('builds B condition → A join → B write without separate datasource steps', () => {
    const pipeline = createSqlPipeline(['a', 'b'], true);
    expect(pipeline.nodes.map((node) => node.resourceRef)).toEqual([
      'b',
      'a',
      'b',
    ]);
    expect(pipeline.nodes.map((node) => node.type)).toEqual([
      'database.query',
      'database.query',
      'database.write',
    ]);
    expect(pipeline.nodes[1]?.config.parameters[0].stepId).toBe(
      pipeline.nodes[0]?.id,
    );
    expect(pipeline.nodes[1]?.config.sql).toContain('JOIN customers');
    expect(pipeline.nodes[2]?.config.inputStepId).toBe(pipeline.nodes[1]?.id);
    expect(pipeline.edges).toHaveLength(2);
  });

  it('rebuilds generated dependencies while preserving manually configured edges', () => {
    const pipeline = createSqlPipeline(['a', 'b'], true);
    const join = pipeline.nodes[1]!;
    pipeline.edges.push({ source: 'custom', target: join.id });
    join.config.parameters = [];
    syncStepDependencies(pipeline, join);
    expect(
      pipeline.edges.some(
        (edge) =>
          edge.source === pipeline.nodes[0]?.id && edge.target === join.id,
      ),
    ).toBe(false);
    expect(pipeline.edges).toContainEqual({
      source: 'custom',
      target: join.id,
    });
  });
  it('creates a runnable source-to-target pipeline', () => {
    const pipeline = createSimplePipeline('订单同步');
    expect(sourceNode(pipeline)?.type).toBe('database.table.read');
    expect(targetNode(pipeline)?.type).toBe('database.table.write');
    expect(pipeline.edges).toHaveLength(1);
  });

  it('inserts transformations before the target without rebuilding unrelated edges', () => {
    const pipeline = createSimplePipeline();
    const transform = insertTransform(pipeline, 'transform.filter', '过滤');
    expect(pipeline.nodes[1]?.id).toBe(transform.id);
    expect(pipeline.edges).toHaveLength(2);
    expect(pipeline.edges.some((edge) => edge.target === transform.id)).toBe(
      true,
    );
    expect(pipeline.edges.some((edge) => edge.source === transform.id)).toBe(
      true,
    );
  });

  it('removes one graph node while preserving predecessor and successor branches', () => {
    const pipeline = createSimplePipeline();
    const transform = insertTransform(pipeline, 'transform.filter', '过滤');
    const sourceId = sourceNode(pipeline)!.id;
    const targetId = targetNode(pipeline)!.id;

    removeNodeFromGraph(pipeline, transform.id);

    expect(pipeline.nodes.some((node) => node.id === transform.id)).toBe(false);
    expect(pipeline.edges).toContainEqual({
      source: sourceId,
      sourcePort: 'output',
      target: targetId,
      targetPort: 'input',
    });
  });
});
