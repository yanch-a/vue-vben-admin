import { createApp, h, nextTick, ref } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  clearDatabaseMetadataCache: vi.fn(),
  getInstances: vi.fn(),
  getTables: vi.fn(),
  getTableTree: vi.fn(),
  getTableColumns: vi.fn(),
  getViews: vi.fn(),
  getProcedures: vi.fn(),
  getFunctions: vi.fn(),
  getTriggers: vi.fn(),
  getEvents: vi.fn(),
}));
vi.mock('#/api/visual/database', () => api);
vi.mock('#/api/visual/savedQuery', () => ({
  listSavedQueries: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock('../../composables/useClientPreferences', () => ({
  useClientPreferences: () => ({ preferences: { hideTableComments: false } }),
}));
import ObjectTree from './ObjectTree.vue';

/** 真实 ElTree 验证刷新范围及兄弟节点状态，防止只测 API 而漏掉展示层旧节点。@author yanch */
describe('对象树按范围刷新', () => {
  let host: HTMLElement;
  let unmount: () => void;
  const tree = ref<any>();
  beforeEach(() => {
    vi.clearAllMocks();
    api.getInstances.mockResolvedValue({
      data: [
        { instances: [{ instanceName: 'app' }, { instanceName: 'other' }] },
      ],
    });
    api.getTables.mockResolvedValue({ data: [{ tableName: 'orders' }] });
    api.getTableColumns.mockResolvedValue({ data: [{ fieldName: 'id' }] });
    api.getTableTree.mockResolvedValue({
      data: [
        {
          schemaName: 'public',
          tables: [
            {
              tableName: 'orders',
              qualifiedName: 'public.orders',
              schemaName: 'public',
            },
          ],
        },
        {
          schemaName: 'audit',
          tables: [
            {
              tableName: 'logs',
              qualifiedName: 'audit.logs',
              schemaName: 'audit',
            },
          ],
        },
      ],
    });
    for (const fn of [
      api.getViews,
      api.getProcedures,
      api.getFunctions,
      api.getTriggers,
      api.getEvents,
    ])
      fn.mockResolvedValue({ data: [] });
  });
  afterEach(() => {
    unmount?.();
    document.body.innerHTML = '';
  });

  /** 挂载实际树组件，等待初次实例请求完成。 */
  async function mount(schemaMode?: 'postgresql') {
    host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () =>
        h(ObjectTree, {
          ref: tree,
          dbConfigId: 7,
          dbType: schemaMode ? 'POSTGRE_SQL' : 'MY_SQL',
          schemaMode,
        }),
    });
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    unmount = () => app.unmount();
    await vi.waitFor(() => expect(host.textContent).toContain('app'));
  }

  /** 模拟点行展开，返回节点容器以便检查该分支自己的内容和展开状态。 */
  async function expand(
    label: string,
    scope: Element = host,
  ): Promise<HTMLElement> {
    const text = [
      ...scope.querySelectorAll<HTMLElement>('.tree-node-text'),
    ].find((element) => element.textContent === label);
    expect(text, `找不到树节点 ${label}`).toBeDefined();
    text!.click();
    await nextTick();
    const node = text!.closest<HTMLElement>('.el-tree-node')!;
    await vi.waitFor(() =>
      expect(node.classList.contains('is-expanded')).toBe(true),
    );
    await nextTick();
    return node;
  }

  it('刷新单库重新加载 Tables，实例列表和其它库的展开状态保持不变', async () => {
    await mount();
    const app = await expand('app');
    await expand('Tables', app);
    const other = await expand('other');
    await expand('Tables', other);
    await vi.waitFor(() => expect(api.getTables).toHaveBeenCalledTimes(2));
    await tree.value.reloadInstance('app');
    expect(api.clearDatabaseMetadataCache).toHaveBeenCalledWith(
      7,
      'app',
      undefined,
    );
    expect(api.getInstances).toHaveBeenCalledTimes(1);
    expect(api.getTables).toHaveBeenLastCalledWith(7, 'app');
    expect(other.classList.contains('is-expanded')).toBe(true);
    expect(other.textContent).toContain('orders');
  });

  it('刷新 schema 只替换指定分支，其它 schema 保留原节点', async () => {
    await mount('postgresql');
    const app = await expand('app');
    await vi.waitFor(() => expect(app.textContent).toContain('public'));
    const audit = await expand('audit', app);
    await expand('Tables', audit);
    await vi.waitFor(() => expect(audit.textContent).toContain('logs'));
    const oldAuditHtml = audit.innerHTML;
    api.getTableTree.mockResolvedValue({
      data: [
        {
          schemaName: 'public',
          tables: [{ tableName: 'new_table', schemaName: 'public' }],
        },
        {
          schemaName: 'audit',
          tables: [{ tableName: 'must-not-replace-logs', schemaName: 'audit' }],
        },
      ],
    });
    await tree.value.reloadInstance('app', 'public');
    expect(api.clearDatabaseMetadataCache).toHaveBeenCalledWith(
      7,
      'app',
      'public',
    );
    expect(api.getInstances).toHaveBeenCalledTimes(1);
    expect(audit.innerHTML).toBe(oldAuditHtml);
    const publicNode = [...app.querySelectorAll<HTMLElement>('.tree-node-text')]
      .find((element) => element.textContent === 'public')!
      .closest<HTMLElement>('.el-tree-node')!;
    await expand('Tables', publicNode);
    await vi.waitFor(() =>
      expect(publicNode.textContent).toContain('new_table'),
    );
  });

  it('刷新浏览对象先清 dbId 缓存，再重新加载实例', async () => {
    await mount();
    api.getInstances.mockResolvedValue({
      data: [{ instances: [{ instanceName: 'new_database' }] }],
    });
    await tree.value.reload();
    expect(api.clearDatabaseMetadataCache).toHaveBeenCalledWith(
      7,
      undefined,
      undefined,
    );
    expect(
      api.clearDatabaseMetadataCache.mock.invocationCallOrder[0],
    ).toBeLessThan(api.getInstances.mock.invocationCallOrder[1]!);
    await vi.waitFor(() => expect(host.textContent).toContain('new_database'));
    expect(host.textContent).not.toContain('other');
  });
});
