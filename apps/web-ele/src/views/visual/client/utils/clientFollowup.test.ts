import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildMongoUpdateCommand, isMongoEditableQuery } from './mongoCommand';
import { buildDeleteSql, buildUpdateSql } from './resultRowSql';
import { compileJoinUpdatePlan } from './resultJoinUpdate';
import type { ResultEditParameter } from './resultComparison';
import { allResultStates } from '../composables/resultDraftStore';

/** 按真实组件函数验证异步页签生命周期，SQL 生成器覆盖特殊类型原值条件。@author yanch */
function actual(file: string, names: string[], env: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile('regression.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  expect(functions).toHaveLength(names.length);
  const context = vm.createContext({ allResultStates, closingQueryTabs: new Set(), ...env });
  vm.runInContext(ts.transpileModule(functions.map((fn) => fn.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return (argumentsText: string) => vm.runInContext(`${names[0]}(${argumentsText})`, context);
}
/** 类型包装与实际 ResultPanel 映射相同，值不做 Number 转换。 */
const typed = (value: unknown, jdbcType: number, typeName: string) => ({ __lemonTypedValue: { value, jdbcType, typeName } });

describe('追加修复回归', () => {
  it('PG json、XML、数组使用类型策略，修改普通列不会丢掉特殊列的原值检查', () => {
    const parameters: ResultEditParameter[] = [];
    const original = { id: typed('9007199254740993', -5, 'int8'), v: typed('old',12,'varchar'), payload: typed('{"a":1}',1111,'json'), xml: typed('<a/>',2009,'xml'), tags: typed([1,2],2003,'_int4') };
    const sql = buildUpdateSql({table:'t'},original,{v:typed('new',12,'varchar')},['v'],['id'],'POSTGRE_SQL',parameters);
    expect(sql).toContain('CAST("payload" AS text) = CAST(? AS text)');
    expect(sql).toContain('CAST("xml" AS text) = CAST(? AS text)'); expect(sql).toContain('CAST("tags" AS text) = CAST(? AS text)');
    expect(parameters.map((p)=>p.value)).toEqual(['new','9007199254740993','old','{"a":1}','<a/>',[1,2]]);
  });
  it('Oracle LOB 与 XMLTYPE 采用专用比较，SQL Server 旧 text/XML 采用转换比较', () => {
    const oracle = buildDeleteSql({table:'t'},{id:1,c:typed("a'b",2005,'CLOB'),b:typed({__lemonBinary:'00ff'},2004,'BLOB'),x:typed('<a/>',2009,'XMLTYPE')},['id','c','b','x'],['id'],'ORACLE',[]);
    expect(oracle).toContain('DBMS_LOB.COMPARE("c", ?) = 0'); expect(oracle).toContain('DBMS_LOB.COMPARE("b", ?) = 0');
    expect(oracle).toContain('XMLSERIALIZE(CONTENT XMLTYPE(?) AS CLOB)');
    const sqlserver = buildDeleteSql({table:'t'},{id:1,c:typed('old',-1,'text'),x:typed('<a/>',2009,'xml')},['id','c','x'],['id'],'SQL_SERVER',[]);
    expect(sqlserver).toContain('CAST(CAST([c] AS nvarchar(max)) AS varbinary(max))');
    expect(sqlserver).toContain('CAST(CAST([x] AS nvarchar(max)) AS varbinary(max))');
  });
  it('字符串原值比较区分大小写/尾空格，未知对象明确拒绝而不是省略保护', () => {
    expect(buildUpdateSql({table:'t'},{id:1,v:typed('Old ',12,'varchar')},{v:typed('New',12,'varchar')},['v'],['id'],'MY_SQL',[])).toContain('CAST(`v` AS BINARY) = CAST(? AS BINARY)');
    expect(()=>buildUpdateSql({table:'t'},{id:1,g:typed('POINT(0 0)',1111,'geometry')},{g:typed('POINT(1 1)',1111,'geometry')},['g'],['id'],'POSTGRE_SQL',[])).toThrow('暂不支持安全回写');
  });
  it('联表计划跨行复用且绑定参数彼此隔离', () => {
    const plan=compileJoinUpdatePlan([{ref:{table:'t'},alias:'a',columns:['id','v'],primaryKeys:['id']}],['id','v'],'SELECT a.id,a.v FROM t a','MY_SQL',['t','t']);
    const first:ResultEditParameter[][]=[],second:ResultEditParameter[][]=[];
    expect(plan({original:{id:1,v:'old'},edited:{v:'new'},changedColumns:['v']},first)).toEqual(['UPDATE `t` SET `v` = ? WHERE `id` = ? AND `v` = ?;']);
    plan({original:{id:2,v:'other'},edited:{v:'next'},changedColumns:['v']},second);
    expect(first[0]!.map((p)=>p.value)).toEqual(['new',1,'old']);expect(second[0]!.map((p)=>p.value)).toEqual(['next',2,'other']);
  });
  it('关闭正在运行的查询先取消，再中止请求和移除页签', async () => {
    const order:string[]=[];const tab={id:'a',executing:true,result:null};const runs=new Map([['a',{requestId:'query-a',abort:{abort:()=>order.push('abort')}}]]);
    const close=actual('../index.vue',['closeTab','cancelClosingQueryTabs'],{tabs:{value:[tab]},sqlRuns:runs,isResultSaving:()=>false,
      confirmDiscardQueryTabs:async()=>true,cancelSql:async()=>order.push('cancel'),closeTabDirect:()=>order.push('close'),ElMessage:{warning:vi.fn(),error:vi.fn()}});
    await close("'a'");expect(order).toEqual(['cancel','abort','close']);expect(runs.size).toBe(0);
  });
  it('取消失败或结果保存中都保留页签及停止入口', async () => {
    for(const saving of [false,true]){
      const closed=vi.fn();const run={requestId:'a',abort:{abort:vi.fn()}};const runs=new Map([['a',run]]);
      const close=actual('../index.vue',['closeTab','cancelClosingQueryTabs'],{tabs:{value:[{id:'a',executing:true,result:{}}]},sqlRuns:runs,isResultSaving:()=>saving,
        confirmDiscardQueryTabs:async()=>true,cancelSql:async()=>{throw new Error('network fixture');},closeTabDirect:closed,ElMessage:{warning:vi.fn(),error:vi.fn()}});
      await close("'a'");expect(closed).not.toHaveBeenCalled();expect(run.abort.abort).not.toHaveBeenCalled();expect(runs.size).toBe(1);
    }
  });
  it('取消期间产生的新请求不能被一并关闭或丢掉停止入口', async () => {
    const closed=vi.fn();const old={requestId:'old',abort:{abort:vi.fn()}};const next={requestId:'new',abort:{abort:vi.fn()}};const runs=new Map([['a',old]]);
    const close=actual('../index.vue',['closeTab','cancelClosingQueryTabs'],{tabs:{value:[{id:'a',executing:true,result:null}]},sqlRuns:runs,isResultSaving:()=>false,
      confirmDiscardQueryTabs:async()=>true,cancelSql:async()=>{runs.set('a',next);},closeTabDirect:closed,ElMessage:{warning:vi.fn(),error:vi.fn()}});
    await close("'a'");expect(closed).not.toHaveBeenCalled();expect(runs.get('a')).toBe(next);expect(next.abort.abort).not.toHaveBeenCalled();
  });
  it('离开浏览器会检查其它连接的草稿和执行状态', () => {
    const prevent=vi.fn();const event={preventDefault:prevent,returnValue:undefined};
    const protect=actual('../index.vue',['protectWorkspaceUnload'],{allWorkspaceQueryTabs:()=>[{result:{},executing:false}],isResultSaving:()=>false,isQueryTabDirty:()=>false,hasResultDraft:()=>true,resultPanelRef:{value:null},event});
    protect('event');expect(prevent).toHaveBeenCalledOnce();expect(event.returnValue).toBe('');
  });
  it('确认准确区分关系型整批提交和 Mongo 分行成功', () => {
    const mongo={value:false};const call=actual('../components/query/ResultPanel.vue',['describeSave'],{isJoinQuery:{value:false},tableHasPk:{value:true},isMongo:mongo});
    expect(call('[{inserted:false}]').message).toContain('一个事务');expect(call('[{inserted:false}]').message).not.toContain('已成功行保留');
    mongo.value=true;expect(call('[{inserted:false}]').message).toContain('已成功行保留');
  });
  it.each([false, true])('Mongo切换集合后仍写原集合，第二条失败=%s 时保留未提交草稿', async (secondFails) => {
    const a={rows:[{_id:1,v:'old'},{_id:2,v:'old'}],sourceSql:'db.alpha.find({})'};const b={rows:[],sourceSql:'db.beta.find({})'};
    const sent:string[]=[];let release=()=>{};const edits=a.rows.map((row,rowIndex)=>({original:row,edited:{...row,v:'new'},rowIndex,inserted:false,changedColumns:['v']}));
    const draft={original:a.rows.map((row)=>({...row})),dirty:new Set([0,1]),added:new Set<number>()};
    const props:any={result:a,tableRef:{table:'alpha'},executeRowDml:async(sql:string)=>{sent.push(sql);if(sent.length===1)await new Promise<void>((resolve)=>{release=resolve;});else if(secondFails)throw new Error('second row fixture');}};
    const save=actual('../components/query/ResultPanel.vue',['onSaveSheet','buildEditsSqls','pickErrorText'],{props,sheetSaving:{value:false},isMongo:{value:true},isJoinQuery:{value:false},whereCols:{value:['_id']},
      commitEditingCell:async()=>true,collectEdits:()=>edits,confirmRowMutation:async()=>true,describeSave:()=>({message:'fixture',title:'fixture'}),ElMessageBox:{confirm:async()=>{}},
      ElMessage:{error:vi.fn(),warning:vi.fn(),success:vi.fn()},requireTable:()=>props.tableRef,isMongoEditableQuery,buildMongoUpdateCommand,putResultDraft:vi.fn(),getResultDraft:()=>draft,setResultSaving:vi.fn(),syncBatchResult:vi.fn(),markRowsSaved:vi.fn(),emit:vi.fn(),expectResultRefresh:{value:false}});
    const pending=save('');for(let i=0;i<20&&sent.length===0;i++)await Promise.resolve();expect(sent).toHaveLength(1);
    props.result=b;props.tableRef={table:'beta'};release();await pending;
    expect(sent).toHaveLength(2);expect(sent.every((sql)=>sql.includes('alpha'))).toBe(true);
    expect(draft.dirty.size).toBe(secondFails ? 1 : 0);expect(draft.dirty.has(0)).toBe(false);
    expect(a.rows[0]!.v).toBe('new');expect(a.rows[1]!.v).toBe(secondFails ? 'old' : 'new');
  });
});
