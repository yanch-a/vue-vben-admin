import { createApp, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import ClientTaskPanel from './ClientTaskPanel.vue';
import DbBackupProgressPanel from './DbBackupProgressPanel.vue';
import type { ClientTask } from '../composables/useClientTasks';

/** 挂载真实 Vue/Element Plus 组件，验证用户看到的状态及可操作按钮。 @author yanch */
describe('数据库后台任务面板', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.splice(0).forEach(close => close()); document.body.innerHTML = ''; });

  /** 渲染夹具只传任务快照，不调用用户后台接口。 */
  function mount(component: any, props: Record<string, any>) {
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp(component, props); app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host); cleanup.push(() => app.unmount());
    return host;
  }
  function task(overrides: Partial<ClientTask> = {}): ClientTask {
    return { id: 'fixture', source: 'dbBackup', kind: 'DB_BACKUP', title: '备份 APP', subtitle: '官方客户端 · MongoDB Archive',
      status: 'RUNNING', total: 0, done: 0, createTime: Date.now(), errors: [], engine: 'NATIVE', fileSize: 3 * 1024 ** 2, ...overrides };
  }

  it('官方导出显示持续进度和文件大小，成功才出现下载', async () => {
    const snapshot = reactive(task());
    const host = mount(ClientTaskPanel, { modelValue: true, running: [snapshot], done: [], tab: 'running' });
    await nextTick();
    expect(host.textContent).toContain('3.0 MB');
    expect(host.querySelector('.el-progress-bar__inner--indeterminate')).not.toBeNull();
    expect(host.textContent).not.toContain('50%');
    expect(host.textContent).not.toContain('下载');
  });

  it('压缩和取消阶段没有错误的完成提示或重复取消按钮', async () => {
    const snapshot = reactive(task({ engine: 'JDBC', total: 8, done: 8, phase: 'PACKING', cancelRequested: true, message: '正在压缩为 ZIP' }));
    const host = mount(ClientTaskPanel, { modelValue: true, running: [snapshot], done: [], tab: 'running' });
    await nextTick();
    expect(host.textContent).toContain('正在压缩为 ZIP'); expect(host.textContent).toContain('取消中');
    expect(host.textContent).not.toContain('100%');
    const cancel = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('取消中'));
    expect(cancel?.disabled).toBe(true);
  });

  it('完成窗口显示 100% 和下载，已过期文件不会显示下载', async () => {
    const snapshot = reactive(task({ status: 'SUCCESS', downloadReady: true, fileName: 'APP.archive' }));
    mount(DbBackupProgressPanel, { modelValue: true, task: snapshot });
    await nextTick(); await nextTick();
    expect(document.body.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
    expect(document.body.textContent).toContain('已完成'); expect(document.body.textContent).toContain('APP.archive');
    expect(document.body.textContent).toContain('下载');
    snapshot.downloadReady = false; await nextTick();
    expect(document.body.textContent).not.toContain('下载');
  });
});
