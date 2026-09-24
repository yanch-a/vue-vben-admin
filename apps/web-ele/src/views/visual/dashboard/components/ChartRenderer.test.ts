/** 渲染器容器尺寸及异常展示回归测试。@author yanch */
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn(), resize: vi.fn() }));
vi.mock('@vben/plugins/echarts', () => ({
  EchartsUI: defineComponent({
    props: ['height', 'width'],
    setup: (props) => () =>
      h('div', {
        class: 'echarts-test',
        style: { height: props.height, width: props.width },
      }),
  }),
  useEcharts: () => ({ renderEcharts: mocks.render, resize: mocks.resize }),
}));

import ChartRenderer from './ChartRenderer.vue';

let app: App | undefined;
let container: HTMLElement;
afterEach(() => {
  app?.unmount();
  app = undefined;
  container?.remove();
  vi.clearAllMocks();
});

/** 使用真实 Vue 生命周期，避免仅通过源文件字符串判断高度配置。 */
async function mountRenderer(
  onError?: (message: string) => void,
  result?: Record<string, unknown>,
) {
  container = document.createElement('div');
  document.body.append(container);
  app = createApp(ChartRenderer, {
    spec: { chartType: 'bar', xField: 'category', yFields: ['amount'] },
    result: result ?? {
      columns: ['category', 'amount'],
      rows: [{ category: 'A', amount: 10 }],
    },
    onError,
  });
  app.mount(container);
  await nextTick();
  await nextTick();
  await Promise.resolve();
}

describe('大屏图表渲染器', () => {
  it('EchartsUI 高度填满容器，不再使用默认 300px', async () => {
    mocks.render.mockResolvedValue(null);
    await mountRenderer();
    const el = container.querySelector<HTMLElement>('.echarts-test')!;
    expect(el.style.height).toBe('100%');
    expect(el.style.width).toBe('100%');
    expect(mocks.render).toHaveBeenCalled();
    expect(mocks.resize).toHaveBeenCalled();
  });

  it('语义无效的 option 只显示当前图表错误，不抛出未捕获异常', async () => {
    mocks.render.mockRejectedValue(new Error('invalid series type'));
    const onError = vi.fn();
    await mountRenderer(onError);
    await nextTick();
    expect(container.textContent).toContain('invalid series type');
    expect(onError).toHaveBeenCalledWith('invalid series type');
  });

  it('成功查询 message（Query OK）不显示遮罩，图表仍渲染', async () => {
    mocks.render.mockResolvedValue(null);
    await mountRenderer(undefined, {
      columns: ['category', 'amount'],
      rows: [{ category: 'A', amount: 10 }],
      rowCount: 1,
      message: 'Query OK, 36 row(s) returned (SQL LIMIT)',
    });
    expect(container.querySelector('.render-error')).toBeNull();
    expect(container.textContent || '').not.toContain('Query OK');
    expect(mocks.render).toHaveBeenCalled();
  });

  it('真实 soft-fail message 才显示遮罩', async () => {
    mocks.render.mockResolvedValue(null);
    await mountRenderer(undefined, {
      columns: [],
      rows: [],
      rowCount: 0,
      message: '请先绑定数据源：选择数据库连接',
    });
    const overlay = container.querySelector('.render-error');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent || '').toContain('请先绑定数据源');
  });
});
