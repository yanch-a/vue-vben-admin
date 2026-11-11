import { createApp, h, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectionDialog from './ConnectionDialog.vue';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  profiles: vi.fn(),
}));

vi.mock('#/api/visual/vq', () => ({
  getDbConfigList: api.list,
  getDbConfigById: vi.fn(),
  editDbConfig: vi.fn(),
}));

vi.mock('#/api/visual/database', () => ({
  getDbTypeProfiles: api.profiles,
  previewJdbcUrl: vi.fn(),
  testConnection: vi.fn(),
  testConnectionDraft: vi.fn(),
}));

/** 已保存连接行，供打开弹窗列表渲染。 */
const savedConnection = {
  id: 7,
  dbName: '测试库',
  dbType: 'MY_SQL',
  dbHost: '127.0.0.1',
  schemaName: 'app',
  env: 'DEV',
};

/**
 * 验证打开连接弹窗操作列的「打开」按钮。
 * 弹窗平时保持挂载，只有可见性从关到开时才拉列表，测试按同样方式打开。
 * @author yanch
 */
describe('打开连接弹窗', () => {
  let unmount: (() => void) | undefined;
  const opened: unknown[] = [];

  afterEach(() => {
    unmount?.();
    document.body.innerHTML = '';
    opened.length = 0;
    vi.clearAllMocks();
  });

  /** 挂载真实弹窗，再切换为打开模式，等待连接列表出现。 */
  async function openDialog() {
    api.list.mockResolvedValue({ data: [savedConnection] });
    api.profiles.mockResolvedValue({ data: [] });
    const props = reactive({ modelValue: false, mode: 'open' as const });
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () =>
        h(ConnectionDialog, {
          ...props,
          'onUpdate:modelValue': (visible: boolean) => {
            props.modelValue = visible;
          },
          onOpened: (row: unknown) => opened.push(row),
        }),
    });
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    unmount = () => app.unmount();
    props.modelValue = true;
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('测试库');
    });
    return props;
  }

  /** 只取表格操作列里的按钮，避免点到底部同名的「打开」。 */
  function operationButtons() {
    const table = document.body.querySelector('.el-table');
    return [...(table?.querySelectorAll('button') ?? [])];
  }

  it('操作列点击打开后打开该连接并关闭弹窗', async () => {
    const props = await openDialog();
    const openButton = operationButtons().find(
      (button) => button.textContent?.trim() === '打开',
    );
    const editButton = operationButtons().find(
      (button) => button.textContent?.trim() === '编辑',
    );
    expect(openButton).toBeDefined();
    expect(editButton).toBeDefined();

    openButton!.click();
    await nextTick();

    expect(opened).toEqual([
      expect.objectContaining({ id: 7, dbName: '测试库' }),
    ]);
    // 弹窗关闭通过 v-model 回写给父组件。
    expect(props.modelValue).toBe(false);
  });
});
