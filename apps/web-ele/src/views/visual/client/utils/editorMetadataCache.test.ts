import { afterEach, describe, expect, it } from 'vitest';

import {
  bindEditorMetadataScope,
  clearTablesCatalog,
  getAllRememberedTables,
  getRememberedTables,
  invalidateEditorMetadata,
  rememberInstanceTables,
} from './sqlEditorAssist';

/** 编辑器同步表名索引必须跟随 API 身份和刷新范围，字段统一由 API 缓存。@author yanch */
describe('编辑器派生表名索引', () => {
  afterEach(() => {
    clearTablesCatalog();
    bindEditorMetadataScope(() => '');
  });
  it('隔离用户/服务端，并只移除刷新的 schema', () => {
    let scope = 'server-a/u1';
    bindEditorMetadataScope(() => scope);
    rememberInstanceTables(7, 'app', ['public.orders', 'audit.orders']);
    rememberInstanceTables(7, 'other', ['customers']);
    scope = 'server-a/u2';
    expect(getAllRememberedTables(7)).toEqual([]);
    scope = 'server-a/u1';
    invalidateEditorMetadata(7, 'app', 'public');
    expect(
      getRememberedTables(7, 'app').map((table) => table.tableName),
    ).toEqual(['audit.orders']);
    expect(getRememberedTables(7, 'other')).toHaveLength(1);
    invalidateEditorMetadata(7);
    expect(getAllRememberedTables(7)).toEqual([]);
  });
});
