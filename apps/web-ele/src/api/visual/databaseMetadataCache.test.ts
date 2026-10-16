// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({
  server: 'server-a',
  user: { userId: 'u1' } as { userId: string } | null,
  request: vi.fn(),
}));
vi.mock('@vben/stores', () => ({
  useUserStore: () => ({ userInfo: context.user }),
}));
vi.mock('#/config', () => ({ adminUrl: '/admin', baseURL: '/lmdb' }));
vi.mock('#/desktop/runtime', () => ({
  getDesktopServerStorageKey: () => context.server,
}));
vi.mock('#/utils/request', () => ({ default: context.request }));

/** API 缓存回归：真实 IDB 事务语义下验证持久化、身份隔离、精确失效和并发刷新。@author yanch */
describe('数据库元数据 IndexedDB 缓存', () => {
  let api: typeof import('./database');
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      indexedDB: new IDBFactory(),
      location: { href: 'https://db.example/client' },
    });
    context.server = 'server-a';
    context.user = { userId: 'u1' };
    context.request
      .mockReset()
      .mockResolvedValue({ code: 200, data: [{ fieldName: 'id' }] });
    api = await import('./database');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('实例、表和字段请求先查缓存，响应修改不会污染缓存，模块重载后仍能命中', async () => {
    const first = await api.getTableColumns(7, 'app', 'orders');
    first.data[0].fieldName = 'changed';
    expect(
      (await api.getTableColumns(7, 'app', 'orders')).data[0].fieldName,
    ).toBe('id');
    await api.getInstances(7);
    await api.getInstances('7');
    await api.getTables(7, 'app');
    await api.getTables(7, 'app');
    expect(context.request).toHaveBeenCalledTimes(3);
    vi.resetModules();
    api = await import('./database');
    await api.getTableColumns(7, 'app', 'orders');
    expect(context.request).toHaveBeenCalledTimes(3);
  });

  it('同名实例/表按服务端、用户、dbId 隔离，并保留表名大小写', async () => {
    await api.getTableColumns(7, 'app', 'Orders');
    await api.getTableColumns(7, 'app', 'orders');
    await api.getTableColumns(8, 'app', 'orders');
    context.server = 'server-b';
    await api.getTableColumns(7, 'app', 'orders');
    context.user = { userId: 'u2' };
    await api.getTableColumns(7, 'app', 'orders');
    expect(context.request).toHaveBeenCalledTimes(5);
    context.user = { userId: 'u1' };
    context.server = 'server-a';
    await api.getTableColumns(7, 'app', 'orders');
    expect(context.request).toHaveBeenCalledTimes(5);
  });

  it('补全已有列缓存时，查看表信息仍然每次请求后台获取最新结构', async () => {
    await api.getTableColumns(7, 'app', 'orders');
    context.request.mockResolvedValueOnce({
      code: 200,
      data: { columns: [{ fieldName: 'id' }] },
    });
    await api.getTableInfo(7, 'app', 'orders');
    context.request.mockResolvedValueOnce({
      code: 200,
      data: { columns: [{ fieldName: 'new_column' }] },
    });
    const latest = await api.getTableInfo(7, 'app', 'orders');
    expect(latest.data.columns[0].fieldName).toBe('new_column');
    expect(context.request).toHaveBeenCalledTimes(3);
    expect(context.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: '/admin/dataBaseOperate/getTableInfo/7/app/orders',
      }),
    );
  });

  it.each(['executeSql', 'executeSqlBatch'] as const)(
    '%s 每次执行查询，不复用结果缓存',
    async (method) => {
      const query = {
        dbConfigId: 7,
        instanceName: 'app',
        sql: 'SELECT * FROM orders',
      };
      context.request.mockResolvedValueOnce({
        code: 200,
        data: { rows: [{ id: 1 }] },
      });
      await api[method](query);
      context.request.mockResolvedValueOnce({
        code: 200,
        data: { rows: [{ id: 2 }] },
      });
      expect((await api[method](query)).data.rows[0].id).toBe(2);
      expect(context.request).toHaveBeenCalledTimes(2);
    },
  );

  it('刷新浏览对象清理当前 dbId 所有层级，保留其它连接和服务器的数据', async () => {
    await api.getInstances(7);
    await api.getTables(7, 'app');
    await api.getTableColumns(7, 'app', 'orders');
    await api.getInstances(8);
    context.server = 'server-b';
    await api.getInstances(7);
    context.server = 'server-a';
    await api.clearDatabaseMetadataCache(7);
    await api.getInstances(7);
    await api.getTables(7, 'app');
    await api.getTableColumns(7, 'app', 'orders');
    await api.getInstances(8);
    context.server = 'server-b';
    await api.getInstances(7);
    expect(context.request).toHaveBeenCalledTimes(8);
  });

  it('刷新实例只清当前库的表和列，保留实例列表及其它数据库', async () => {
    await api.getInstances(7);
    await api.getTables(7, 'app');
    await api.getTableColumns(7, 'app', 'orders');
    await api.getTables(7, 'other');
    await api.getTableColumns(7, 'other', 'orders');
    await api.clearDatabaseMetadataCache(7, 'app');
    await api.getInstances(7);
    await api.getTables(7, 'other');
    await api.getTableColumns(7, 'other', 'orders');
    expect(context.request).toHaveBeenCalledTimes(5);
    await api.getTables(7, 'app');
    await api.getTableColumns(7, 'app', 'orders');
    expect(context.request).toHaveBeenCalledTimes(7);
  });

  it('刷新 schema 只替换目标分组和字段，其它 schema 继续使用原缓存', async () => {
    context.request.mockResolvedValueOnce({
      code: 200,
      data: [
        { schemaName: 'public', tables: [{ tableName: 'old' }] },
        { schemaName: 'audit', tables: [{ tableName: 'kept' }] },
      ],
    });
    await api.getTableTree(7, 'app');
    await api.getTableColumns(7, 'app', 'public.orders');
    await api.getTableColumns(7, 'app', 'audit.orders');
    await api.clearDatabaseMetadataCache(7, 'app', 'public');
    context.request.mockResolvedValueOnce({
      code: 200,
      data: [
        { schemaName: 'public', tables: [{ tableName: 'new' }] },
        {
          schemaName: 'audit',
          tables: [{ tableName: 'must-not-replace-kept' }],
        },
      ],
    });
    const response = await api.getTableTree(7, 'app');
    expect(
      response.data.map((schema: any) => schema.tables[0].tableName),
    ).toEqual(['new', 'kept']);
    await api.getTableColumns(7, 'app', 'audit.orders');
    expect(context.request).toHaveBeenCalledTimes(4);
    await api.getTableColumns(7, 'app', 'public.orders');
    expect(context.request).toHaveBeenCalledTimes(5);
  });

  it('合并并发请求；刷新前的延迟响应不得重新覆盖最新缓存', async () => {
    let finishOld!: (value: any) => void;
    context.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = api.getTableColumns(7, 'app', 'orders');
    const duplicate = api.getTableColumns(7, 'app', 'orders');
    await vi.waitFor(() => expect(context.request).toHaveBeenCalledTimes(1));
    await api.clearDatabaseMetadataCache(7, 'app');
    context.request.mockResolvedValue({
      code: 200,
      data: [{ fieldName: 'new' }],
    });
    await api.getTableColumns(7, 'app', 'orders');
    finishOld({ code: 200, data: [{ fieldName: 'old' }] });
    const results = await Promise.all([old, duplicate]);
    expect(results.map((result) => result.data[0].fieldName)).toEqual([
      'new',
      'new',
    ]);
    expect(
      (await api.getTableColumns(7, 'app', 'orders')).data[0].fieldName,
    ).toBe('new');
    expect(context.request).toHaveBeenCalledTimes(2);
  });

  it('缓存空列表，但不缓存失败请求', async () => {
    context.request.mockRejectedValueOnce(new Error('denied'));
    await expect(api.getTables(7, 'app')).rejects.toThrow('denied');
    context.request.mockResolvedValue({ code: 200, data: [] });
    expect((await api.getTables(7, 'app')).data).toEqual([]);
    await api.getTables(7, 'app');
    expect(context.request).toHaveBeenCalledTimes(2);
  });

  it('身份未就绪或没有 IndexedDB 时正常请求，且不缓存', async () => {
    context.user = null;
    await api.getInstances(7);
    await api.getInstances(7);
    context.user = { userId: 'u1' };
    vi.stubGlobal('window', { location: window.location });
    await api.getInstances(7);
    await api.getInstances(7);
    expect(context.request).toHaveBeenCalledTimes(4);
  });

  it('缓存写入失败不影响查询，后续请求直接访问后台', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await expect(api.getTables(7, 'app')).resolves.toMatchObject({ code: 200 });
    await api.getTables(7, 'app');
    expect(context.request).toHaveBeenCalledTimes(2);
  });
});
