import type { EtlEdge, EtlNode, EtlPipeline, EtlResource, EtlWorkspaceDocument } from '#/api/visual/etl';

import { etlInputReferences } from './etlOperators';

/**
 * Align with backend EtlSqlRuntime.ancestors: preview target plus edge/input upstream.
 * Only within the current pipeline; no cross-task deps.
 */
export function etlPreviewAncestors(pipeline: EtlPipeline, nodeId: string): Set<string> {
  const byId = new Map<string, EtlNode>();
  for (const node of pipeline.nodes || []) {
    if (node?.id) byId.set(node.id, node);
  }
  const result = new Set<string>();
  const pending: string[] = [];
  const start = String(nodeId || '').trim();
  if (start) pending.push(start);
  while (pending.length) {
    const current = pending.pop()!;
    if (!current || result.has(current)) continue;
    result.add(current);
    for (const edge of pipeline.edges || []) {
      if (edge?.enabled === false) continue;
      if (edge?.target === current) {
        const source = String(edge?.source || '').trim();
        if (source) pending.push(source);
      }
    }
    const node = byId.get(current);
    if (!node) continue;
    for (const ref of etlInputReferences(node.config || {})) {
      if (ref) pending.push(ref);
    }
  }
  return result;
}

/** Collect workspace variable names referenced by parameters[].variable. */
function collectVariableNames(nodes: EtlNode[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    const parameters = node.config?.parameters;
    if (!Array.isArray(parameters)) continue;
    for (const parameter of parameters) {
      const variable = String(parameter?.variable || '').trim();
      if (variable) names.add(variable);
    }
  }
  return names;
}

/**
 * Single-task preview payload: current pipeline ancestors + used resources/variables.
 * Omits other pipelines, canvas ui, and extensions.
 */
export function buildEtlPreviewDocument(
  document: EtlWorkspaceDocument,
  pipelineId: string,
  nodeId: string,
): EtlWorkspaceDocument {
  const pipeline = (document.pipelines || []).find((item) => item.id === pipelineId);
  if (!pipeline) {
    throw new Error('同步任务不存在：' + pipelineId);
  }
  const needed = etlPreviewAncestors(pipeline, nodeId);
  const nodes = (pipeline.nodes || []).filter((node) => needed.has(node.id));
  const edges: EtlEdge[] = (pipeline.edges || []).filter(
    (edge) => needed.has(String(edge?.source || '')) && needed.has(String(edge?.target || '')),
  );

  const resourceRefs = new Set<string>();
  const contextRef = String(pipeline.databaseContextRef || '').trim();
  if (contextRef) resourceRefs.add(contextRef);
  for (const node of nodes) {
    const ref = String(node.resourceRef || '').trim();
    if (ref) resourceRefs.add(ref);
  }
  const resources: Record<string, EtlResource> = {};
  for (const ref of resourceRefs) {
    const resource = document.resources?.[ref];
    if (resource) resources[ref] = resource;
  }

  const variableNames = collectVariableNames(nodes);
  const variables: Record<string, any> = {};
  for (const name of variableNames) {
    if (Object.prototype.hasOwnProperty.call(document.variables || {}, name)) {
      variables[name] = document.variables[name];
    }
  }

  const slimPipeline: EtlPipeline = {
    id: pipeline.id,
    name: pipeline.name,
    enabled: pipeline.enabled !== false,
    databaseContextRef: pipeline.databaseContextRef,
    dependsOn: [],
    nodes,
    edges,
    execution: pipeline.execution,
  };

  return {
    formatVersion: '1.0',
    workspace: document.workspace,
    resources,
    variables,
    pipelines: [slimPipeline],
  };
}

/** Serialize preview request body; caller must pass current editor document. */
export function buildEtlPreviewJson(
  document: EtlWorkspaceDocument,
  pipelineId: string,
  nodeId: string,
): string {
  return JSON.stringify(buildEtlPreviewDocument(document, pipelineId, nodeId));
}
