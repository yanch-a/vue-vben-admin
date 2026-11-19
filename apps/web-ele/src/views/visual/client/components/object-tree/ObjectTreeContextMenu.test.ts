import { createApp, h } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';

import ObjectTreeContextMenu from './ObjectTreeContextMenu.vue';

/** 库节点右键菜单是否出现「改变数据库」。 @author yanch */
describe('对象树右键菜单', () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    document.body.innerHTML = '';
  });

  function mount(canAlterDatabase: boolean) {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () =>
        h(ObjectTreeContextMenu, {
          visible: true,
          x: 10,
          y: 10,
          targetType: 'instance',
          canManageInstance: true,
          canAlterDatabase,
          instanceLabel: '数据库',
        }),
    });
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    unmount = () => app.unmount();
  }

  it('可修改字符集的库显示改变数据库', () => {
    mount(true);
    expect(document.body.textContent).toContain('改变数据库');
  });

  it('不能修改字符集的库不显示改变数据库', () => {
    mount(false);
    expect(document.body.textContent).not.toContain('改变数据库');
    expect(document.body.textContent).toContain('创建');
  });
});
