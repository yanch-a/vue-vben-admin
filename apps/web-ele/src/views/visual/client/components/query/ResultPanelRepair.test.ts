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
  it('结果未带齐主键时按查询字段进入编辑并保存',async()=>{
    const {batch}=await mount({primaryKeys:['id','tenant_id']});
    await click('表格编辑');expect(document.body.textContent).toContain('退出编辑');
    await editValue('new');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0]).toEqual(['UPDATE `t` SET `v` = ? WHERE `id` = ? AND `v` = ?;']);
    expect(String(batch.mock.calls[0]![0])).not.toContain('tenant_id');
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual(['new','9007199254740993','old']);
  });
  it('无主键结果按本次查询的全部字段旧值修改和删除',async()=>{
    const {batch}=await mount({primaryKeys:[],tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:[]}],
      result:{columns:['id','v'],rows:[{id:1,v:'old'}],rowCount:1,sourceSql:'SELECT id,v FROM t'}});
    await click('表格编辑');expect(document.body.textContent).toContain('退出编辑');
    await editValue('new');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0]).toEqual(['UPDATE `t` SET `v` = ? WHERE `id` = ? AND `v` = ?;']);
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual(['new',1,'old']);
    batch.mockClear();
    await deleteFromMenu('删除');
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0]).toEqual(['DELETE FROM `t` WHERE `id` = ? AND `v` = ?;']);
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual([1,'new']);
  });
  it('无主键右键修改按全部查询字段定位，表达式列不参与回写',async()=>{
    const {batch}=await mount({primaryKeys:[],tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:[]}],
      result:{columns:['id','name'],rows:[{id:1,name:'OLD'}],rowCount:1,sourceSql:'SELECT id, UPPER(v) AS name FROM t'}});
    document.querySelector<HTMLElement>('.vrt-td[title="OLD"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));
    await nextTick();
    const item=[...document.querySelectorAll<HTMLElement>('.item')].find((element)=>element.textContent?.trim()==='修改…');
    expect(item).toBeDefined();item!.click();for(let i=0;i<8;i++)await Promise.resolve();await nextTick();
    expect(document.body.textContent).toContain('按本次查询的全部字段旧值定位原行');
    const inputs=document.querySelectorAll<HTMLTextAreaElement>('.result-edit-dialog textarea');
    inputs[0]!.value='2';inputs[0]!.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
    vi.spyOn(ElMessageBox,'confirm').mockImplementation(async()=>'confirm' as never);
    const save=[...document.querySelectorAll<HTMLButtonElement>('.result-edit-dialog button')].find((button)=>button.textContent?.trim()==='保存')!;
    save.click();for(let i=0;i<8;i++)await Promise.resolve();await nextTick();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0]).toEqual(['UPDATE `t` SET `id` = ? WHERE `id` = ?;']);
    expect(batch.mock.calls[0]![1][0].map((parameter:any)=>parameter.value)).toEqual(['2',1]);
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
  it('结果里没有真实主键列时按查出来的字段定位', async () => {
    const { batch } = await mount({ dbType: 'POSTGRE_SQL', primaryKeys: ['ID'],
      tableMetas: [{ ref: { table: 't' }, columns: ['ID', 'id', 'v'], primaryKeys: ['ID'] }],
      result: { columns: ['id', 'v'], rows: [{ id: 2, v: 'old' }], rowCount: 1, sourceSql: 'SELECT "id",v FROM t' } });
    await click('表格编辑'); expect(document.body.textContent).toContain('退出编辑');
    await editValue('new'); vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改'); for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![0][0]).toContain('WHERE "id" = ? AND "v" = ?');
    expect(batch.mock.calls[0]![0][0]).not.toContain('"ID"');
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
  async function deleteFromMenu(label: string) {
    document.querySelector<HTMLElement>('.vrt-td[title]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await nextTick();
    const item = [...document.querySelectorAll<HTMLElement>('.result-ctx-menu .item')].find((element) => element.textContent?.trim() === label);
    expect(item).toBeDefined();
    expect(item!.classList.contains('disabled')).toBe(false);
    item!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await nextTick();
  }
  it('退出编辑后勾选仍指向当前结果，可以右键删除', async () => {
    const { batch } = await mount({
      primaryKeys: ['id'],
      tableMetas: [{ ref: { table: 't' }, columns: ['id', 'v'], primaryKeys: ['id'] }],
      result: { columns: ['id', 'v'], rows: [{ id: 1, v: 'old' }], rowCount: 1, sourceSql: 'SELECT id,v FROM t' },
    });
    await click('表格编辑');
    const box = document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1];
    expect(box).toBeDefined();
    box!.checked = true;
    box!.dispatchEvent(new Event('change', { bubbles: true }));
    await click('退出编辑');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    await deleteFromMenu('删除已勾选的 1 行');
    expect(document.body.textContent).not.toContain('勾选行已不在当前结果中');
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![1][0].map((parameter: { value: unknown }) => parameter.value)).toEqual([1, 'old']);
  });
  it('编辑模式可以删除已有行，并保留其它行未保存的修改', async () => {
    const { batch } = await mount({
      primaryKeys: ['id'],
      tableMetas: [{ ref: { table: 't' }, columns: ['id', 'v'], primaryKeys: ['id'] }],
      result: { columns: ['id', 'v'], rows: [{ id: 1, v: 'old' }, { id: 2, v: 'keep' }], rowCount: 2, sourceSql: 'SELECT id,v FROM t' },
    });
    await click('表格编辑');
    await editValue('next', 'keep');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    await deleteFromMenu('删除');
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]![1][0].map((parameter: { value: unknown }) => parameter.value)).toEqual([1, 'old']);
    expect(document.body.textContent).toContain('退出编辑');
    expect(document.querySelector('.vrt-td[title="old"]')).toBeNull();
    expect(document.querySelector('.vrt-td[title="next"]')).not.toBeNull();
    expect(document.body.textContent).toContain('保存修改 (1)');
  });
  it('编辑模式删除未保存的新行不访问数据库', async () => {
    const { batch } = await mount({
      primaryKeys: ['id'],
      tableMetas: [{ ref: { table: 't' }, columns: ['id', 'v'], primaryKeys: ['id'] }],
      result: { columns: ['id', 'v'], rows: [{ id: 1, v: 'old' }], rowCount: 1, sourceSql: 'SELECT id,v FROM t' },
    });
    await click('表格编辑');
    await click('添加行');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    document.querySelector<HTMLElement>('.vrt-td[title="NULL"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await nextTick();
    const item = [...document.querySelectorAll<HTMLElement>('.result-ctx-menu .item')].find((element) => element.textContent?.trim() === '删除');
    expect(item!.classList.contains('disabled')).toBe(false);
    item!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await nextTick();
    expect(batch).not.toHaveBeenCalled();
    expect(document.querySelector('.vrt-td[title="NULL"]')).toBeNull();
    expect(document.querySelector('.vrt-td[title="old"]')).not.toBeNull();
    expect(document.body.textContent).toContain('退出编辑');
  });
  async function saveFormattedCell(titlePart: string) {
    const cell = [...document.querySelectorAll<HTMLElement>('.vrt-td')].find((element) => element.title.includes(titlePart));
    expect(cell).toBeDefined();
    cell!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await nextTick();
    const item = [...document.querySelectorAll<HTMLElement>('.result-ctx-menu .item')].find((element) => element.textContent?.trim() === '格式化显示');
    expect(item).toBeDefined();
    expect(item!.classList.contains('disabled')).toBe(false);
    item!.click();
    let save: HTMLButtonElement | undefined;
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      await nextTick();
      save = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('保存/更新到数据库'));
      if (save) break;
    }
    expect(save).toBeDefined();
    const drawer = document.querySelector<HTMLElement>('.cell-content-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.style.width).toBe('40%');
    save!.click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await nextTick();
  }
  it('格式化抽屉按主键把 JSON 压成一行后作为参数更新', async () => {
    const pretty = '{\n  "a": 1\n}';
    const { batch } = await mount({
      primaryKeys: ['id'],
      tableMetas: [{ ref: { table: 't' }, columns: ['id', 'payload'], primaryKeys: ['id'] }],
      result: {
        columns: ['id', 'payload'],
        rows: [{ id: 7, payload: pretty }],
        rowCount: 1,
        sourceSql: 'SELECT id, payload FROM t',
        columnMetadata: [
          { label: 'id', name: 'id', jdbcType: 4, typeName: 'INT' },
          { label: 'payload', name: 'payload', jdbcType: 12, typeName: 'VARCHAR' },
        ],
      },
    });
    await saveFormattedCell('"a"');
    expect(batch).toHaveBeenCalledOnce();
    const sql = String(batch.mock.calls[0]![0][0]);
    expect(sql).toContain('SET `payload` = ?');
    expect(sql).toContain('WHERE `id` = ?');
    expect(sql).not.toContain('{');
    const values = batch.mock.calls[0]![1][0];
    expect(values[0]).toMatchObject({ value: '{"a":1}', jdbcType: 12, typeName: 'VARCHAR' });
    expect(values.map((parameter: { value: unknown }) => parameter.value)).toContain(7);
    expect(values.map((parameter: { value: unknown }) => parameter.value)).toContain(pretty);
  });
  it('结果没有主键列时按查出的字段更新，XML 压缩后仍是绑定参数', async () => {
    const xml = '<root>\n  <a>1</a>\n</root>';
    const { batch } = await mount({
      dbType: 'POSTGRE_SQL',
      primaryKeys: ['id'],
      tableMetas: [{ ref: { table: 't' }, columns: ['id', 'payload'], primaryKeys: ['id'] }],
      result: {
        columns: ['payload'],
        rows: [{ payload: xml }],
        rowCount: 1,
        sourceSql: 'SELECT payload FROM t',
        columnMetadata: [{ label: 'payload', name: 'payload', jdbcType: 2009, typeName: 'xml' }],
      },
    });
    await saveFormattedCell('<a>1</a>');
    expect(batch).toHaveBeenCalledOnce();
    const sql = String(batch.mock.calls[0]![0][0]);
    expect(sql).toContain('SET "payload" = ?');
    expect(sql).not.toContain('"id"');
    expect(sql).not.toContain('<root>');
    const values = batch.mock.calls[0]![1][0];
    expect(values[0]).toMatchObject({ value: '<root><a>1</a></root>', jdbcType: 2009, typeName: 'xml' });
    expect(values.map((parameter: { value: unknown }) => parameter.value)).toContain(xml);
  });
  it('非法数组 JSON 保留单元格输入并阻止保存，不抛出未处理异步错误',async()=>{
    const {batch}=await mount({dbType:'POSTGRE_SQL',primaryKeys:['id'],tableRef:{table:'t'},tableMetas:[{ref:{table:'t'},columns:['id','v'],primaryKeys:['id']}],
      result:{columns:['id','v'],rows:[{id:1,v:[1,2]}],rowCount:1,sourceSql:'SELECT id,v FROM t'}});
    await click('表格编辑');await editValue('[broken','[1,2]');vi.spyOn(ElMessageBox,'confirm').mockResolvedValue('confirm' as never);
    await click('保存修改');for(let i=0;i<8;i++)await Promise.resolve();expect(batch).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('.vrt-editor')?.value).toBe('[broken');
  });
});
