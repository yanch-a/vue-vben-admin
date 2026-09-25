import { describe, expect, it } from 'vitest';

import {
  createObjectTreeCache,
  resolveObjectTreeSessionScope,
} from './objectTreeCache';

/**
 * 对象树会话缓存：同一用户重复打开命中缓存，切换用户或地址后重新拉取。
 *
 * @author yanch
 */
describe('对象树会话缓存', () => {
  const identity = { dbConfigId: 7, dbType: 'mysql', schemaMode: '' };

  it('没有用户身份时不生成缓存键', () => {
    expect(resolveObjectTreeSessionScope('desktop-a', '')).toBe('');
    expect(resolveObjectTreeSessionScope('', 'u1')).toBe('web::u1');
    expect(resolveObjectTreeSessionScope('desktop-a', 'u1')).toBe('desktop-a::u1');
  });

  it('未加载过时没有缓存，写入后再次读取不访问旧对象', () => {
    const cache = createObjectTreeCache(() => 'web::u1');
    expect(cache.readInstances(identity)).toBeNull();
    const nodes = [{ id: 'ins-app', label: 'app' }];
    cache.writeInstances(identity, nodes);
    nodes[0]!.label = 'changed';
    const read = cache.readInstances(identity);
    expect(read).toEqual([{ id: 'ins-app', label: 'app' }]);
    read![0].label = 'mutated';
    expect(cache.readInstances(identity)?.[0].label).toBe('app');
  });

  it('刷新目录会覆盖缓存，刷新表目录时清掉字段缓存', () => {
    const cache = createObjectTreeCache(() => 'web::u1');
    cache.writeFolder(identity, 'tables-app', [{ name: 'old_table' }]);
    cache.writeColumns(identity, 'table-app-old_table', [{ name: 'id' }]);
    cache.writeFolder(identity, 'tables-app', [{ name: 'new_table' }]);
    cache.invalidateColumns(identity, 'app');
    expect(cache.readFolder(identity, 'tables-app')).toEqual([{ name: 'new_table' }]);
    expect(cache.readColumns(identity, 'table-app-old_table')).toBeNull();
  });

  it('切换用户或服务端地址后读不到上一份缓存', () => {
    let scope = 'desktop-a::u1';
    const cache = createObjectTreeCache(() => scope);
    cache.writeInstances(identity, [{ id: 'ins-app', label: 'app' }]);
    cache.writeFolder(identity, 'tables-app', [{ name: 'orders' }]);

    scope = 'desktop-a::u2';
    expect(cache.readInstances(identity)).toBeNull();
    expect(cache.readFolder(identity, 'tables-app')).toBeNull();

    scope = 'desktop-b::u1';
    expect(cache.readInstances(identity)).toBeNull();
  });

  it('主动刷新连接会清掉该连接的目录缓存', () => {
    const cache = createObjectTreeCache(() => 'web::u1');
    cache.writeInstances(identity, [{ id: 'ins-app' }]);
    cache.writeSchemaChildren(identity, 'app', [{ schemaName: 'public' }]);
    cache.invalidateConnection(identity);
    expect(cache.readInstances(identity)).toBeNull();
    expect(cache.readSchemaChildren(identity, 'app')).toBeNull();
  });

  it('用户身份为空时不读写缓存', () => {
    const cache = createObjectTreeCache(() => '');
    cache.writeInstances(identity, [{ id: 'ins-app' }]);
    expect(cache.readInstances(identity)).toBeNull();
  });
});
