import { createApp, nextTick } from 'vue';

import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbConnection } from '../composables/useConnectionStore';
import { useClientPreferences } from '../composables/useClientPreferences';
import ConnectionTabs from './ConnectionTabs.vue';

/** 挂载真实连接栏，核对右键菜单文案和关闭事件。 @author yanch */
describe('数据库连接栏右键菜单', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    cleanup.splice(0).forEach((close) => close());
    document.body.innerHTML = '';
  });

  function connection(sessionId: string, dbName: string): DbConnection {
    return {
      id: sessionId,
      sessionId,
      dbName,
      dbType: 'MySQL',
      dbHost: '127.0.0.1',
    };
  }

  function mount(
    connections: DbConnection[],
    listeners: {
      onClose?: (sessionId: number | string) => void;
      onCloseAll?: () => void;
      onCloseOthers?: (sessionId: number | string) => void;
    } = {},
  ) {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(ConnectionTabs, {
      connections,
      activeId: connections[0]?.sessionId ?? null,
      ...listeners,
    });
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    cleanup.push(() => app.unmount());
    return host;
  }

  async function openTabMenu(host: HTMLElement, index: number) {
    const tab = host.querySelectorAll<HTMLElement>('.conn-tab')[index];
    tab.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }),
    );
    await nextTick();
    const menu = document.querySelector<HTMLElement>('.conn-ctx-menu');
    expect(menu).not.toBeNull();
    return menu!;
  }

  function menuItem(menu: HTMLElement, label: string) {
    return [...menu.querySelectorAll<HTMLElement>('.item')].find(
      (item) => item.textContent?.trim() === label,
    );
  }

  it('连接页签右键可以关闭当前、全部和其他连接', async () => {
    const onClose = vi.fn();
    const onCloseAll = vi.fn();
    const onCloseOthers = vi.fn();
    const host = mount(
      [
        connection('sess-a', '订单库'),
        connection('sess-b', '库存库'),
        connection('sess-c', '日志库'),
      ],
      { onClose, onCloseAll, onCloseOthers },
    );

    const menu = await openTabMenu(host, 1);
    expect(menuItem(menu, '关闭')).toBeTruthy();
    expect(menuItem(menu, '关闭所有')).toBeTruthy();
    expect(menuItem(menu, '关闭其他')?.classList.contains('disabled')).toBe(false);

    menuItem(menu, '关闭')!.click();
    expect(onClose).toHaveBeenCalledWith('sess-b');

    const reopened = await openTabMenu(host, 1);
    menuItem(reopened, '关闭所有')!.click();
    expect(onCloseAll).toHaveBeenCalledTimes(1);

    const others = await openTabMenu(host, 1);
    menuItem(others, '关闭其他')!.click();
    expect(onCloseOthers).toHaveBeenCalledWith('sess-b');
  });

  it('只打开一条连接时关闭其他不可用，空白处右键没有关闭项', async () => {
    const onCloseOthers = vi.fn();
    const host = mount([connection('sess-a', '订单库')], { onCloseOthers });

    const menu = await openTabMenu(host, 0);
    const closeOthers = menuItem(menu, '关闭其他');
    expect(closeOthers?.classList.contains('disabled')).toBe(true);
    closeOthers!.click();
    expect(onCloseOthers).not.toHaveBeenCalled();

    host.querySelector<HTMLElement>('.bar-spacer')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 20 }),
    );
    await nextTick();
    const blank = document.querySelector<HTMLElement>('.conn-ctx-menu')!;
    expect(blank.textContent).toContain('保存工作现场');
    expect(blank.textContent).not.toContain('关闭所有');
    expect(blank.textContent).not.toContain('关闭其他');
  });

  it('精简链接标题只显示连接名，环境标识浮在左上角', async () => {
    const { compactConnectionTitle } = useClientPreferences();
    compactConnectionTitle.value = true;
    try {
      const host = mount([
        {
          ...connection('sess-a', '订单库'),
          env: 'PROD',
          envLabel: '生产库',
        },
      ]);
      await nextTick();
      const tab = host.querySelector<HTMLElement>('.conn-tab')!;
      expect(tab.classList.contains('conn-tab--compact')).toBe(true);
      expect(tab.querySelector('.meta')).toBeNull();
      expect(tab.querySelector('.name')?.textContent).toBe('订单库');
      const badge = tab.querySelector('.env-badge');
      expect(badge?.classList.contains('env-badge--corner')).toBe(true);
      expect(badge?.textContent).toBe('PROD');
      expect(tab.getAttribute('title')).toContain('生产库');
      expect(tab.getAttribute('title')).toContain('MySQL');
      expect(tab.getAttribute('title')).toContain('127.0.0.1');
    } finally {
      compactConnectionTitle.value = false;
    }
  });

  it('默认模式保留类型和主机，环境标识浮在左上角', async () => {
    const { compactConnectionTitle } = useClientPreferences();
    compactConnectionTitle.value = false;
    const host = mount([
      {
        ...connection('sess-a', '订单库'),
        env: 'TEST',
        envLabel: '测试',
      },
    ]);
    await nextTick();
    const tab = host.querySelector<HTMLElement>('.conn-tab')!;
    expect(tab.classList.contains('conn-tab--compact')).toBe(false);
    expect(tab.querySelector('.meta')?.textContent).toContain('MySQL');
    expect(tab.querySelector('.meta')?.textContent).toContain('127.0.0.1');
    const badge = tab.querySelector('.env-badge');
    expect(badge?.classList.contains('env-badge--corner')).toBe(true);
    expect(tab.querySelector('.name')?.contains(badge!)).toBe(false);
    expect(badge?.textContent).toBe('TEST');
    expect(tab.getAttribute('title')).toContain('测试');
  });
});
