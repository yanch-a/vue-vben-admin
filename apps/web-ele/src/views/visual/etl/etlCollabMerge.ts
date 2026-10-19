/**
 * ETL 工作区协同合并。
 *
 * 以「上次对齐的服务端文档」为共同祖先，把本地未保存修改和对方新版本合到同一份草稿。
 * 只有一边改过的节点、连线、数据源直接采用；两边都改了同一处则记为冲突，调用方不得整份覆盖。
 *
 * @author yanch
 */
import type {
  EtlEdge,
  EtlNode,
  EtlPipeline,
  EtlWorkspaceDocument,
} from '#/api/visual/etl';

export type EtlConflictKind =
  | 'resource'
  | 'variable'
  | 'pipeline'
  | 'pipeline-meta'
  | 'node'
  | 'edge'
  | 'name'
  | 'description';

/** 一处无法自动合并的修改。remoteValue 是对方版本，选择「采用对方」时写回。 */
export interface EtlMergeConflict {
  path: string;
  kind: EtlConflictKind;
  title: string;
  pipelineId?: string;
  nodeId?: string;
  edgeKey?: string;
  recordKey?: string;
  remotePresent: boolean;
  localPresent: boolean;
  remoteValue: unknown;
  localValue: unknown;
}

export interface EtlCollaborationMergeInput {
  base: EtlWorkspaceDocument;
  local: EtlWorkspaceDocument;
  remote: EtlWorkspaceDocument;
  baseName: string;
  localName: string;
  remoteName: string;
  baseDescription: string;
  localDescription: string;
  remoteDescription: string;
}

export interface EtlCollaborationMergeResult {
  document: EtlWorkspaceDocument;
  name: string;
  description: string;
  conflicts: EtlMergeConflict[];
}

export interface EtlNodeImportSource {
  label: string;
  document: EtlWorkspaceDocument;
  /** 每个任务要并入的节点 ID。没有选中节点的任务不会复制。 */
  nodesByPipeline: Record<string, string[]>;
}

export interface EtlNodeImportResult {
  document: EtlWorkspaceDocument;
  nodeCount: number;
  pipelineCount: number;
  renamedResources: string[];
  keptVariables: string[];
}

interface Slot {
  present: boolean;
  value: unknown;
}

/** 把另一份工作区里选中的节点追加到当前工作区，不覆盖已有节点。 */
export function importWorkspaceNodes(
  target: EtlWorkspaceDocument,
  sources: EtlNodeImportSource[],
): EtlNodeImportResult {
  const next = clone(target);
  next.resources ??= {};
  next.variables ??= {};
  next.pipelines ??= [];
  const ids = collectIds(next);
  const renamedResources: string[] = [];
  const keptVariables: string[] = [];
  let nodeCount = 0;
  let pipelineCount = 0;
  sources.forEach((source, index) => {
    const prefix = uniquePrefix(source.label, index);
    const selected = source.document.pipelines.filter(
      (pipeline) => (source.nodesByPipeline[pipeline.id] || []).length > 0,
    );
    const pipelineIds = new Map<string, string>();
    for (const pipeline of selected) {
      const preferred = ids.has(pipeline.id)
        ? `${prefix}_${pipeline.id}`
        : pipeline.id;
      pipelineIds.set(pipeline.id, uniqueId(ids, preferred));
    }
    const resourceMap = new Map<string, string>();
    for (const pipeline of selected) {
      const picked = new Set(source.nodesByPipeline[pipeline.id] || []);
      for (const node of pipeline.nodes) {
        if (!picked.has(node.id) || !node.resourceRef) continue;
        if (resourceMap.has(node.resourceRef)) continue;
        const resource = source.document.resources?.[node.resourceRef];
        if (!resource) continue;
        resourceMap.set(
          node.resourceRef,
          placeResource(next, node.resourceRef, resource, prefix, renamedResources),
        );
      }
    }
    for (const [key, value] of Object.entries(source.document.variables || {})) {
      if (!Object.prototype.hasOwnProperty.call(next.variables, key)) {
        next.variables[key] = clone(value);
      } else if (!same(next.variables[key], value) && !keptVariables.includes(key)) {
        keptVariables.push(key);
      }
    }
    for (const pipeline of selected) {
      const picked = new Set(source.nodesByPipeline[pipeline.id] || []);
      const nodeIds = new Map<string, string>();
      for (const node of pipeline.nodes) {
        if (!picked.has(node.id)) continue;
        const preferred = ids.has(node.id) ? `${prefix}_${node.id}` : node.id;
        nodeIds.set(node.id, uniqueId(ids, preferred));
      }
      const copy: EtlPipeline = {
        ...meta(pipeline),
        id: pipelineIds.get(pipeline.id) || pipeline.id,
        name: pipeline.name,
        enabled: pipeline.enabled,
        dependsOn: (pipeline.dependsOn || [])
          .map((id) => pipelineIds.get(id))
          .filter((id): id is string => Boolean(id)),
        nodes: [],
        edges: [],
      };
      for (const node of pipeline.nodes) {
        const id = nodeIds.get(node.id);
        if (!id) continue;
        const cloned = clone(node);
        cloned.id = id;
        if (cloned.resourceRef) {
          cloned.resourceRef = resourceMap.get(cloned.resourceRef) || cloned.resourceRef;
        }
        cloned.config = rewriteStrings(cloned.config, nodeIds) as EtlNode['config'];
        copy.nodes.push(cloned);
        nodeCount += 1;
      }
      for (const edge of pipeline.edges || []) {
        const sourceId = nodeIds.get(edge.source);
        const targetId = nodeIds.get(edge.target);
        if (!sourceId || !targetId) continue;
        copy.edges.push({ ...clone(edge), source: sourceId, target: targetId });
      }
      next.pipelines.push(copy);
      pipelineCount += 1;
    }
  });
  return { document: next, nodeCount, pipelineCount, renamedResources, keptVariables };
}

