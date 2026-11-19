import { createApp, h, nextTick } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  executeSql: vi.fn(),
  executeDdl: vi.fn(),
}));
vi.mock('#/api/visual/database', () => api);

import AlterDatabaseDialog from './AlterDatabaseDialog.vue';

/** 改变数据库弹窗：读取当前值、保留排序规则，未改动时不执行。 @author yanch */
describe('改变数据库弹窗', () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    api.executeSql.mockResolvedValue({
      data: {
        rows: [{ charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }],
      },
    });
    api.executeDdl.mockResolvedValue({ data: { message: 'ok' } });
  });

  afterEach(() => {
    unmount?.();
    document.body.innerHTML = '';
  });

  async function mount(dbType = 'MY_SQL') {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () =>
        h(AlterDatabaseDialog, {
          modelValue: true,
          dbConfigId: 7,
          dbType,
          databaseName: 'app',
        }),
    });
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    unmount = () => app.unmount();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('ALTER DATABASE'),
    );
  }

  it('打开后展示当前字符集和排序规则，未修改时不执行', async () => {
    await mount();
    expect(document.body.textContent).toContain('utf8mb4_0900_ai_ci');
    expect(document.body.textContent).toContain(
      'ALTER DATABASE `app` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;',
    );
    const button = [...document.body.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('确定修改'),
    );
    button?.click();
    await nextTick();
    expect(api.executeDdl).not.toHaveBeenCalled();
  });

  it('改成新的排序规则后执行 ALTER，并仍然连在这个库上', async () => {
    await mount();
    const selects = [...document.body.querySelectorAll('.el-select')];
    const collationSelect = selects[1] as HTMLElement;
    collationSelect.click();
    await nextTick();
    const option = [...document.body.querySelectorAll('.el-select-dropdown__item')].find(
      (item) => item.textContent?.trim() === 'utf8mb4_unicode_ci',
    );
    expect(option).toBeTruthy();
    (option as HTMLElement).click();
    await nextTick();
    const button = [...document.body.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('确定修改'),
    );
    button?.click();
    await vi.waitFor(() => expect(api.executeDdl).toHaveBeenCalledTimes(1));
    expect(api.executeDdl).toHaveBeenCalledWith({
      dbConfigId: 7,
      instanceName: 'app',
      sql: 'ALTER DATABASE `app` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    });
  });
});
