import { readFileSync } from 'node:fs';

import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { i18n } from '@vben/locales';

import type { EtlNode } from '#/api/visual/etl';
import { translateUiText as tr } from '#/locales/ui-text';
import enUiText from '../../../locales/langs/en-US/ui-text.json';
import EtlOperatorEditor from './EtlOperatorEditor.vue';
import { createFlexibleExamplePipeline, createOperatorConfig, ETL_OPERATORS, parseEtlCsv } from './etlOperators';
import { parseEtlJson } from './etlSafeJson';

// 仅替换语言状态和消息加载，保留真实翻译函数、正式词典及真实 Element Plus 编辑器。
vi.mock('@vben/locales', async () => {
  const { ref } = await import('vue');
  const catalog = (await import('../../../locales/langs/en-US/ui-text.json')).default;
  return { i18n: { global: { locale: ref('zh-CN'), getLocaleMessage: () => ({ 'ui-text': catalog }) } } };
});

/** ETL 国际化回归：界面、校验错误及语言切换不得修改业务配置。@author yanch */
describe('ETL internationalization', () => {
  const han = /[\u3400-\u9fff]/;
  let unmount: (() => void) | undefined;
  beforeEach(() => { i18n.global.locale.value = 'en-US'; });
  afterEach(() => { unmount?.(); unmount = undefined; document.body.innerHTML = ''; i18n.global.locale.value = 'zh-CN'; });

  /** 挂载生产算子表单，保留源数据/字段名原值。 */
  function mount(type: string) {
    const node = reactive<EtlNode>({ id: 'step', type, typeVersion: 1, config: createOperatorConfig(type, 'source') });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ render: () => h(EtlOperatorEditor, { node, upstream: [], columns: {} }) });
    app.use(ElementPlus); app.mount(host); unmount = () => app.unmount();
    return { node, host };
  }

  /** 模态框通过 Teleport 挂到 body，操作真实按钮而非直接调用组件方法。 */
  function button(label: string) {
    const value = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label);
    expect(value).toBeDefined(); return value!;
  }

  it('covers new static UI text while excluding sample business values', () => {
    // 这些是 JSON 数据/表达式常量，不是界面文案，翻译会改变任务执行结果。
    const businessValues = new Set(['张三', '李四', '未知', '高', '普通']);
    const missing = new Set<string>();
    for (const file of ['etlOperators.ts', 'etlSafeJson.ts', 'EtlOperatorEditor.vue', 'EtlConditionEditor.vue', 'EtlFieldRules.vue', 'TaskTabs.vue', 'index.vue']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const match of source.matchAll(/'([^'\r\n]*)'/g)) {
        const text = match[1]!;
        if (han.test(text) && !businessValues.has(text) && !(enUiText as Record<string, string>)[text]) missing.add(`${file}: ${text}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('translates all operator labels, help and generated example names', () => {
    for (const operator of ETL_OPERATORS) {
      expect(tr(operator.label)).not.toMatch(han); expect(tr(operator.help)).not.toMatch(han);
    }
    const example = createFlexibleExamplePipeline('example');
    expect(tr(example.name)).toBe('Cross-source transformation example');
    for (const node of example.nodes) expect(tr(node.name)).not.toMatch(han);
    expect(example.nodes[1]?.config.rows[0].name).toBe('张三');
  });

  it('switches rendered controls and accessibility labels without changing configuration', async () => {
    const { node, host } = mount('transform.join'); await nextTick();
    const original = JSON.stringify(node.config);
    expect(host.textContent).toContain('Require unique right keys'); expect(host.textContent).not.toMatch(han);
    for (const control of host.querySelectorAll('[aria-label], [placeholder]')) {
      expect(control.getAttribute('aria-label') || '').not.toMatch(han); expect(control.getAttribute('placeholder') || '').not.toMatch(han);
    }
    i18n.global.locale.value = 'zh-CN'; await nextTick(); expect(host.textContent).toContain('要求右侧键唯一');
    i18n.global.locale.value = 'en-US'; await nextTick(); expect(host.textContent).toContain('Require unique right keys');
    expect(JSON.stringify(node.config)).toBe(original);
  });

  it('translates JSON validation errors on language change and preserves user data', async () => {
    const { node, host } = mount('source.inline'); node.config.rows = [{ 姓名: '张三', id: '9007199254740993' }]; await nextTick();
    const original = JSON.stringify(node.config);
    expect(host.textContent).toContain('Configured rows: 1'); button('Edit JSON data').click(); await nextTick();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit data rows"]')!;
    input.value = '{}'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); button('Apply').click(); await nextTick();
    expect(document.body.textContent).toContain('Data must be an array of objects');
    i18n.global.locale.value = 'zh-CN'; await nextTick(); expect(document.body.textContent).toContain('数据必须为对象数组');
    expect(JSON.stringify(node.config)).toBe(original);
  });

  it('renders CSV errors in English with the correct row number and preserves configuration', async () => {
    const { node, host } = mount('source.inline'); await nextTick(); const original = JSON.stringify(node.config);
    const file = new File(['id,name\n1'], 'broken.csv');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('id,name\n1').buffer });
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('CSV column count differs from the header at row: 2'));
    expect(host.textContent).not.toMatch(han); expect(JSON.stringify(node.config)).toBe(original);
  });

  it('translates numeric precision and size guards without altering CSV values', () => {
    for (const action of [() => parseEtlJson('{"id":9007199254740993}'), () => parseEtlJson('"too large"', 2)]) {
      let message = '';
      try { action(); } catch (error) { message = (error as Error).message; }
      expect(message).not.toBe(''); expect(tr(message)).not.toMatch(han);
    }
    expect(parseEtlCsv('姓名,id\n张三,9007199254740993')).toEqual({ columns: ['姓名', 'id'], rows: [{ 姓名: '张三', id: '9007199254740993' }] });
  });
});
