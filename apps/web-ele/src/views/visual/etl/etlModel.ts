/**
 * ETL 前端模型帮助函数。
 *
 * <p>向导、流程视图和 JSON 编辑器都调用这里，确保三种交互生成相同协议。</p>
 *
 * @author yanch
 */
import type {
  EtlEdge,
  EtlNode,
  EtlPipeline,
  EtlWorkspaceDocument,
} from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';

/** 生成适合作为 JSON 稳定 ID 的短 ID。 */
export function etlId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 创建包含源、目标两个节点的傻瓜式同步任务。 */
export function createSimplePipeline(
  name = translateUiText('新建同步任务'),
): EtlPipeline {
  const id = etlId('pipeline');
  const sourceId = etlId('read');
  const targetId = etlId('write');
  return {
    id,
    name,
    enabled: true,
    dependsOn: [],
    nodes: [
      {
        id: sourceId,
        name: translateUiText('读取源表'),
        type: 'database.table.read',
        typeVersion: 1,
        resourceRef: `source_${id}`,
        config: { instance: '', tables: [], sourceSchema: '' },
      },
      {
        id: targetId,
        name: translateUiText('写入目标库'),
        type: 'database.table.write',
        typeVersion: 1,
        resourceRef: `target_${id}`,
        config: {
          instance: '',
          targetSchema: '',
          mode: 'both',
          dropIfExists: true,
          batchSize: 500,
          continueOnError: true,
        },
      },
    ],
    edges: [edge(sourceId, targetId)],
    execution: { maxParallelism: 1, timeoutSeconds: 3600 },
  };
}

/** 创建空任务区文档。 */
export function createWorkspaceDocument(
  id: string,
  name: string,
): EtlWorkspaceDocument {
  return {
    formatVersion: '1.0',
    workspace: { id, name },
    resources: {},
    variables: {},
    pipelines: [],
  };
}

/** 找出向导模式的源节点。 */
export function sourceNode(pipeline?: EtlPipeline): EtlNode | undefined {
  return pipeline?.nodes.find((node) =>
    ['database.table.read', 'database.query'].includes(node.type),
  );
}

/** 找出向导模式的目标节点。 */
export function targetNode(pipeline?: EtlPipeline): EtlNode | undefined {
  return pipeline?.nodes.find((node) =>
    ['database.table.write', 'database.write', 'database.upsert'].includes(
      node.type,
    ),
  );
}

/** 将节点数组重建为线性流程；只有用户明确使用“调整顺序”时才调用。 */
export function rebuildLinearEdges(nodes: EtlNode[]): EtlEdge[] {
  const enabled = nodes.filter((node) => node.enabled !== false);
  return enabled
    .slice(0, -1)
    .map((node, index) => edge(node.id, enabled[index + 1]!.id));
}

/** 在目标节点之前插入转换步骤，并保持简单流程的线性连接。 */
export function insertTransform(
  pipeline: EtlPipeline,
  type: string,
  name: string,
): EtlNode {
  const node: EtlNode = {
    id: etlId('step'),
    name,
    type,
    typeVersion: 1,
    config: {},
  };
  const target = targetNode(pipeline);
  const targetIndex = pipeline.nodes.findIndex((item) => item === target);
  pipeline.nodes.splice(
    targetIndex < 0 ? pipeline.nodes.length : targetIndex,
    0,
    node,
  );
  if (target) {
    const incoming = pipeline.edges.filter(
      (item) => item.enabled !== false && item.target === target.id,
    );
    if (incoming.length) {
      incoming.forEach((item) => {
        item.target = node.id;
        item.targetPort = 'input';
      });
    } else {
      const previous = pipeline.nodes[targetIndex - 1];
      if (previous) pipeline.edges.push(edge(previous.id, node.id));
    }
    pipeline.edges.push(edge(node.id, target.id));
  } else {
    const previous = pipeline.nodes[pipeline.nodes.length - 2];
    if (previous) pipeline.edges.push(edge(previous.id, node.id));
  }
  return node;
}

/**
 * 从 DAG 中删除一个转换节点，并把它的所有前驱与后继重新连接。
 * 该操作只修改与目标节点有关的边，不会把 Kettle 导入的分支流程重排成直线。
 */
export function removeNodeFromGraph(
  pipeline: EtlPipeline,
  nodeId: string,
): void {
  const incoming = pipeline.edges.filter(
    (item) => item.enabled !== false && item.target === nodeId,
  );
  const outgoing = pipeline.edges.filter(
    (item) => item.enabled !== false && item.source === nodeId,
  );
  const retained = pipeline.edges.filter(
    (item) => item.source !== nodeId && item.target !== nodeId,
  );
  incoming.forEach((before) => {
    outgoing.forEach((after) => {
      if (before.source === after.target) return;
      const duplicate = retained.some(
        (item) => item.source === before.source && item.target === after.target,
      );
      if (!duplicate) retained.push(edge(before.source, after.target));
    });
  });
  pipeline.nodes = pipeline.nodes.filter((item) => item.id !== nodeId);
  pipeline.edges = retained;
}

/** 深拷贝协议对象，避免 UI 候选配置意外修改当前草稿。 */
export function cloneDocument(
  document: EtlWorkspaceDocument,
): EtlWorkspaceDocument {
  return JSON.parse(JSON.stringify(document));
}