/** 三方合并本地草稿和对方已保存版本。冲突项保留本地值，等待用户逐项选择。 */
export function mergeEtlCollaboration(
  input: EtlCollaborationMergeInput,
): EtlCollaborationMergeResult {
  const conflicts: EtlMergeConflict[] = [];
  const name = mergeScalar(
    input.baseName,
    input.localName,
    input.remoteName,
    'name',
    'name',
    input.localName || input.remoteName,
    conflicts,
  );
  const description = mergeScalar(
    input.baseDescription || '',
    input.localDescription || '',
    input.remoteDescription || '',
    'description',
    'description',
    '',
    conflicts,
  );
  const document = clone(input.local);
  document.resources = mergeRecord(
    input.base.resources || {},
    input.local.resources || {},
    input.remote.resources || {},
    'resource',
    conflicts,
  );
  document.variables = mergeRecord(
    input.base.variables || {},
    input.local.variables || {},
    input.remote.variables || {},
    'variable',
    conflicts,
  );
  document.pipelines = mergePipelines(
    input.base.pipelines || [],
    input.local.pipelines || [],
    input.remote.pipelines || [],
    conflicts,
  );
  document.workspace = {
    ...document.workspace,
    name,
    description,
  };
  return { document, name, description, conflicts };
}

/**
 * 用户选定冲突的一边后，把共同祖先推进到对方版本。
 * 选「保留我的」时文档不变，祖先改为对方值，这样下次轮询不会把同一处再报成冲突。
 */
export function resolveEtlConflict(
  document: EtlWorkspaceDocument,
  base: EtlWorkspaceDocument,
  conflict: EtlMergeConflict,
  choice: 'local' | 'remote',
): { document: EtlWorkspaceDocument; base: EtlWorkspaceDocument } {
  const nextDocument = clone(document);
  const nextBase = clone(base);
  if (choice === 'remote') writeSlot(nextDocument, conflict, conflict.remotePresent, conflict.remoteValue);
  writeSlot(nextBase, conflict, conflict.remotePresent, conflict.remoteValue);
  return { document: nextDocument, base: nextBase };
}

function mergeScalar(
  base: string,
  local: string,
  remote: string,
  kind: 'name' | 'description',
  path: string,
  title: string,
  conflicts: EtlMergeConflict[],
): string {
  const decision = decide(slot(base, true), slot(local, true), slot(remote, true));
  if (decision.conflict) {
    conflicts.push({
      path,
      kind,
      title,
      remotePresent: true,
      localPresent: true,
      remoteValue: remote,
      localValue: local,
    });
  }
  return decision.keep === 'remote' ? remote : local;
}

