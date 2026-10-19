import { describe, expect, it } from 'vitest';

import type { EtlPipeline, EtlWorkspaceDocument } from '#/api/visual/etl';
import {
  importWorkspaceNodes,
  mergeEtlCollaboration,
  resolveEtlConflict,
} from './etlCollabMerge';

/** 协同合并与跨工作区节点并入。冲突必须留下来，不能被自动覆盖。 @author yanch */
describe('ETL workspace collaboration merge', () => {
  const base = workspace([
    pipeline('orders', [
      node('read', '读取', 'SELECT 1'),
      node('write', '写入', ''),
    ]),
  ]);

  it('takes the other user change when the local draft did not touch that node', () => {
    const local = workspace([
      pipeline('orders', [
        node('read', '读取', 'SELECT 1'),
        node('write', '写入', ''),
      ]),
    ]);
    const remote = workspace([
      pipeline('orders', [
        node('read', '读取', 'SELECT id FROM orders'),
        node('write', '写入', ''),
      ]),
    ]);
    const merged = mergeOf(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(sql(merged.document, 'read')).toBe('SELECT id FROM orders');
  });

  it('keeps both edits when they touch different nodes', () => {
    const local = workspace([
      pipeline('orders', [
        node('read', '读取', 'SELECT 1'),
        node('write', '本地写入', ''),
      ]),
    ]);
    const remote = workspace([
      pipeline('orders', [
        node('read', '对方读取', 'SELECT id FROM orders'),
        node('write', '写入', ''),
      ]),
    ]);
    const merged = mergeOf(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(sql(merged.document, 'read')).toBe('SELECT id FROM orders');
    expect(merged.document.pipelines[0]?.nodes[1]?.name).toBe('本地写入');
  });

  it('keeps the local node and reports a conflict when both sides edited it', () => {
    const local = workspace([
      pipeline('orders', [node('read', '读取', 'SELECT local'), node('write', '写入', '')]),
    ]);
    const remote = workspace([
      pipeline('orders', [node('read', '读取', 'SELECT remote'), node('write', '写入', '')]),
    ]);
    const merged = mergeOf(base, local, remote);
    expect(merged.conflicts.map((item) => item.path)).toEqual(['node:orders:read']);
    expect(sql(merged.document, 'read')).toBe('SELECT local');
    const chosen = resolveEtlConflict(merged.document, base, merged.conflicts[0]!, 'remote');
    expect(sql(chosen.document, 'read')).toBe('SELECT remote');
    const again = mergeOf(chosen.base, chosen.document, remote);
    expect(again.conflicts).toEqual([]);
    expect(sql(again.document, 'read')).toBe('SELECT remote');
  });

  it('accepts a remote-only node and a remote deletion of an untouched node', () => {
    const local = workspace([
      pipeline('orders', [node('read', '读取', 'SELECT 1'), node('write', '写入', '')]),
    ]);
    const remote = workspace([
      pipeline('orders', [node('read', '读取', 'SELECT 1'), node('extra', '补充', 'SELECT 2')]),
    ]);
    const merged = mergeOf(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.pipelines[0]?.nodes.map((item) => item.id)).toEqual(['read', 'extra']);
  });

  it('conflicts when one side deletes a node the other side edited', () => {
    const local = workspace([
      pipeline('orders', [node('write', '写入', '')]),
    ]);
    const remote = workspace([
      pipeline('orders', [node('read', '读取', 'SELECT remote'), node('write', '写入', '')]),
    ]);
    const merged = mergeOf(base, local, remote);
    expect(merged.conflicts.map((item) => item.kind)).toEqual(['node']);
    expect(merged.document.pipelines[0]?.nodes.map((item) => item.id)).toEqual(['write']);
    const chosen = resolveEtlConflict(merged.document, base, merged.conflicts[0]!, 'local');
    const again = mergeOf(chosen.base, chosen.document, remote);
    expect(again.conflicts).toEqual([]);
    expect(again.document.pipelines[0]?.nodes.map((item) => item.id)).toEqual(['write']);
  });

  it('copies selected nodes from two workspaces without replacing the target node', () => {
    const target = workspace([
      pipeline('orders', [node('read', 'A 的读取', 'SELECT a', 'src')]),
    ], { src: resource('源') });
    const otherB = workspace([
      pipeline('orders', [
        node('read', 'B 的读取', 'SELECT b', 'src'),
        node('write', 'B 写入', '', 'src'),
      ]),
    ], { src: resource('源') });
    const otherC = workspace([
      pipeline('customers', [node('read', 'C 的读取', 'SELECT c', 'src')]),
    ], { src: resource('另一源') });
    const imported = importWorkspaceNodes(target, [
      { label: 'B', document: otherB, nodesByPipeline: { orders: ['read', 'write'] } },
      { label: 'C', document: otherC, nodesByPipeline: { customers: ['read'] } },
    ]);
    expect(imported.nodeCount).toBe(3);
    expect(imported.document.pipelines.map((item) => item.name)).toEqual([
      'orders',
      'orders',
      'customers',
    ]);
    expect(imported.document.pipelines[0]?.nodes[0]?.name).toBe('A 的读取');
    expect(imported.document.pipelines[1]?.nodes.map((item) => item.id)).not.toContain('read');
    expect(imported.document.resources.src?.displayName).toBe('源');
    expect(imported.renamedResources.length).toBe(1);
    expect(Object.values(imported.document.resources).map((item) => item.displayName)).toContain('另一源');
  });
});

function mergeOf(
  base: EtlWorkspaceDocument,
  local: EtlWorkspaceDocument,
  remote: EtlWorkspaceDocument,
) {
  return mergeEtlCollaboration({
    base,
    local,
    remote,
    baseName: '订单',
    localName: '订单',
    remoteName: '订单',
    baseDescription: '',
    localDescription: '',
    remoteDescription: '',
  });
}

function workspace(
  pipelines: EtlPipeline[],
  resources: EtlWorkspaceDocument['resources'] = {},
): EtlWorkspaceDocument {
  return {
    formatVersion: '1.0',
    workspace: { id: '1', name: '订单' },
    resources,
    variables: {},
    pipelines,
  };
}

function pipeline(id: string, nodes: EtlPipeline['nodes']): EtlPipeline {
  return {
    id,
    name: id,
    enabled: true,
    dependsOn: [],
    nodes,
    edges: nodes.slice(1).map((item, index) => ({
      source: nodes[index]!.id,
      target: item.id,
    })),
  };
}

function node(id: string, name: string, sql: string, resourceRef?: string) {
  return {
    id,
    name,
    type: 'database.query',
    typeVersion: 1,
    resourceRef,
    config: { sql },
  };
}

function resource(displayName: string) {
  return { kind: 'database', bindingRef: '', displayName };
}

function sql(document: EtlWorkspaceDocument, id: string) {
  return document.pipelines[0]?.nodes.find((item) => item.id === id)?.config.sql;
}
