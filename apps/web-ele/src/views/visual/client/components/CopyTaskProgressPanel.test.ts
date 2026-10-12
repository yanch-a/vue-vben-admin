import { createApp, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import CopyTaskProgressPanel from './CopyTaskProgressPanel.vue';

/** 复制进度必须准确表达提交、收尾和取消状态。 @author yanch */
describe('跨主机复制进度', () => {
  let close: (() => void) | undefined;
  afterEach(() => { close?.(); document.body.innerHTML = ''; });

  function mount(overrides: Record<string, unknown>) {
    const task = reactive({ taskId: 'copy-fixture', status: 'RUNNING', sourceInstance: 'src', targetInstance: 'dst',
      totalObjects: 2, processedObjects: 2, successCount: 1, skippedCount: 1, copiedRows: 100, currentTableRows: 7,
      errors: [], ...overrides });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp(CopyTaskProgressPanel, { modelValue: true, task } as any);
    app.use(ElementPlus); app.config.globalProperties.$tr = (value: unknown) => String(value);
    app.mount(host); close = () => app.unmount(); return task;
  }

  it('外键收尾阶段不能提前显示 100%，累计行数标记为已提交', async () => {
    mount({ progressPercent: 100, message: '正在补建外键约束' }); await nextTick(); await nextTick();
    expect(document.body.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('99');
    expect(document.body.textContent).toContain('已提交'); expect(document.body.textContent).toContain('跳过');
    expect(document.body.textContent).toContain('正在补建外键约束');
  });

  it('取消请求等待回滚期间保持运行状态并禁用重复取消', async () => {
    const task = mount({ cancelRequested: true }); await nextTick(); await nextTick();
    expect(document.body.textContent).toContain('正在取消'); expect(document.body.textContent).not.toContain('已取消');
    const cancel = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('正在取消'));
    expect(cancel?.disabled).toBe(true);
    task.status = 'CANCELLED'; await nextTick();
    expect(document.body.textContent).toContain('已取消');
  });
});
