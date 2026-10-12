import { createApp, h, nextTick, reactive } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtlNode } from '#/api/visual/etl';
import EtlOperatorEditor from './EtlOperatorEditor.vue';
import { createOperatorConfig } from './etlOperators';
vi.mock('#/locales/ui-text', () => ({ translateUiText: (text: string) => text }));

/** 挂载真实算子编辑器，覆盖配置草稿、异步 CSV 和默认限额可用性。@author yanch */
describe('ETL operator editor', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => { unmount?.(); document.body.innerHTML = ''; });
  function mount(type: string) {
    const node = reactive<EtlNode>({ id:'step', type, typeVersion:1, config:createOperatorConfig(type,'source') });
    const host=document.createElement('div'); document.body.append(host);
    const warnings: string[]=[];
    const app=createApp({render:()=>h(EtlOperatorEditor,{node,upstream:[],columns:{}})});app.use(ElementPlus);app.config.warnHandler=(value)=>warnings.push(value);app.mount(host);unmount=()=>app.unmount();
    return {node,host,warnings};
  }
  function button(label: string) { const value=[...document.querySelectorAll<HTMLButtonElement>('button')].find((item)=>item.textContent?.trim()===label);expect(value).toBeDefined();return value!; }
  it('keeps the existing condition when JSON is invalid and applies a parsed condition once', async () => {
    const {node}=mount('transform.filter'); await nextTick();const original=JSON.stringify(node.config.condition);
    button('编辑条件').click();await nextTick();
    const input=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="条件表达式"]')!;
    input.value='{ broken';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();button('应用').click();await nextTick();
    expect(JSON.stringify(node.config.condition)).toBe(original);
    input.value='{"value":true}';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();button('应用').click();await nextTick();
    expect(node.config.condition).toEqual({value:true});
  });
  it('preserves an imported condition when editing is cancelled', async () => {
    const {node}=mount('transform.assert');await nextTick();const original=JSON.stringify(node.config.condition);
    button('编辑条件').click();await nextTick();button('条件组合').click();await nextTick();button('取消').click();await nextTick();
    expect(JSON.stringify(node.config.condition)).toBe(original);
  });
  it('does not overwrite changes made while a CSV file is being read', async () => {
    const {node,host}=mount('source.inline');await nextTick();
    let finish!: (value:ArrayBuffer)=>void;
    const file=new File(['id,name\n1,one'],'input.csv',{type:'text/csv'});
    Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise<ArrayBuffer>((resolve)=>finish=resolve)});
    const input=host.querySelector<HTMLInputElement>('input[type=file]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});
    input.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();node.config.rows=[{id:'manual',name:'keep'}];
    finish(new TextEncoder().encode('id,name\n1,one').buffer);await vi.waitFor(()=>expect(host.textContent).toContain('数据配置已修改'));
    expect(node.config.rows[0].id).toBe('manual');
  });
  it('imports exact CSV text and does not pass invalid limit props to controls', async () => {
    const mounted=mount('transform.join');await nextTick();expect(mounted.warnings.filter((warning)=>warning.includes('modelValue'))).toEqual([]);unmount?.();
    const {node,host}=mount('source.inline');await nextTick();const file=new File(['id,name\n9007199254740993,Alice'],'data.csv');
    Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode('id,name\n9007199254740993,Alice').buffer});
    const input=host.querySelector<HTMLInputElement>('input[type=file]')!;Object.defineProperty(input,'files',{value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));
    await vi.waitFor(()=>expect(node.config.rows).toEqual([{id:'9007199254740993',name:'Alice'}]));
  });
});
