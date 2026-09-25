import { describe, expect, it } from 'vitest';

import {
  foldersToSearch,
  objectNodeMatchesKeyword,
  resolveObjectSearchScope,
  shouldCollapseTablesOnClick,
} from './objectTreeSearch';

/**
 * 对象树检索范围：实例检索全部分类，Tables 只检索表，换目录后还原上一批结果。
 *
 * @author yanch
 */
describe('对象树检索范围', () => {
  const table = {
    nodeType: 'table',
    instanceName: 'app',
    schemaName: 'public',
    name: 'orders',
    label: 'orders',
  };
  const otherTable = {
    nodeType: 'table',
    instanceName: 'app',
    schemaName: 'public',
    name: 'users',
    label: 'users',
  };
  const view = {
    nodeType: 'views',
    instanceName: 'app',
    schemaName: 'public',
    name: 'v_orders',
    label: 'v_orders',
  };

  it('选中实例时检索全部分类，选中 Tables 时只检索表', () => {
    expect(
      resolveObjectSearchScope({ nodeType: 'instance', instanceName: 'app' }),
    ).toEqual({ type: 'instance', instanceName: 'app' });
    expect(
      resolveObjectSearchScope({
        nodeType: 'folder',
        objectKind: 'tables',
        instanceName: 'app',
      }),
    ).toEqual({ type: 'folder', instanceName: 'app', objectKind: 'tables' });
    expect(
      foldersToSearch(
        { type: 'instance', instanceName: 'app' },
        ['tables', 'views', 'queries'],
      ),
    ).toEqual(['tables', 'views', 'queries']);
    expect(
      foldersToSearch(
        { type: 'folder', instanceName: 'app', objectKind: 'tables' },
        ['tables', 'views', 'queries'],
      ),
    ).toEqual(['tables']);
  });

  it('没点树时用编辑器当前库做实例级检索', () => {
    expect(resolveObjectSearchScope(null, 'app')).toEqual({
      type: 'instance',
      instanceName: 'app',
    });
    expect(resolveObjectSearchScope(null, '')).toBeNull();
  });

  it('点在表或视图上时只检索对应目录', () => {
    const tableScope = resolveObjectSearchScope(table);
    const viewScope = resolveObjectSearchScope(view);
    expect(tableScope?.type).toBe('folder');
    expect(viewScope?.type).toBe('folder');
    if (tableScope?.type === 'folder') expect(tableScope.objectKind).toBe('tables');
    if (viewScope?.type === 'folder') expect(viewScope.objectKind).toBe('views');
  });

  it('先检索表再检索视图时，表恢复完整列表', () => {
    const tablesScope = {
      type: 'folder' as const,
      instanceName: 'app',
      schemaName: 'public',
      objectKind: 'tables',
    };
    expect(objectNodeMatchesKeyword(table, 'order', tablesScope)).toBe(true);
    expect(objectNodeMatchesKeyword(otherTable, 'order', tablesScope)).toBe(false);
    // 视图不在本次范围，不能被表检索藏掉
    expect(objectNodeMatchesKeyword(view, 'order', tablesScope)).toBe(true);

    const viewsScope = {
      type: 'folder' as const,
      instanceName: 'app',
      schemaName: 'public',
      objectKind: 'views',
    };
    expect(objectNodeMatchesKeyword(table, 'zzz', viewsScope)).toBe(true);
    expect(objectNodeMatchesKeyword(otherTable, 'zzz', viewsScope)).toBe(true);
    expect(objectNodeMatchesKeyword(view, 'zzz', viewsScope)).toBe(false);
    expect(objectNodeMatchesKeyword(view, 'order', viewsScope)).toBe(true);
  });

  it('选中实例时只过滤该实例，其它实例保持原列表', () => {
    const scope = { type: 'instance' as const, instanceName: 'app' };
    const foreign = { ...table, instanceName: 'other', name: 'audit' };
    expect(objectNodeMatchesKeyword(otherTable, 'order', scope)).toBe(false);
    expect(objectNodeMatchesKeyword(foreign, 'order', scope)).toBe(true);
  });

  it('清空关键字后全部显示', () => {
    const scope = { type: 'folder' as const, instanceName: 'app', objectKind: 'tables' };
    expect(objectNodeMatchesKeyword(otherTable, '   ', scope)).toBe(true);
  });

  it('分类目录在检索时保持显示，只隐藏不匹配的对象', () => {
    const scope = { type: 'folder' as const, instanceName: 'app', objectKind: 'tables' };
    const folder = {
      nodeType: 'folder',
      objectKind: 'tables',
      instanceName: 'app',
      label: 'Tables',
    };
    expect(objectNodeMatchesKeyword(folder, 'order', scope)).toBe(true);
    expect(objectNodeMatchesKeyword(otherTable, 'order', scope)).toBe(false);
  });

  it('没有选中范围时仍按名称过滤已加载节点', () => {
    expect(objectNodeMatchesKeyword(table, 'order', null)).toBe(true);
    expect(objectNodeMatchesKeyword(otherTable, 'order', null)).toBe(false);
  });

  it('检索时点 Views 等节点要收起 Tables，点 Tables 本身或表不收', () => {
    expect(shouldCollapseTablesOnClick({ nodeType: 'folder', objectKind: 'views' })).toBe(true);
    expect(shouldCollapseTablesOnClick({ nodeType: 'views' })).toBe(true);
    expect(shouldCollapseTablesOnClick({ nodeType: 'instance' })).toBe(true);
    expect(shouldCollapseTablesOnClick({ nodeType: 'schema' })).toBe(true);
    expect(shouldCollapseTablesOnClick({ nodeType: 'folder', objectKind: 'tables' })).toBe(false);
    expect(shouldCollapseTablesOnClick({ nodeType: 'table' })).toBe(false);
    expect(shouldCollapseTablesOnClick({ nodeType: 'column' })).toBe(false);
    expect(shouldCollapseTablesOnClick(null)).toBe(false);
  });
});
