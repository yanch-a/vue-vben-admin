import { describe, expect, it } from 'vitest';

import type { EtlWorkspaceDocument } from '#/api/visual/etl';

import { buildEtlPreviewDocument, etlPreviewAncestors } from './etlPreviewPayload';

function sampleDocument(): EtlWorkspaceDocument {
  return {
    formatVersion: '1.0',
    workspace: { id: '1', name: 'ws' },
    resources: {
      src: { kind: 'database', bindingRef: 'b1', displayName: 'src' },
      dst: { kind: 'database', bindingRef: 'b2', displayName: 'dst' },
      unused: { kind: 'database', bindingRef: 'b3', displayName: 'unused' },
    },
    variables: { limit: 10, unusedVar: 'x' },
    pipelines: [
      {
        id: 'p1',
        name: 'p1',
        enabled: true,
        dependsOn: [],
        nodes: [
          {
            id: 'read',
            name: 'read',
            type: 'database.query',
            typeVersion: 1,
            resourceRef: 'src',
            config: {
              sql: 'select 1',
              parameters: [{ name: 'n', variable: 'limit' }],
            },
          },
          {
            id: 'filter',
            name: 'filter',
            type: 'transform.filter',
            typeVersion: 1,
            config: { inputStepId: 'read', condition: { op: 'eq', args: [] } },
          },
          {
            id: 'write',
            name: 'write',
            type: 'database.write',
            typeVersion: 1,
            resourceRef: 'dst',
            config: { inputStepId: 'filter', mappings: [] },
          },
        ],
        edges: [
          { source: 'read', target: 'filter', generated: true },
          { source: 'filter', target: 'write', generated: true },
        ],
        ui: { canvas: { origin: { x: 1, y: 2 } } },
      },
      {
        id: 'p2',
        name: 'p2-should-not-upload',
        enabled: true,
        dependsOn: ['p1'],
        nodes: [
          {
            id: 'other',
            name: 'other',
            type: 'database.query',
            typeVersion: 1,
            resourceRef: 'unused',
            config: { sql: 'select 2', parameters: [] },
          },
        ],
        edges: [],
      },
    ],
  };
}

describe('ETL preview payload', () => {
  it('collects ancestors via edges and input references', () => {
    const pipeline = sampleDocument().pipelines[0]!;
    expect([...etlPreviewAncestors(pipeline, 'filter')].sort()).toEqual(['filter', 'read']);
    expect([...etlPreviewAncestors(pipeline, 'write')].sort()).toEqual(['filter', 'read', 'write']);
  });

  it('sends only current pipeline ancestors, used resources and variables', () => {
    const slim = buildEtlPreviewDocument(sampleDocument(), 'p1', 'filter');
    expect(slim.pipelines.map((item) => item.id)).toEqual(['p1']);
    expect(slim.pipelines[0]!.nodes.map((item) => item.id).sort()).toEqual(['filter', 'read']);
    expect(slim.pipelines[0]!.edges).toEqual([
      { source: 'read', target: 'filter', generated: true },
    ]);
    expect(slim.pipelines[0]!.ui).toBeUndefined();
    expect(slim.pipelines[0]!.dependsOn).toEqual([]);
    expect(Object.keys(slim.resources).sort()).toEqual(['src']);
    expect(slim.variables).toEqual({ limit: 10 });
    expect(slim.formatVersion).toBe('1.0');
  });

  it('does not include unused sibling pipelines or resources', () => {
    const slim = buildEtlPreviewDocument(sampleDocument(), 'p1', 'read');
    expect(slim.pipelines).toHaveLength(1);
    expect(slim.resources.unused).toBeUndefined();
    expect(slim.resources.dst).toBeUndefined();
    expect(slim.variables.unusedVar).toBeUndefined();
  });
});
