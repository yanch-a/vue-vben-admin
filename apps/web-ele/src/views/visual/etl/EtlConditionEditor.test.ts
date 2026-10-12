import { createApp, h, nextTick, ref } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EtlConditionEditor from './EtlConditionEditor.vue';
vi.mock('#/locales/ui-text', () => ({ translateUiText: (text: string) => text }));

/** 条件编辑器只在用户编辑时发出变更，保持数字精度和复杂表达式。@author yanch */
describe('ETL visual conditions',()=>{
  let unmount:(()=>void)|undefined;
  afterEach(()=>{unmount?.();document.body.innerHTML='';});
  function mount(initial:any){const value=ref(initial),changes:any[]=[];const host=document.createElement('div');document.body.append(host);const app=createApp({render:()=>h(EtlConditionEditor,{modelValue:value.value,columns:['amount','status'],'onUpdate:modelValue':(next:any)=>{changes.push(next);value.value=next;}})});app.use(ElementPlus);app.mount(host);unmount=()=>app.unmount();return {host,value,changes};}
  it('does not rewrite an imported numeric condition on mount and retains numeric text on edit',async()=>{
    const {host,value,changes}=mount({op:'ge',args:[{field:'amount'},{value:100}]});await nextTick();expect(changes).toEqual([]);
    const input=host.querySelector<HTMLInputElement>('input[aria-label="比较值"]')!;input.value='9007199254740993.123456789';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
    expect(value.value.args[1]).toEqual({op:'cast',type:'decimal',args:[{value:'9007199254740993.123456789'}]});
  });
  it('keeps unsupported nested expressions intact and offers advanced editing',async()=>{
    const initial={op:'not',args:[{op:'isNull',args:[{field:'amount'}]}]};const {host,value,changes}=mount(initial);await nextTick();
    expect(host.textContent).toContain('高级条件编辑器');expect(changes).toEqual([]);expect(value.value).toEqual(initial);
  });
  it('adds a second rule by explicitly creating an AND group',async()=>{
    const {host,value}=mount({op:'eq',args:[{field:'status'},{value:'active'}]});await nextTick();const add=[...host.querySelectorAll<HTMLButtonElement>('button')].find((button)=>button.textContent?.trim()==='添加条件')!;add.click();await nextTick();
    expect(value.value.op).toBe('and');expect(value.value.args).toHaveLength(2);expect(value.value.args[0].args[1].value).toBe('active');
  });
  it('keeps date casts when a visible condition is edited',async()=>{
    const {host,value,changes}=mount({op:'ge',args:[{field:'created_at'},{op:'cast',type:'date',args:[{value:'2026-10-01'}]}]});await nextTick();expect(changes).toEqual([]);
    const input=host.querySelector<HTMLInputElement>('input[aria-label="比较值"]')!;input.value='2026-10-12';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
    expect(value.value.args[1]).toEqual({op:'cast',type:'date',args:[{value:'2026-10-12'}]});
  });
});
