import { createApp, h, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EtlFieldRules from './EtlFieldRules.vue';

vi.mock('#/locales/ui-text', () => ({ translateUiText: (text: string) => text }));

/** 挂载实际 Element Plus 字段规则表单，确认关闭默认值会删除配置而非保留空串。@author yanch */
describe('ETL field rule editor', () => {
  let close: (() => void) | undefined;
  afterEach(() => { close?.(); document.body.innerHTML = ''; });
  it('renders an imported boolean default without coercing it or passing an invalid input prop', async () => {
    const field = reactive<Record<string, any>>({ source: 'flag', target: 'flag', type: 'boolean', defaultValue: false });
    const host = document.createElement('div'); document.body.append(host);
    const warnings: string[] = [];
    const app = createApp({ render: () => h(EtlFieldRules, { field }) }); app.use(ElementPlus); app.config.warnHandler = (message) => warnings.push(message);
    app.mount(host); close = () => app.unmount(); await nextTick();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="NULL默认值"]')?.value).toBe('false');
    expect(field.defaultValue).toBe(false); expect(warnings.filter((message) => message.includes('modelValue'))).toEqual([]);
  });
  it('edits cleanup flags and explicitly enables and removes a NULL default', async () => {
    const field = reactive<Record<string, any>>({ source: 'v', target: 'v', type: 'keep' });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ render: () => h(EtlFieldRules, { field }) }); app.use(ElementPlus); app.mount(host); close = () => app.unmount(); await nextTick();
    const checks = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    checks[0]!.click(); await nextTick(); expect(field.trim).toBe(true);
    checks[1]!.click(); await nextTick(); expect(field.emptyToNull).toBe(true);
    checks[2]!.click(); await nextTick(); expect(Object.hasOwn(field, 'defaultValue')).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="NULL默认值"]'); expect(input).not.toBeNull();
    input!.value = '9007199254740993'; input!.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
    expect(field.defaultValue).toBe('9007199254740993');
    checks[2]!.click(); await nextTick(); expect(Object.hasOwn(field, 'defaultValue')).toBe(false);
    expect(host.querySelector('input[aria-label="NULL默认值"]')).toBeNull();
  });
});
