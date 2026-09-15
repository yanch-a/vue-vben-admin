/** 外观编辑及高级 JSON 应用/取消交互回归测试。@author yanch */
import type { ChartSpec } from '../../../../api/visual/dashboard';

import ElementPlus, { ElForm } from 'element-plus';
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  watch,
  type App,
} from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ChartRenderer.vue', () => ({
  default: defineComponent({
    props: ['spec'],
    emits: ['rendering', 'error'],
    setup: (props, { emit }) => {
      const finish = () => {
        emit(
          'error',
          props.spec.optionOverrides?.series?.[0]?.type === 'invalid'
            ? 'invalid chart type'
            : '',
        );
        emit('rendering', false);
      };
      onMounted(finish);
      watch(
        () => props.spec,
        () => nextTick(finish),
        { deep: true },
      );
      return () =>
        h(
          'div',
          { class: 'option-chart-test' },
          JSON.stringify(props.spec.optionOverrides),
        );
    },
  }),
}));

import ChartAppearanceEditor from './ChartAppearanceEditor.vue';

let app: App | undefined;
let container: HTMLElement;
const spec = ref<ChartSpec>({
  chartType: 'bar',
  xField: 'category',
  yFields: ['amount'],
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  container?.remove();
});

/** 等待 ElDialog 的挂载、输入事件及预览草稿更新，不依赖真实数据库。 */
async function flush() {
  await nextTick();
  await nextTick();
  await nextTick();
}

function button(text: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((el) => el.textContent?.trim() === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

async function mountEditor(initial?: Partial<ChartSpec>) {
  spec.value = {
    chartType: 'bar',
    xField: 'category',
    yFields: ['amount'],
    ...initial,
  };
  container = document.createElement('div');
  document.body.append(container);
  app = createApp({
    setup: () => () =>
      h(
        ElForm,
        { labelPosition: 'top' },
        {
          default: () =>
            h(ChartAppearanceEditor, {
              spec: spec.value,
              'onUpdate:spec': (value: ChartSpec) => {
                spec.value = value;
              },
            }),
        },
      ),
  });
  app.use(ElementPlus);
  app.mount(container);
  await flush();
  button('编辑 ECharts option').click();
  await flush();
}

async function inputOption(text: string) {
  const input = document.querySelector<HTMLTextAreaElement>(
    '.option-source textarea',
  )!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
}

describe('option 编辑操作', () => {
  it('打开时自动载入已保存的 optionOverrides', async () => {
    await mountEditor({
      optionOverrides: { legend: { show: false }, series: [{ barWidth: 18 }] },
    });
    const text = document.querySelector<HTMLTextAreaElement>(
      '.option-source textarea',
    )?.value;
    expect(text).toContain('"show": false');
    expect(text).toContain('"barWidth": 18');
  });

  it('JSON 草稿实时预览但取消不会修改保存配置', async () => {
    await mountEditor();
    await inputOption('{"legend":{"show":false}}');
    expect(document.querySelector('.option-chart-test')?.textContent).toContain(
      '"show":false',
    );
    expect(spec.value.optionOverrides).toBeUndefined();
    button('取消').click();
    await flush();
    expect(spec.value.optionOverrides).toBeUndefined();
  });

  it('应用有效 option 时保持字段映射及外观配置', async () => {
    await mountEditor();
    await inputOption('{"series":[{"barWidth":12}]}');
    expect(button('应用到图表').disabled).toBe(false);
    button('应用到图表').click();
    await flush();
    expect(spec.value).toMatchObject({
      xField: 'category',
      yFields: ['amount'],
      optionOverrides: { series: [{ barWidth: 12 }] },
    });
  });

  it('无效 JSON 保留输入并禁止应用，修正后可继续操作', async () => {
    await mountEditor();
    await inputOption('{broken');
    expect(button('应用到图表').disabled).toBe(true);
    expect(
      document.querySelector<HTMLTextAreaElement>('.option-source textarea')
        ?.value,
    ).toBe('{broken');
    expect(document.querySelector('.option-error')).not.toBeNull();
    await inputOption('{"grid":{"top":4}}');
    expect(button('应用到图表').disabled).toBe(false);
  });

  it('JSON 合法但渲染语义错误时仍禁止应用', async () => {
    await mountEditor();
    await inputOption('{"series":[{"type":"invalid"}]}');
    expect(button('应用到图表').disabled).toBe(true);
    expect(document.querySelector('.option-error')?.textContent).toContain(
      'invalid chart type',
    );
  });
});