/** 补齐历史/导入文档的编辑默认值，不改节点 ID、SQL、显式配置或手工连线。 */
export function normalizeSqlDocument(
  document: EtlWorkspaceDocument,
): EtlWorkspaceDocument {
  const next = cloneDocument(document);
  for (const pipeline of next.pipelines) {
    pipeline.name ||= pipeline.id;
    for (const node of pipeline.nodes) {
      if (node.type === 'database.query') {
        node.config.parameters ??= [];
        node.config.pageSize ??= node.config.maxRows ?? 50000;
        delete node.config.maxRows;
      } else if (['database.write', 'database.upsert'].includes(node.type)) {
        node.config.mode ??=
          node.type === 'database.upsert' ? 'upsert' : 'append';
        node.config.batchSize ??= 2000;
        node.config.mappings ??= [];
        node.config.keyColumns ??= [];
      } else if (node.type === 'transform.select') {
        node.config.fields ??= [];
        node.config.removeFields ??= [];
        node.config.keepUnspecified ??= false;
      }
    }
  }
  return next;
}

/** 将 Kettle 任务追加到当前工作区，并通过显式选择绑定已有实例别名，不覆盖其他任务。 */
export function appendImportedPipelines(
  current: EtlWorkspaceDocument,
  imported: EtlWorkspaceDocument,
  bindings: Record<string, string>,
): EtlWorkspaceDocument {
  const next = cloneDocument(current);
  for (const [ref] of Object.entries(imported.resources)) {
    if (!bindings[ref] || !next.resources[bindings[ref]!])
      throw new Error('请为每个导入连接选择工作区具体数据源');
  }
  const tasks = cloneDocument(imported).pipelines;
  for (const task of tasks) {
    if (next.pipelines.some((item) => item.id === task.id))
      task.id = etlId('imported');
    for (const node of task.nodes)
      if (node.resourceRef) node.resourceRef = bindings[node.resourceRef];
    next.pipelines.push(task);
  }
  return normalizeSqlDocument(next);
}

/** 创建 SQL 同步任务：查询步骤的数据源与写入步骤的数据源分别配置。 */
export function createSqlPipeline(
  resourceRefs: string[],
  conditional = false,
): EtlPipeline {
  const readId = etlId('query');
  const writeId = etlId('write');
  const pipeline: EtlPipeline = {
    id: etlId('pipeline'),
    name: translateUiText(conditional ? '先取条件，再同步' : '数据同步'),
    enabled: true,
    dependsOn: [],
    nodes: [],
    edges: [],
  };
  if (conditional) {
    const conditionId = etlId('condition');
    pipeline.nodes.push({
      id: conditionId,
      name: translateUiText('从数仓读取水位'),
      type: 'database.query',
      typeVersion: 1,
      resourceRef: resourceRefs[1] || resourceRefs[0],
      config: {
        sql: "SELECT COALESCE(MAX(updated_at), '1970-01-01') AS watermark FROM order_summary",
        parameters: [],
        pageSize: 50000,
      },
    });
    pipeline.nodes.push({
      id: readId,
      name: translateUiText('源数据'),
      type: 'database.query',
      typeVersion: 1,
      resourceRef: resourceRefs[0],
      config: {
        sql: 'SELECT o.id AS order_id, c.name AS customer_name, o.amount, o.updated_at\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.updated_at >= :watermark',
        parameters: [
          {
            name: 'watermark',
            stepId: conditionId,
            column: 'watermark',
            mode: 'first',
          },
        ],
        pageSize: 50000,
      },
    });
    pipeline.edges.push({ ...edge(conditionId, readId), generated: true });
  } else
    pipeline.nodes.push({
      id: readId,
      name: translateUiText('源数据'),
      type: 'database.query',
      typeVersion: 1,
      resourceRef: resourceRefs[0],
      config: { sql: '', parameters: [], pageSize: 50000 },
    });
  pipeline.nodes.push({
    id: writeId,
    name: translateUiText('写入目标表'),
    type: 'database.write',
    typeVersion: 1,
    resourceRef: resourceRefs[1] || resourceRefs[0],
    config: {
      inputStepId: readId,
      table: conditional ? 'order_summary' : '',
      mode: conditional ? 'upsert' : 'append',
      batchSize: 2000,
      mappings: [],
      keyColumns: conditional ? ['order_id'] : [],
    },
  });
  pipeline.edges.push({ ...edge(readId, writeId), generated: true });
  return pipeline;
}

/** 引用变更时重建自动连线，保留手工/导入连线，避免移除参数后仍残留依赖。 */
export function syncStepDependencies(
  pipeline: EtlPipeline,
  node: EtlNode,
): void {
  const refs = new Set<string>(
    (node.config.parameters || [])
      .map((param: any) => param.stepId)
      .filter(Boolean),
  );
  if (node.config.inputStepId) refs.add(node.config.inputStepId);
  pipeline.edges = pipeline.edges.filter(
    (item) => item.target !== node.id || !item.generated,
  );
  for (const ref of refs) {
    if (
      ref === node.id ||
      pipeline.edges.some(
        (item) =>
          item.source === ref &&
          item.target === node.id &&
          item.enabled !== false,
      )
    )
      continue;
    pipeline.edges.push({ ...edge(ref, node.id), generated: true });
  }
}

function edge(source: string, target: string): EtlEdge {
  return { source, sourcePort: 'output', target, targetPort: 'input' };
}
