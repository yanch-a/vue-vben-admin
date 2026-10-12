import { createApp, h, nextTick, reactive } from 'vue';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResultPanel from './ResultPanel.vue';

/** 实际结果编辑控件回归：完整主键、物理字段别名、切换结果保留草稿和事务保存。
 * @author yanch
 */
describe('结果编辑交互修复',()=>{
  let close:(()=>void)|undefined;
  afterEach(()=>{close?.();document.body.innerHTML='';localStorage.clear();vi.restoreAllMocks();});
  async function mount(overrides:Record<string,unknown>={}) {
    const batch=vi.fn().mockResolvedValue({affectedRows:1});
    const result={columns:['key_alias','title'],rows:[{key_alias:'9007199254740993',title:'old'}],rowCount:1,
      sourceSql:'SELECT id AS key_alias,v AS title FROM t'};
    const props=reactive<any>({visible:true,activeTab:'result',result,tableRef:{table:'t'},primaryKeys:['id'],primaryKeysReady:true,
      tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:['id']}],dbType:'MY_SQL',executeRowDml:batch,executeRowDmlBatch:batch,...overrides});
    const host=document.createElement('div');document.body.append(host);
    const app=createApp({render:()=>h(ResultPanel,{...props})});app.use(ElementPlus);app.config.globalProperties.$tr=(s:unknown)=>String(s);
    app.mount(host);close=()=>app.unmount();await nextTick();await nextTick();return{props,batch,result:props.result};
  }
  async function click(text:string) {
    const button=[...document.querySelectorAll('button')].find((button)=>button.textContent?.trim().startsWith(text));
    expect(button).toBeDefined();button!.click();await Promise.resolve();await nextTick();await nextTick();
  }
  async function editValue(value:string,original='old') {
    expect(document.body.textContent).toContain('退出编辑');
    const cell=[...document.querySelectorAll<HTMLElement>('.vrt-td')].find((element)=>element.title===original);expect(cell).toBeDefined();cell!.click();
    await Promise.resolve();await Promise.resolve();await nextTick();await nextTick();
    const input=document.querySelector<HTMLInputElement>('.vrt-editor');expect(input).not.toBeNull();input!.value=value;
    input!.dispatchEvent(new Event('input',{bubbles:true}));input!.dispatchEvent(new Event('blur',{bubbles:true}));await nextTick();await nextTick();
  }
  /** 从实际右键菜单打开行弹窗，覆盖弹窗输入和失败恢复而非模拟保存方法。 */
  async function openRowDialog() {
    document.querySelector<HTMLElement>('.vrt-td[title="old"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));
    await nextTick();
    const item=[...document.querySelectorAll<HTMLElement>('.item')].find((element)=>element.textContent?.trim()==='修改…');
    expect(item).toBeDefined();item!.click();for(let i=0;i<8;i++)await Promise.resolve();await nextTick();await nextTick();
    expect(document.querySelector('.result-edit-dialog')).not.toBeNull();
  }
  it('行弹窗写入失败后保持输入，保存过程中禁止继续修改',async()=>{
    const {batch}=await mount();let reject:(error:Error)=>void=()=>{};
    batch.mockImplementation(()=>new Promise((_resolve,rejectFn)=>{reject=rejectFn;}));await openRowDialog();
    const inputs=document.querySelectorAll<HTMLTextAreaElement>('.result-edit-dialog textarea');
    inputs[1]!.value='keep';inputs[1]!.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
    const save=[...document.querySelectorAll<HTMLButtonElement>('.result-edit-dialog button')].find((button)=>button.textContent?.trim()==='保存')!;
    save.click();for(let i=0;i<8;i++)await Promise.resolve();await nextTick();
    expect(batch).toHaveBeenCalledOnce();expect(inputs[1]!.disabled).toBe(true);
    reject(new Error('定位冲突'));for(let i=0;i<8;i++)await Promise.resolve();await nextTick();
    expect(document.querySelector<HTMLTextAreaElement>('.result-edit-dialog textarea:nth-child(1)')).not.toBeNull();
    expect(inputs[1]!.value).toBe('keep');expect(inputs[1]!.disabled).toBe(false);
  });
  it('复合主键缺少一列时拒绝进入编辑，表达式伪装主键也拒绝',async()=>{
    await mount({primaryKeys:['id','tenant_id']});await click('表格编辑');expect(document.body.textContent).not.toContain('退出编辑');
  });
  it('无主键结果不能通过旧值猜测行身份',async()=>{
    vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    localStorage.setItem('lemon-visual-client:skip-no-pk-warn-until',String(Date.now()+86400000));
    await mount({primaryKeys:[],tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:[]}]});
    await click('表格编辑');expect(document.body.textContent).not.toContain('退出编辑');
  });
  it('主键读取期间切换结果，取消发起结果的进入编辑操作',async()=>{
    let release:()=>void=()=>{};const read=new Promise<void>((resolve)=>{release=resolve;});
    const {props}=await mount({ensurePrimaryKeys:()=>read});await click('表格编辑');
    props.result={columns:['id','v'],rows:[{id:2,v:'B'}],rowCount:1,sourceSql:'SELECT id,v FROM other'};
    props.tableRef={table:'other'};release();for(let i=0;i<8;i++)await Promise.resolve();await nextTick();expect(document.body.textContent).not.toContain('退出编辑');
  });
  it('重复显示别名不会把后一项计算值当成物理主键',async()=>{
    const {batch}=await mount({primaryKeys:['id'],tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:['id']}],
      result:{columns:['id','t.id','v'],rows:[{id:1,'t.id':2,v:'old'}],rowCount:1,sourceSql:'SELECT id,id+1 AS id,v FROM t',
        columnMetadata:[{label:'id',name:'id',jdbcType:4,typeName:'INTEGER'},{label:'t.id',name:'id',jdbcType:4,typeName:'INTEGER'},{label:'v',name:'v',jdbcType:12,typeName:'VARCHAR'}]}});
    await click('表格编辑');await editValue('new');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();
    // 后一项 id+1 是只读表达式，不允许污染 WHERE 中真实主键 1。
    expect(batch).toHaveBeenCalledOnce();expect(batch.mock.calls[0]![1][0].map((p:any)=>p.value)).toEqual(['new',1,'old']);
  });
  it('大小写不同的普通字段不能冒充真实主键', async () => {
    await mount({ dbType: 'POSTGRE_SQL', primaryKeys: ['ID'],
      tableMetas: [{ ref: { table: 't' }, columns: ['ID', 'id', 'v'], primaryKeys: ['ID'] }],
      result: { columns: ['id', 'v'], rows: [{ id: 2, v: 'old' }], rowCount: 1, sourceSql: 'SELECT "id",v FROM t' } });
    await click('表格编辑'); expect(document.body.textContent).not.toContain('退出编辑');
  });
  it('切换标签后恢复草稿，保存使用物理字段和原值条件',async()=>{
    const {props,batch,result}=await mount();await click('表格编辑');await editValue('new');
    props.result={columns:['id'],rows:[{id:2}],rowCount:1,sourceSql:'SELECT id FROM other'};await nextTick();
    props.result=result;await nextTick();await nextTick();expect(document.querySelector('.vrt-td[title="new"]')).not.toBeNull();
    vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);await click('保存修改');
    for(let i=0;i<6;i++)await Promise.resolve();
    expect(batch).toHaveBeenCalledOnce();expect(batch.mock.calls[0]![0]).toEqual(["UPDATE `t` SET `v` = ? WHERE `id` = ? AND `v` = ?;"]);
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual(['new','9007199254740993','old']);
  });
  it('事务定位冲突时保留编辑内容，允许刷新后检查重试',async()=>{
    const {batch}=await mount();batch.mockRejectedValue(new Error('结果编辑定位冲突'));
    await click('表格编辑');await editValue('new');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);await click('保存修改');
    for(let i=0;i<6;i++)await Promise.resolve();
    expect(document.querySelector('.vrt-td[title="new"]')).not.toBeNull();expect(document.body.textContent).toContain('保存修改 (1)');
  });
  it('实际表格中只编辑普通列，json/数组继续参与原值校验且不会阻断保存', async () => {
    const {batch}=await mount({dbType:'POSTGRE_SQL',primaryKeys:['id'],tableRef:{table:'t'},tableMetas:[{ref:{table:'t'},columns:['id','v','payload','tags'],primaryKeys:['id']}],
      result:{columns:['id','v','payload','tags'],rows:[{id:'9007199254740993',v:'old',payload:'{"a":1}',tags:[1,2]}],rowCount:1,sourceSql:'SELECT id,v,payload,tags FROM t',
        columnMetadata:[{label:'id',name:'id',jdbcType:-5,typeName:'int8'},{label:'v',name:'v',jdbcType:12,typeName:'varchar'},{label:'payload',name:'payload',jdbcType:1111,typeName:'json'},{label:'tags',name:'tags',jdbcType:2003,typeName:'_int4'}]}});
    await click('表格编辑');await editValue('new');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);await click('保存修改');
    for(let i=0;i<8;i++)await Promise.resolve();expect(batch).toHaveBeenCalledOnce();
    const sql=batch.mock.calls[0]![0][0];expect(sql).toContain('CAST("payload" AS text) = CAST(? AS text)');expect(sql).toContain('CAST("tags" AS text) = CAST(? AS text)');
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual(['new','9007199254740993','old','{"a":1}',[1,2]]);
  });
  it('Mongo 单元格编辑保持 BSON 类型标签和原始文档身份',async()=>{
    const {batch}=await mount({dbType:'MONGODB',primaryKeys:['_id'],tableRef:{table:'t'},tableMetas:[{ref:{table:'t'},columns:['_id','v'],primaryKeys:['_id']}],
      result:{columns:['_id','v'],rows:[{_id:{$oid:'507f1f77bcf86cd799439011'},v:{$numberDecimal:'1.25'}}],rowCount:1,sourceSql:'db.t.find({})'}});
    await click('表格编辑');await editValue('{"$numberDecimal":"2.50"}','{"$numberDecimal":"1.25"}');
    vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();
    expect(batch).toHaveBeenCalledOnce();const sql=batch.mock.calls[0]![0];
    expect(sql).toContain('"_id":{"$eq":{"$oid":"507f1f77bcf86cd799439011"}}');
    expect(sql).toContain('"$set":{"v":{"$numberDecimal":"2.50"}}');
  });
  it('非法数组 JSON 保留单元格输入并阻止保存，不抛出未处理异步错误',async()=>{
    const {batch}=await mount({dbType:'POSTGRE_SQL',primaryKeys:['id'],tableRef:{table:'t'},tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:['id']}],
      result:{columns:['id','v'],rows:[{id:1,v:[1,2]}],rowCount:1,sourceSql:'SELECT id,v FROM t'}});
    await click('表格编辑');await editValue('[broken','[1,2]');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();expect(batch).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('.vrt-editor')?.value).toBe('[broken');
  });
});