function mergeRecord(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  kind: 'resource' | 'variable',
  conflicts: EtlMergeConflict[],
): Record<string, any> {
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  const out: Record<string, any> = {};
  for (const key of keys) {
    const decision = decide(
      presence(base, key),
      presence(local, key),
      presence(remote, key),
    );
    if (decision.conflict) {
      conflicts.push({
        path: `${kind}:${key}`,
        kind,
        title: key,
        recordKey: key,
        remotePresent: Object.prototype.hasOwnProperty.call(remote, key),
        localPresent: Object.prototype.hasOwnProperty.call(local, key),
        remoteValue: clone(remote[key]),
        localValue: clone(local[key]),
      });
    }
    if (decision.keep === 'omit') continue;
    const source = decision.keep === 'remote' ? remote : local;
    out[key] = clone(source[key]);
  }
  return out;
}

function mergePipelines(
  base: EtlPipeline[],
  local: EtlPipeline[],
  remote: EtlPipeline[],
  conflicts: EtlMergeConflict[],
): EtlPipeline[] {
  const baseMap = indexBy(base, (item) => item.id);
  const localMap = indexBy(local, (item) => item.id);
  const remoteMap = indexBy(remote, (item) => item.id);
  const order = local.map((item) => item.id);
  for (const pipeline of remote) if (!order.includes(pipeline.id)) order.push(pipeline.id);
  const out: EtlPipeline[] = [];
  for (const id of order) {
    const localPipeline = localMap.get(id);
    const remotePipeline = remoteMap.get(id);
    if (localPipeline && remotePipeline) {
      out.push(mergePipeline(baseMap.get(id), localPipeline, remotePipeline, conflicts));
      continue;
    }
    const decision = decide(
      slot(baseMap.get(id), baseMap.has(id)),
      slot(localPipeline, Boolean(localPipeline)),
      slot(remotePipeline, Boolean(remotePipeline)),
    );
    if (decision.conflict) {
      const sample = localPipeline || remotePipeline;
      conflicts.push({
        path: `pipeline:${id}`,
        kind: 'pipeline',
        title: sample?.name || id,
        pipelineId: id,
        remotePresent: Boolean(remotePipeline),
        localPresent: Boolean(localPipeline),
        remoteValue: clone(remotePipeline),
        localValue: clone(localPipeline),
      });
    }
    if (decision.keep === 'local' && localPipeline) out.push(clone(localPipeline));
    if (decision.keep === 'remote' && remotePipeline) out.push(clone(remotePipeline));
  }
  return out;
}

function mergePipeline(
  base: EtlPipeline | undefined,
  local: EtlPipeline,
  remote: EtlPipeline,
  conflicts: EtlMergeConflict[],
): EtlPipeline {
  const decision = decide(
    slot(base ? meta(base) : undefined, Boolean(base)),
    slot(meta(local), true),
    slot(meta(remote), true),
  );
  if (decision.conflict) {
    conflicts.push({
      path: `pipeline-meta:${local.id}`,
      kind: 'pipeline-meta',
      title: local.name || local.id,
      pipelineId: local.id,
      remotePresent: true,
      localPresent: true,
      remoteValue: clone(meta(remote)),
      localValue: clone(meta(local)),
    });
  }
  const chosen = decision.keep === 'remote' ? meta(remote) : meta(local);
  return {
    ...clone(chosen),
    id: local.id,
    nodes: mergeNodes(base, local, remote, conflicts),
    edges: mergeEdges(base, local, remote, conflicts),
  };
}

