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
import { parseEtlJson } from './etlSafeJson';
import { createOperatorConfig, ETL_OPERATORS, etlInputReferences } from './etlOperators';

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
          dropIfExists: false,
          batchSize: 500,
          continueOnError: false,
        },
      },
    ],
    edges: [edge(sourceId, targetId)],
    execution: { maxParallelism: 1, timeoutSeconds: 0 },
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
  return parseEtlJson(JSON.stringify(document));
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
      } else if (ETL_OPERATORS.some((item) => item.type === node.type)) {
        const defaults = createOperatorConfig(node.type);
        // 非空内嵌数据可由执行器推断列；不能在重新打开工作区时塞入 id/name 覆盖实际结构。
        if (node.type === 'source.inline' && node.config.rows?.length && !Object.hasOwn(node.config, 'columns')) delete defaults.columns;
        node.config = { ...defaults, ...node.config };
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

/**
 * 在当前工作区复制一条任务，插在调用方指定的位置。
 *
 * 任务和每个步骤都换成新 ID。步骤之间的输入、参数来源和连线改到新 ID，
 * 这样副本和原任务互不影响，预览缓存也不会串。数据源别名、SQL、写入表，
 * 以及指向其它任务的 dependsOn 保持原样。
 */
export function duplicatePipeline(
  source: EtlPipeline,
  existingNames: Iterable<string> = [],
): EtlPipeline {
  const copy = parseEtlJson(JSON.stringify(source)) as EtlPipeline;
  const used = new Set<string>([source.id]);
  const nodeIds = new Map<string, string>();
  for (const node of copy.nodes || []) {
    const next = uniqueEtlId(idPrefix(node.id), used);
    nodeIds.set(node.id, next);
    node.id = next;
    remapStepReferences(node.config, nodeIds);
  }
  for (const item of copy.edges || []) {
    if (nodeIds.has(item.source)) item.source = nodeIds.get(item.source)!;
    if (nodeIds.has(item.target)) item.target = nodeIds.get(item.target)!;
  }
  copy.id = uniqueEtlId('pipeline', used);
  copy.name = duplicatePipelineName(source.name, existingNames);
  // 依赖的是其它任务，不是本任务的步骤。保留原 ID，副本不会改成依赖自己。
  copy.dependsOn = [...(source.dependsOn || [])];
  return copy;
}

/** 副本名称避开已有任务。再次复制「订单同步 副本」时得到「订单同步 副本 2」。 */
function duplicatePipelineName(
  name: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set(
    [...existingNames].map((item) => String(item || '').trim()).filter(Boolean),
  );
  const suffix = translateUiText('副本');
  const raw = String(name || '').trim();
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matched = raw.match(new RegExp(`^(.*?)(?: ${escaped}(?: (\\d+))?)?$`));
  const base = (matched?.[1] || raw).trim() || translateUiText('未命名任务');
  const first = `${base} ${suffix}`;
  if (!taken.has(first)) return first;
  let index = 2;
  while (taken.has(`${base} ${suffix} ${index}`)) index += 1;
  return `${base} ${suffix} ${index}`;
}

/**
 * 只改写步骤引用字段，不扫描 SQL 和样例数据。
 * 字段集合与 etlInputReferences 一致：输入步骤、右表、多路输入、参数来源。
 */
function remapStepReferences(
  config: Record<string, any> | undefined,
  ids: Map<string, string>,
): void {
  if (!config) return;
  for (const field of ['inputStepId', 'rightStepId'] as const) {
    const value = config[field];
    if (typeof value === 'string' && ids.has(value)) config[field] = ids.get(value);
  }
  if (Array.isArray(config.inputStepIds)) {
    config.inputStepIds = config.inputStepIds.map((value: unknown) =>
      typeof value === 'string' && ids.has(value) ? ids.get(value) : value,
    );
  }
  if (Array.isArray(config.parameters)) {
    for (const parameter of config.parameters) {
      if (
        parameter &&
        typeof parameter === 'object' &&
        typeof parameter.stepId === 'string' &&
        ids.has(parameter.stepId)
      ) {
        parameter.stepId = ids.get(parameter.stepId);
      }
    }
  }
}

/** 与后端提示词、候选工具使用同一上限。超过后不能再把整份工作区交给模型。 */
export const ETL_AI_JSON_LIMIT = 64000;

/** AI 这次实际编辑的范围。pipeline 表示只改当前任务，再合并回工作区。 */
export interface EtlAiEditScope {
  mode: 'workspace' | 'pipeline';
  pipelineId?: string;
  pipelineName?: string;
}

/** 用户选择的编辑范围。auto 在不超过上限时编辑全部任务，超过后改为当前任务。 */
export type EtlAiEditPreference = 'auto' | 'workspace' | 'pipeline';

/**
 * 组装交给 AI 的工作区。
 *
 * pipeline 由用户指定，只提交当前任务。workspace 提交整份配置。
 * auto 在不超过上限时提交整份，超过后改为当前任务。
 * 其他任务留在本地，不会放进提示词，也不算被删除。
 */
export function buildAiWorkspace(
  document: EtlWorkspaceDocument,
  pipelineId?: string,
  preference: EtlAiEditPreference = 'auto',
):
  | { scope: EtlAiEditScope; json: string; reason: 'full' | 'chosen' | 'limit' }
  | { error: string } {
  const full = JSON.stringify(document);
  const fullFits = full.length <= ETL_AI_JSON_LIMIT;
  if (preference !== 'pipeline' && fullFits) {
    return { scope: { mode: 'workspace' }, json: full, reason: 'full' };
  }
  if (preference === 'workspace') {
    return {
      error:
        '工作区超过 AI 一次编辑上限。请改用「只改当前任务」，或拆分工作区；完整 JSON 仍可手工编辑。',
    };
  }
  const scoped = scopedPipelineDocument(document, pipelineId);
  if (!scoped) {
    return {
      error:
        preference === 'pipeline'
          ? '请先选中一个任务，AI 将只配置该任务。'
          : document.pipelines.length
            ? '工作区超过 AI 一次编辑上限。请先选中一个任务，AI 将只配置该任务。'
            : '工作区超过 AI 一次编辑上限，且没有可单独编辑的任务。请精简数据源或变量后再试。',
    };
  }
  const json = JSON.stringify(scoped);
  if (json.length > ETL_AI_JSON_LIMIT) {
    const name = scoped.pipelines[0]?.name || scoped.pipelines[0]?.id || '';
    return {
      error: `当前任务「${name}」连同数据源配置仍超过 AI 编辑上限，请精简该任务或拆分后再试`,
    };
  }
  const pipeline = scoped.pipelines[0]!;
  return {
    scope: {
      mode: 'pipeline',
      pipelineId: pipeline.id,
      pipelineName: pipeline.name || pipeline.id,
    },
    json,
    reason: preference === 'pipeline' ? 'chosen' : 'limit',
  };
}

/**
 * 比较两份 ETL JSON 的内容。
 * 对象键顺序不同仍视为相同，避免模型重排数据源字段时被误判成绑定已变化。
 */
export function sameEtlValue(left: unknown, right: unknown): boolean {
  return canonicalizeEtlValue(left) === canonicalizeEtlValue(right);
}

function canonicalizeEtlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeEtlValue(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeEtlValue(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 用和发送时相同的切法序列化单个任务，用来核对候选是否还对得上当前草稿。 */
export function pipelineEditJson(
  document: EtlWorkspaceDocument,
  pipelineId?: string,
): string | null {
  const scoped = scopedPipelineDocument(document, pipelineId);
  return scoped ? JSON.stringify(scoped) : null;
}

/**
 * 用上次保存的版本替换一个任务，其它任务、数据源和变量保持当前草稿。
 * 新建后还没保存过的任务没有可还原的版本。
 */
export function restoreSavedPipeline(
  current: EtlWorkspaceDocument,
  saved: EtlWorkspaceDocument | undefined,
  pipelineId: string,
): EtlWorkspaceDocument {
  const savedTask = saved?.pipelines.find((item) => item.id === pipelineId);
  if (!savedTask) {
    throw new Error('这个任务还没有保存过的版本，请用删除任务放弃它');
  }
  const next = cloneDocument(current);
  const index = next.pipelines.findIndex((item) => item.id === pipelineId);
  if (index < 0) throw new Error('任务已不在工作区，无法还原');
  next.pipelines[index] = cloneDocument({
    formatVersion: next.formatVersion,
    workspace: next.workspace,
    resources: next.resources,
    variables: next.variables || {},
    pipelines: [savedTask],
  }).pipelines[0]!;
  return next;
}

/**
 * 把单任务候选合并回完整工作区。
 *
 * 只替换目标任务。数据源、变量和其他任务保持当前草稿，避免模型没看见的任务被清空。
 */
export function mergeAiPipelineEdit(
  current: EtlWorkspaceDocument,
  candidate: EtlWorkspaceDocument,
  pipelineId: string,
): EtlWorkspaceDocument {
  const incoming = candidate.pipelines;
  if (incoming.length !== 1 || incoming[0]?.id !== pipelineId) {
    throw new Error('单任务编辑只能返回当前这一个任务');
  }
  const next = cloneDocument(current);
  const index = next.pipelines.findIndex((item) => item.id === pipelineId);
  if (index < 0) throw new Error('当前任务已不在工作区，无法合并');
  // 只标准化被替换的任务。对整份文档再标准化会给其他任务补默认值，等于改了没交给 AI 的任务。
  next.pipelines[index] = normalizeSqlDocument({
    formatVersion: current.formatVersion,
    workspace: current.workspace,
    resources: current.resources,
    variables: current.variables || {},
    pipelines: [incoming[0]!],
  }).pipelines[0]!;
  return next;
}

/** 单任务上下文：共享数据源和变量保留，任务列表只留正在编辑的那一个。 */
function scopedPipelineDocument(
  document: EtlWorkspaceDocument,
  pipelineId?: string,
): EtlWorkspaceDocument | null {
  const pipeline = document.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return null;
  return {
    formatVersion: document.formatVersion,
    workspace: document.workspace,
    resources: document.resources,
    variables: document.variables || {},
    pipelines: [pipeline],
  };
}

/** 沿用原步骤 ID 的前缀，便于区分查询、写入和转换。 */
function idPrefix(id: string): string {
  const prefix = String(id || '').split('_')[0] || '';
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(prefix) ? prefix : 'step';
}

function uniqueEtlId(prefix: string, used: Set<string>): string {
  let id = etlId(prefix || 'step');
  while (used.has(id)) id = etlId(prefix || 'step');
  used.add(id);
  return id;
}

/** 引用变更时重建自动连线，保留手工/导入连线，避免移除参数后仍残留依赖。 */
export function syncStepDependencies(
  pipeline: EtlPipeline,
  node: EtlNode,
): void {
  const refs = new Set(etlInputReferences(node.config));
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
