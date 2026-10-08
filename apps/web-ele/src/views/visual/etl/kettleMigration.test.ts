/** 多文件 Kettle 迁移模型回归：不覆盖草稿、不丢引用、阻塞未修复链。@author yanch */
import { describe, expect, it } from 'vitest';
import { createSqlPipeline, createWorkspaceDocument } from './etlModel';
import { mergeKettleSelection, namespaceKettle } from './kettleMigration';
import type { KettleImportResult } from '#/api/visual/etl';

function sample(): KettleImportResult {
  const doc = createWorkspaceDocument('kettle', '文件');
  doc.resources.source = { kind: 'database', bindingRef: 'kettle.source' };
  const task = createSqlPipeline(['source']);
  task.id = 'task_1';
  task.nodes[0]!.config.migrationWarnings = ['未转换'];
  doc.pipelines = [task];
  return {
    sourceType: 'KTR',
    workspaceJson: JSON.stringify(doc),
    convertedCount: 1,
    partialCount: 1,
    unsupportedCount: 0,
    warnings: ['未转换'],
    connections: [
      {
        resourceRef: 'source',
        name: 'source',
        databaseType: 'MYSQL',
        instanceHint: 'sales',
      },
    ],
    tasks: [
      {
        id: 'task_1',
        name: '数据同步',
        status: 'REVIEW',
        nodeCount: 2,
        issues: ['未转换'],
      },
    ],
  };
}
describe('kettleMigration', () => {
  it('namespaces files while retaining in-task dependency references', () => {
    const a = namespaceKettle(sample(), 'a'),
      b = namespaceKettle(sample(), 'b');
    const doc = JSON.parse(a.workspaceJson);
    const task = doc.pipelines[0];
    expect(task.id).toBe('a_task_1');
    expect(task.nodes[0].resourceRef).toBe('a_source');
    expect(task.nodes[1].config.inputStepId).toBe(task.nodes[0].id);
    expect(a.tasks[0]!.id).not.toBe(b.tasks[0]!.id);
  });
  it('appends selected tasks and leaves incomplete tasks disabled', () => {
    const base = createWorkspaceDocument('1', '已有');
    base.pipelines = [createSqlPipeline([])];
    base.resources.db = {
      kind: 'database',
      bindingRef: 'local',
      dbConfigId: '1',
      instance: 'sales',
      displayName: '订单',
    };
    const imported = JSON.parse(namespaceKettle(sample(), 'a').workspaceJson);
    const next = mergeKettleSelection(
      base,
      [imported],
      ['a_task_1'],
      { a_source: 'db' },
      {},
    );
    expect(next.pipelines).toHaveLength(2);
    expect(base.pipelines).toHaveLength(1);
    expect(next.pipelines[1]!.enabled).toBe(false);
    expect(next.pipelines[1]!.nodes[0]!.resourceRef).toBe('db');
    expect(() =>
      mergeKettleSelection(base, [imported], ['a_task_1'], {}, {}),
    ).toThrow('绑定');
  });
});
