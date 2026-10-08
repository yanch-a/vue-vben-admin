/** Kettle 分步迁移的纯模型：多文件隔离、显式绑定、待修复停用。@author yanch */
import type {
  EtlWorkspaceDocument,
  KettleImportResult,
} from '#/api/visual/etl';
import { cloneDocument } from './etlModel';

/** 给每份文件的任务和资源加前缀；节点 ID 在各自任务内保持稳定，参数引用不重写。 */
export function namespaceKettle(
  result: KettleImportResult,
  prefix: string,
): KettleImportResult {
  const doc: EtlWorkspaceDocument = JSON.parse(result.workspaceJson);
  const resources = Object.fromEntries(
    Object.entries(doc.resources).map(([key, value]) => [
      `${prefix}_${key}`,
      value,
    ]),
  );
  for (const task of doc.pipelines) {
    task.id = `${prefix}_${task.id}`;
    for (const node of task.nodes)
      if (node.resourceRef) node.resourceRef = `${prefix}_${node.resourceRef}`;
  }
  doc.resources = resources;
  return {
    ...result,
    workspaceJson: JSON.stringify(doc),
    connections: (result.connections || []).map((item) => ({
      ...item,
      resourceRef: `${prefix}_${item.resourceRef}`,
    })),
    tasks: (result.tasks || []).map((item) => ({
      ...item,
      id: `${prefix}_${item.id}`,
    })),
  };
}

/** 只追加选中任务；每个实际使用的连接都必须绑定真实实例，资源及其他任务不丢失。 */
export function mergeKettleSelection(
  base: EtlWorkspaceDocument,
  imports: EtlWorkspaceDocument[],
  selected: string[],
  bindings: Record<string, string>,
  additions: EtlWorkspaceDocument['resources'],
): EtlWorkspaceDocument {
  const next = cloneDocument(base);
  for (const [ref, resource] of Object.entries(additions)) {
    if (next.resources[ref])
      throw new Error('新增数据源 ID 冲突，请重新开始导入');
    if (
      !resource.dbConfigId ||
      !resource.instance ||
      !resource.displayName?.trim()
    )
      throw new Error('请配置连接、具体实例和别名');
    next.resources[ref] = resource;
  }
  for (const imported of imports)
    for (const original of imported.pipelines) {
      if (!selected.includes(original.id)) continue;
      const task = JSON.parse(JSON.stringify(original));
      if (next.pipelines.some((item) => item.id === task.id))
        throw new Error('任务 ID 冲突，请重新选择文件');
      for (const node of task.nodes)
        if (node.resourceRef) {
          const target = bindings[node.resourceRef];
          if (
            !target ||
            !next.resources[target]?.dbConfigId ||
            !next.resources[target]?.instance
          )
            throw new Error('请绑定每个任务实际使用的连接和实例');
          node.resourceRef = target;
        }
      // 未支持或有迁移差异时停用整条链路，不能仅停用单个步骤后继续写入。
      if (
        task.nodes.some(
          (node: any) =>
            node.config.migrationWarnings?.length ||
            node.type === 'legacy.unsupported',
        )
      )
        task.enabled = false;
      next.pipelines.push(task);
    }
  return next;
}
