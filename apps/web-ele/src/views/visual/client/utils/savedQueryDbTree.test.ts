import { describe, expect, it } from 'vitest';

import {
  buildSavedQueryDbTree,
  collectSavedQueryLeaves,
} from './savedQueryDbTree';

/** 构造查询叶子 */
function query(
  label: string,
  dbConfigId: null | number,
  dbName: null | string,
  instanceName: null | string,
  schemaName?: string,
) {
  return {
    id: `query-${label}`,
    label,
    nodeType: 'query',
    dbConfigId,
    dbName,
    instanceName,
    schemaName,
  };
}

describe('savedQueryDbTree', () => {
  it('从分组树中收集全部查询，忽略分组节点', () => {
    const a = query('a', 1, 'pg', 'app');
    const b = query('b', 1, 'pg', 'app');
    const tree = [
      {
        label: '报表',
        nodeType: 'group',
        children: [a, { label: '子组', nodeType: 'group', children: [b] }],
      },
    ];
    expect(collectSavedQueryLeaves(tree as any)).toEqual([a, b]);
  });

  it('按连接、库、Schema 分层并统计数量', () => {
    const roots = buildSavedQueryDbTree([
      query('orders', 1, 'pg-prod', 'shop', 'sales'),
      query('users', 1, 'pg-prod', 'shop', 'public'),
      query('raw', 1, 'pg-prod', 'shop'),
      query('mysql-q', 2, 'mysql-dev', 'crm', 'crm'),
    ]);

    expect(roots.map((r) => [r.label, r.count])).toEqual([
      ['mysql-dev', 1],
      ['pg-prod', 3],
    ]);

    // MySQL：Schema 与库同名时不建 Schema 层
    const crm = roots[0]!.children[0] as any;
    expect(crm.nodeType).toBe('database');
    expect(crm.children.map((c: any) => c.label)).toEqual(['mysql-q']);

    // PG：Schema 目录在前并排序，无 Schema 的查询直接挂在库下
    const shop = roots[1]!.children[0] as any;
    expect(shop.count).toBe(3);
    expect(shop.children.map((c: any) => [c.nodeType, c.label])).toEqual([
      ['schema', 'public'],
      ['schema', 'sales'],
      ['query', 'raw'],
    ]);
  });

  it('缺失连接名或库名时使用占位文案，且节点 id 唯一', () => {
    const roots = buildSavedQueryDbTree(
      [query('x', 9, null, null), query('y', null, null, 'a/b')],
      { unknownConnection: 'Unknown', unspecifiedDatabase: 'N/A' },
    );
    expect(roots.map((r) => r.label)).toEqual(['#9', 'Unknown']);
    expect((roots[0]!.children[0] as any).label).toBe('N/A');

    const ids = new Set<string>();
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        if (n.nodeType === 'query') continue;
        expect(ids.has(n.id)).toBe(false);
        ids.add(n.id);
        walk(n.children);
      }
    };
    walk(roots);
  });
});