function mergeNodes(
  base: EtlPipeline | undefined,
  local: EtlPipeline,
  remote: EtlPipeline,
  conflicts: EtlMergeConflict[],
): EtlNode[] {
  const baseMap = indexBy(base?.nodes || [], (item) => item.id);
  const localMap = indexBy(local.nodes, (item) => item.id);
  const remoteMap = indexBy(remote.nodes, (item) => item.id);
  const order = local.nodes.map((item) => item.id);
  for (const node of remote.nodes) if (!order.includes(node.id)) order.push(node.id);
  const out: EtlNode[] = [];
  for (const id of order) {
    const decision = decide(
      slot(baseMap.get(id), baseMap.has(id)),
      slot(localMap.get(id), localMap.has(id)),
      slot(remoteMap.get(id), remoteMap.has(id)),
    );
    if (decision.conflict) {
      const sample = localMap.get(id) || remoteMap.get(id);
      conflicts.push({
        path: `node:${local.id}:${id}`,
        kind: 'node',
        title: sample?.name || id,
        pipelineId: local.id,
        nodeId: id,
        remotePresent: remoteMap.has(id),
        localPresent: localMap.has(id),
        remoteValue: clone(remoteMap.get(id)),
        localValue: clone(localMap.get(id)),
      });
    }
    const chosen = decision.keep === 'remote' ? remoteMap.get(id) : decision.keep === 'local' ? localMap.get(id) : undefined;
    if (chosen) out.push(clone(chosen));
  }
  return out;
}

function mergeEdges(
  base: EtlPipeline | undefined,
  local: EtlPipeline,
  remote: EtlPipeline,
  conflicts: EtlMergeConflict[],
): EtlEdge[] {
  const baseMap = indexBy(base?.edges || [], edgeKey);
  const localMap = indexBy(local.edges || [], edgeKey);
  const remoteMap = indexBy(remote.edges || [], edgeKey);
  const order = (local.edges || []).map(edgeKey);
  for (const edge of remote.edges || []) {
    const key = edgeKey(edge);
    if (!order.includes(key)) order.push(key);
  }
  const out: EtlEdge[] = [];
  for (const key of order) {
    const decision = decide(
      slot(baseMap.get(key), baseMap.has(key)),
      slot(localMap.get(key), localMap.has(key)),
      slot(remoteMap.get(key), remoteMap.has(key)),
    );
    if (decision.conflict) {
      const sample = localMap.get(key) || remoteMap.get(key);
      conflicts.push({
        path: `edge:${local.id}:${key}`,
        kind: 'edge',
        title: sample ? `${sample.source} → ${sample.target}` : key,
        pipelineId: local.id,
        edgeKey: key,
        remotePresent: remoteMap.has(key),
        localPresent: localMap.has(key),
        remoteValue: clone(remoteMap.get(key)),
        localValue: clone(localMap.get(key)),
      });
    }
    const chosen = decision.keep === 'remote' ? remoteMap.get(key) : decision.keep === 'local' ? localMap.get(key) : undefined;
    if (chosen) out.push(clone(chosen));
  }
  return out;
}

/** 两边相对祖先的修改。keep 是自动合并结果；conflict 时结果先留本地，等用户选择。 */
function decide(base: Slot, local: Slot, remote: Slot): { keep: 'local' | 'remote' | 'omit'; conflict: boolean } {
  if (local.present && remote.present && same(local.value, remote.value)) {
    return { keep: 'local', conflict: false };
  }
  if (!local.present && !remote.present) return { keep: 'omit', conflict: false };
  if (local.present && !remote.present) {
    if (!base.present) return { keep: 'local', conflict: false };
    if (same(local.value, base.value)) return { keep: 'omit', conflict: false };
    return { keep: 'local', conflict: true };
  }
  if (!local.present && remote.present) {
    if (!base.present) return { keep: 'remote', conflict: false };
    if (same(remote.value, base.value)) return { keep: 'omit', conflict: false };
    return { keep: 'omit', conflict: true };
  }
  if (base.present && same(local.value, base.value)) return { keep: 'remote', conflict: false };
  if (base.present && same(remote.value, base.value)) return { keep: 'local', conflict: false };
  return { keep: 'local', conflict: true };
}

