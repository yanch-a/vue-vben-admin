/** ECharts 自定义配置优先级及异常传播回归测试。@author yanch */
import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
  clear: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./echarts', () => ({ default: { init: mocks.init } }));
vi.mock('@vben/preferences', () => ({
  usePreferences: () => ({ isDark: ref(true) }),
}));

import { useEcharts } from './use-echarts';

let app: App;
let container: HTMLElement;
let chart: ReturnType<typeof useEcharts>;

beforeEach(async () => {
  vi.useFakeTimers();
  mocks.setOption.mockReset();
  container = document.createElement('div');
  Object.defineProperties(container, {
    offsetHeight: { value: 200 },
    offsetWidth: { value: 300 },
  });
  document.body.append(container);
  mocks.init.mockImplementation((el) => ({
    getDom: () => el,
    setOption: mocks.setOption,
    clear: mocks.clear,
    resize: mocks.resize,
    dispose: mocks.dispose,
  }));
  app = createApp({
    setup: () => {
      chart = useEcharts(ref({ $el: container }) as any);
      return () => h('div');
    },
  });
  app.mount(container);
  await nextTick();
});

afterEach(() => {
  app.unmount();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('自定义 ECharts option', () => {
  it('深色主题的透明背景默认值不覆盖用户显式背景', async () => {
    const result = chart.renderEcharts({
      backgroundColor: '#123456',
      series: [],
    });
    await vi.advanceTimersByTimeAsync(60);
    await result;
    expect(mocks.setOption).toHaveBeenCalledWith({
      backgroundColor: '#123456',
      series: [],
    });
  });

  it('渲染异常通过 promise 返回给图表错误 UI，而不是从定时回调逃逸', async () => {
    mocks.setOption.mockImplementation(() => {
      throw new Error('bad option');
    });
    const assertion = expect(
      chart.renderEcharts({ series: [] }),
    ).rejects.toThrow('bad option');
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });
});
