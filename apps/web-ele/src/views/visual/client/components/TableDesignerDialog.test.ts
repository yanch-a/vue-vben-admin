import { createApp, h, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import TableDesignerDialog from './TableDesignerDialog.vue';
import type { TableDesignSqlResult } from '../dialect/tableDesignerDialect';

/** 使用真实 Element Plus 控件验证建表弹窗的初始化、输入、错误和保存状态。 @author yanch */
describe('建表弹窗交互', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => { unmount?.(); document.body.innerHTML = ''; });

  /** 创建可更新父组件 props 的挂载环境，保存结果通过真实事件收集。 @author yanch */
  async function mount(overrides: Record<string, unknown> = {}) {
    const props = reactive<Record<string, unknown>>({ modelValue: true, instanceName: 'fixture', dbType: 'MY_SQL', mode: 'create', ...overrides });
    const saved: TableDesignSqlResult[] = [];
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ render: () => h(TableDesignerDialog, { ...props, onSave: (result: TableDesignSqlResult) => saved.push(result) } as any) });
    app.use(ElementPlus); app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host); unmount = () => app.unmount();
    await nextTick(); await nextTick(); return { props, saved };
  }

  /** 通过 DOM 输入触发 v-model 及改名联动。 @author yanch */
  async function input(label: string, value: string) {
    const element = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(element).not.toBeNull(); element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  }

  /** 点击用户可见的按钮，避免通过组件内部方法绕过控件。 @author yanch */
  async function click(text: string) {
    const button = [...document.body.querySelectorAll('button')].find(element => element.textContent?.trim() === text)!;
    expect(button).toBeDefined(); button.click(); await nextTick(); await nextTick();
  }

  it('首次以打开状态挂载就生成默认主键，保存事件包含可执行 SQL', async () => {
    const { saved } = await mount();
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="字段名 id"]')?.value).toBe('id');
    await click('保存'); expect(saved).toHaveLength(1); expect(saved[0]!.sql).toContain('AUTO_INCREMENT');
  });

  it('字段改名同步普通唯一索引，不误隐藏名称以 primary 开头的索引', async () => {
    const { saved } = await mount({ mode: 'alter', info: { tableName: 'orders', columns: [{ fieldName: 'id', dataType: 'BIGINT', isNullable: false, isPrimary: true }], indexes: [{ indexName: 'primary_business', columns: 'id', indexType: 'BTREE', unique: true }] } });
    expect(document.body.textContent).toContain('索引 (1)');
    await input('字段名 id', 'order_id'); await click('保存');
    expect(saved).toHaveLength(1); expect(saved[0]!.sql).toContain('(`order_id`)');
    expect(saved[0]!.errors).toEqual([]);
  });

  it('无效字段名显示持久错误，阻止保存，并将键盘焦点移到错误摘要', async () => {
    const { saved } = await mount(); await input('字段名 id', ''); await click('保存');
    expect(saved).toHaveLength(0); expect(document.body.querySelector('.validation-summary')?.textContent).toContain('字段名和类型');
    expect(document.activeElement).toBe(document.body.querySelector('.validation-summary'));
  });

  it('保存中禁用取消、预览及编辑，不发出重复保存事件', async () => {
    const { props, saved } = await mount(); props.saving = true; await nextTick();
    const buttons = [...document.body.querySelectorAll('button')];
    for (const text of ['取消', '预览 SQL', '保存']) expect(buttons.find(button => button.textContent?.trim() === text)?.disabled).toBe(true);
    expect(document.body.querySelector('.designer-body')?.hasAttribute('inert')).toBe(true);
    await click('保存'); expect(saved).toHaveLength(0);
  });

  it('部分 DDL 已执行后失败时显示原因并阻止从头重复保存', async () => {
    const { saved } = await mount({ executionError: '已执行 1/2 条语句，请查看当前表结构后重新修改' });
    expect(document.body.textContent).toContain('已执行 1/2'); await click('保存'); expect(saved).toHaveLength(0);
  });
});