function writeSlot(
  document: EtlWorkspaceDocument,
  conflict: EtlMergeConflict,
  present: boolean,
  value: unknown,
) {
  if (conflict.kind === 'name' || conflict.kind === 'description') return;
  if (conflict.kind === 'resource' || conflict.kind === 'variable') {
    const bucket = conflict.kind === 'resource' ? document.resources : document.variables;
    const key = conflict.recordKey || '';
    if (!present) delete bucket[key];
    else bucket[key] = clone(value) as never;
    return;
  }
  if (conflict.kind === 'pipeline') {
    const id = conflict.pipelineId || '';
    document.pipelines = document.pipelines.filter((item) => item.id !== id);
    if (present && value) document.pipelines.push(clone(value) as EtlPipeline);
    return;
  }
  const pipeline = document.pipelines.find((item) => item.id === conflict.pipelineId);
  if (!pipeline) return;
  if (conflict.kind === 'pipeline-meta') {
    if (!present || !value || typeof value !== 'object') return;
    const nodes = pipeline.nodes;
    const edges = pipeline.edges;
    const incoming = clone(value) as EtlPipeline;
    for (const key of Object.keys(pipeline)) {
      if (key !== 'nodes' && key !== 'edges') delete (pipeline as unknown as Record<string, unknown>)[key];
    }
    Object.assign(pipeline, { ...incoming, nodes, edges, id: pipeline.id });
    return;
  }
  if (conflict.kind === 'node') {
    const nodeId = conflict.nodeId || '';
    pipeline.nodes = pipeline.nodes.filter((item) => item.id !== nodeId);
    pipeline.edges = (pipeline.edges || []).filter(
      (item) => item.source !== nodeId && item.target !== nodeId,
    );
    if (present && value) pipeline.nodes.push(clone(value) as EtlNode);
    return;
  }
  if (conflict.kind === 'edge') {
    pipeline.edges = (pipeline.edges || []).filter((item) => edgeKey(item) !== conflict.edgeKey);
    if (present && value) pipeline.edges.push(clone(value) as EtlEdge);
  }
}

function placeResource(
  target: EtlWorkspaceDocument,
  key: string,
  resource: unknown,
  prefix: string,
  renamed: string[],
) {
  if (!Object.prototype.hasOwnProperty.call(target.resources, key)) {
    target.resources[key] = clone(resource) as never;
    return key;
  }
  if (same(target.resources[key], resource)) return key;
  let candidate = `${prefix}_${key}`;
  let serial = 2;
  while (
    Object.prototype.hasOwnProperty.call(target.resources, candidate) &&
    !same(target.resources[candidate], resource)
  ) {
    candidate = `${prefix}_${key}_${serial}`;
    serial += 1;
  }
  target.resources[candidate] = clone(resource) as never;
  renamed.push(candidate);
  return candidate;
}

function meta(pipeline: EtlPipeline): Omit<EtlPipeline, 'nodes' | 'edges'> {
  const { nodes: _nodes, edges: _edges, ...rest } = pipeline;
  return rest;
}

function edgeKey(edge: EtlEdge) {
  return [edge.source, edge.sourcePort || '', edge.target, edge.targetPort || ''].join('\u0000');
}

function presence(record: Record<string, unknown>, key: string): Slot {
  return {
    present: Object.prototype.hasOwnProperty.call(record, key),
    value: record[key],
  };
}

function slot(value: unknown, present: boolean): Slot {
  return { present, value };
}

function indexBy<T>(items: T[], keyOf: (item: T) => string) {
  return new Map(items.map((item) => [keyOf(item), item]));
}

function collectIds(document: EtlWorkspaceDocument) {
  const ids = new Set<string>();
  for (const pipeline of document.pipelines || []) {
    ids.add(pipeline.id);
    for (const node of pipeline.nodes || []) ids.add(node.id);
  }
  return ids;
}

function uniqueId(taken: Set<string>, preferred: string) {
  let id = preferred || 'imported';
  let serial = 2;
  while (taken.has(id)) {
    id = `${preferred || 'imported'}_${serial}`;
    serial += 1;
  }
  taken.add(id);
  return id;
}

function uniquePrefix(label: string, index: number) {
  const clean = label.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return `${clean || 'ws'}_${index + 1}`;
}

/** 只替换完整字符串，避免把节点 ID 误替换进 SQL 正文中间。 */
function rewriteStrings(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, ids));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = rewriteStrings(child, ids);
    return out;
  }
  return value;
}

function same(left: unknown, right: unknown) {
  return stable(left) === stable(right);
}

function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(canonicalize(value)) ?? 'null';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
