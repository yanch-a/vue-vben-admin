/**
 * ETL 三种编辑模式共享模型的基础回归测试。
 *
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import {
  ETL_AI_JSON_LIMIT,
  buildAiWorkspace,
  sameEtlValue,
  createSimplePipeline,
  insertTransform,
  insertPipelineNode,
  movePipelineNode,
  buildSameNameMappings,
  mergeAiPipelineEdit,
  restoreSavedPipeline,
  pipelineEditJson,
  removeNodeFromGraph,
  sourceNode,
  targetNode,
  createSqlPipeline,
  duplicatePipeline,
  syncStepDependencies,
  appendImportedPipelines,
  createWorkspaceDocument,
  normalizeSqlDocument,
} from './etlModel';
import { etlInputReferences } from './etlOperators';

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


  it('moves a step in the pipeline list and inserts between selected and write', () => {
    const pipeline = createSqlPipeline(['a']);
    const query = pipeline.nodes[0]!;
    const write = pipeline.nodes[1]!;
    expect(movePipelineNode(pipeline, write.id, -1)).toBe(true);
    expect(pipeline.nodes.map((item) => item.id)).toEqual([write.id, query.id]);
    expect(movePipelineNode(pipeline, write.id, -1)).toBe(false);
    // restore query then write
    movePipelineNode(pipeline, query.id, -1);
    const transform: any = {
      id: 'transform_mid',
      name: '字段处理',
      type: 'transform.select',
      typeVersion: 1,
      config: { inputStepId: '', fields: [], keepUnspecified: true, removeFields: [] },
    };
    insertPipelineNode(pipeline, transform, write.id);
    expect(pipeline.nodes.map((item) => item.type)).toEqual([
      'database.query',
      'transform.select',
      'database.write',
    ]);
    expect(transform.config.inputStepId).toBe(query.id);
    expect(write.config.inputStepId).toBe(transform.id);
  });

  it('maps source columns to target columns case-insensitively for write auto-mapping', () => {
    expect(
      buildSameNameMappings(['feeamount', 'ID', 'orphan'], ['FEEAMOUNT', 'id', 'NAME']),
    ).toEqual([
      { source: 'feeamount', target: 'FEEAMOUNT' },
      { source: 'ID', target: 'id' },
      { source: 'orphan', target: 'orphan' },
    ]);
    expect(buildSameNameMappings(['a'])).toEqual([{ source: 'a', target: 'a' }]);
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

  it('copies a task with new ids while keeping datasource, sql and cross-task dependencies', () => {
    const pipeline = createSqlPipeline(['warehouse', 'orders'], true);
    pipeline.name = '订单同步';
    pipeline.enabled = false;
    pipeline.dependsOn = ['pipeline_upstream'];
    pipeline.nodes.push({
      id: 'join_fixed',
      name: '关联',
      type: 'transform.join',
      typeVersion: 1,
      config: {
        inputStepId: pipeline.nodes[1]!.id,
        rightStepId: pipeline.nodes[0]!.id,
        inputStepIds: [pipeline.nodes[0]!.id, pipeline.nodes[1]!.id],
        sql: `SELECT '${pipeline.nodes[0]!.id}' AS echoed_id`,
      },
    });
    pipeline.edges.push({
      source: pipeline.nodes[1]!.id,
      target: 'join_fixed',
      sourcePort: 'output',
      targetPort: 'input',
    });
    const original = JSON.stringify(pipeline);

    const first = duplicatePipeline(pipeline, [pipeline.name, '订单同步 副本']);
    const second = duplicatePipeline(pipeline, [
      pipeline.name,
      '订单同步 副本',
      first.name,
    ]);

    expect(first.id).not.toBe(pipeline.id);
    expect(first.name).toBe('订单同步 副本 2');
    expect(second.name).toBe('订单同步 副本 3');
    expect(first.enabled).toBe(false);
    expect(first.dependsOn).toEqual(['pipeline_upstream']);
    expect(first.nodes.map((node) => node.resourceRef)).toEqual(
      pipeline.nodes.map((node) => node.resourceRef),
    );
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(
      first.nodes.length,
    );
    for (const id of pipeline.nodes.map((node) => node.id)) {
      expect(first.nodes.map((node) => node.id)).not.toContain(id);
    }
    expect(first.nodes[1]?.config.parameters[0].stepId).toBe(first.nodes[0]?.id);
    expect(first.nodes[1]?.config.sql).toBe(pipeline.nodes[1]?.config.sql);
    expect(first.nodes[2]?.config.inputStepId).toBe(first.nodes[1]?.id);
    expect(first.nodes[3]?.config.inputStepId).toBe(first.nodes[1]?.id);
    expect(first.nodes[3]?.config.rightStepId).toBe(first.nodes[0]?.id);
    expect(first.nodes[3]?.config.inputStepIds).toEqual([
      first.nodes[0]?.id,
      first.nodes[1]?.id,
    ]);
    expect(first.nodes[3]?.config.sql).toBe(pipeline.nodes[3]?.config.sql);
    const copiedId = (id: string) =>
      first.nodes[pipeline.nodes.findIndex((node) => node.id === id)]!.id;
    expect(first.edges.map((edge) => [edge.source, edge.target])).toEqual(
      pipeline.edges.map((edge) => [copiedId(edge.source), copiedId(edge.target)]),
    );
    for (const node of first.nodes) {
      for (const ref of etlInputReferences(node.config)) {
        expect(first.nodes.some((item) => item.id === ref)).toBe(true);
      }
    }
    first.nodes[2]!.config.table = 'copied_table';
    expect(JSON.stringify(pipeline)).toBe(original);
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

  it('restores one saved task and leaves the other draft untouched', () => {
    const saved = createWorkspaceDocument('1', '已保存');
    const kept = createSqlPipeline(['a']);
    const edited = createSqlPipeline(['a']);
    kept.id = 'keep';
    edited.id = 'edit';
    edited.name = '订单同步';
    saved.pipelines.push(kept, edited);
    const current = JSON.parse(JSON.stringify(saved));
    current.pipelines[1].name = '改过的订单';
    current.pipelines[1].nodes[0].config.sql = 'select 2';
    current.pipelines[0].nodes[0].config.sql = 'select local';

    const restored = restoreSavedPipeline(current, saved, 'edit');

    expect(restored.pipelines[1]?.name).toBe('订单同步');
    expect(restored.pipelines[1]?.nodes[0]?.config.sql).toBe(
      saved.pipelines[1]?.nodes[0]?.config.sql,
    );
    expect(restored.pipelines[0]?.nodes[0]?.config.sql).toBe('select local');
    expect(current.pipelines[1].name).toBe('改过的订单');
    expect(() => restoreSavedPipeline(current, saved, 'new')).toThrow(
      '还没有保存过的版本',
    );
  });

  it('treats reordered resource fields as the same binding', () => {
    expect(
      sameEtlValue(
        { b: { instance: 'warehouse', dbConfigId: 2 }, a: { instance: 'sales', dbConfigId: 1 } },
        { a: { dbConfigId: 1, instance: 'sales' }, b: { dbConfigId: 2, instance: 'warehouse' } },
      ),
    ).toBe(true);
    expect(sameEtlValue({ a: { instance: 'sales' } }, { a: { instance: 'crm' } })).toBe(false);
  });

  it('keeps the whole workspace for AI until the limit, then sends only the selected task', () => {
    const document = createWorkspaceDocument('1', '大工作区');
    document.resources.a = {
      kind: 'database',
      bindingRef: 'local.a',
      instance: 'sales',
    };
    const first = createSqlPipeline(['a']);
    const second = createSqlPipeline(['a']);
    first.id = 'task-a';
    first.name = '订单';
    second.id = 'task-b';
    second.name = '客户';
    document.pipelines.push(first, second);

    const small = buildAiWorkspace(document, 'task-a');
    expect('json' in small && small.scope.mode).toBe('workspace');
    const chosen = buildAiWorkspace(document, 'task-b', 'pipeline');
    expect(chosen).toMatchObject({
      reason: 'chosen',
      scope: { mode: 'pipeline', pipelineId: 'task-b', pipelineName: '客户' },
    });
    if ('json' in chosen) {
      expect(JSON.parse(chosen.json).pipelines.map((item: { id: string }) => item.id)).toEqual(['task-b']);
    }
    expect(buildAiWorkspace(document, 'task-b', 'workspace').scope).toMatchObject({
      mode: 'workspace',
    });

    first.nodes[0]!.config.padding = 'x'.repeat(ETL_AI_JSON_LIMIT);
    const scoped = buildAiWorkspace(document, 'task-b');
    expect(scoped).toMatchObject({
      scope: { mode: 'pipeline', pipelineId: 'task-b', pipelineName: '客户' },
    });
    if (!('json' in scoped)) return;
    const payload = JSON.parse(scoped.json);
    expect(payload.pipelines.map((item: { id: string }) => item.id)).toEqual([
      'task-b',
    ]);
    expect(payload.resources.a.instance).toBe('sales');
    expect(scoped.json.length).toBeLessThanOrEqual(ETL_AI_JSON_LIMIT);
    expect(buildAiWorkspace(document, '')).toMatchObject({
      error: expect.stringContaining('请先选中一个任务'),
    });

    second.nodes[0]!.config.padding = 'y'.repeat(ETL_AI_JSON_LIMIT);
    expect(buildAiWorkspace(document, 'task-b')).toMatchObject({
      error: expect.stringContaining('客户'),
    });
    expect(buildAiWorkspace(document, 'task-a', 'workspace')).toMatchObject({
      error: expect.stringContaining('只改当前任务'),
    });
  });

  it('merges an AI candidate into the selected task and leaves the others untouched', () => {
    const document = createWorkspaceDocument('1', '合并');
    document.resources.a = { kind: 'database', bindingRef: 'local.a' };
    document.variables.limit = 10;
    const first = createSqlPipeline(['a']);
    const second = createSqlPipeline(['a']);
    first.id = 'keep';
    second.id = 'edit';
    second.name = '要改的任务';
    document.pipelines.push(first, second);
    const candidate = JSON.parse(pipelineEditJson(document, 'edit')!);
    candidate.pipelines[0].name = '已配置';
    candidate.pipelines[0].nodes[0].config.sql = 'select 1';
    delete first.nodes[0]!.config.pageSize;

    const merged = mergeAiPipelineEdit(document, candidate, 'edit');

    expect(merged.pipelines.map((item) => item.id)).toEqual(['keep', 'edit']);
    expect(merged.pipelines[0]).toEqual(first);
    expect(merged.pipelines[0]?.nodes[0]?.config.pageSize).toBeUndefined();
    expect(merged.pipelines[1]?.name).toBe('已配置');
    expect(merged.pipelines[1]?.nodes[0]?.config.sql).toBe('select 1');
    expect(merged.resources).toEqual(document.resources);
    expect(merged.variables).toEqual({ limit: 10 });
    expect(second.name).toBe('要改的任务');
    expect(() =>
      mergeAiPipelineEdit(
        document,
        { ...candidate, pipelines: [first, second] },
        'edit',
      ),
    ).toThrow('单任务编辑只能返回当前这一个任务');
    const orphan = JSON.parse(pipelineEditJson(document, 'edit')!);
    orphan.pipelines[0].id = 'gone';
    expect(() => mergeAiPipelineEdit(document, orphan, 'gone')).toThrow(
      '当前任务已不在工作区，无法合并',
    );
  });
});
