import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

/** 从实际页面提取执行函数，注入延迟 API，验证切标签和并行取消的真实行为。
 * @author yanch
 */
function harness() {
  const text = readFileSync('apps/web-ele/src/views/visual/client/index.vue', 'utf8');
  const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
  const ast = ts.createSourceFile('client.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['runSql', 'stopSql', 'runControlledDdl', 'runFreeDml', 'persistActiveQuery'];
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
  const code = ts.transpileModule('const sqlRuns = new Map();\n' + functions.map((fn) => fn.getText(ast)).join('\n'),
    { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText;
  const a:any = { id:'a',sql:'SELECT 1',instanceName:'a_db',executing:false };
  const b:any = { id:'b',sql:'SELECT 2',instanceName:'b_db',executing:false };
  const pending:{ args:any; resolve:(data:any)=>void }[]=[];
  const writes:any[]=[]; const cancels:string[]=[]; let sequence=0;
  const env:any={ activeTab:{value:a},activeConnection:{value:{id:'a_host',dbType:'MY_SQL'}},
    sqlEditorRef:{value:null},resultPanelRef:{value:null},resultHeight:{value:200},instanceLabel:{value:'数据库'},
    ElMessage:{warning(){},info(){},success(){},error(){}},performance,AbortController,
    visualClientConfig:{defaultQueryMaxRows:200},markRaw:(v:any)=>v,
    isMongoDbType:()=>false,isEditorSessionSql:()=>false,isFreeDmlSql:()=>false,looksLikeControlledDdl:()=>false,
    shouldExecuteAsBatch:()=>false,expandSessionChain:(_full:any,sql:any)=>sql,
    confirmReplaceBatchDrafts:async()=>true,closingQueryTabs:new Set(),
    newSqlRequestId:()=>`repair-${++sequence}`,feedbackSchemaDocSilent(){},recordExecutedSql(){},
    pickErrorMsg:(e:any)=>e.message,executeSql:(args:any)=>new Promise((resolve)=>pending.push({args,resolve})),
    cancelSql:async (args:any)=>cancels.push(args.requestId),confirmSqlWrite:async()=>true,
    isDestructiveDdl:()=>true,describeSqlWriteRisk:()=>'',refreshObjectTreeAfterDdl(){},objectTreeRef:{value:null},
    executeDdl:async(args:any)=>{writes.push(args);return{affectedRows:0};},
    executeDml:async(args:any)=>{writes.push(args);return{affectedRows:1};},
    saveDialog:{saving:false},checkSavedQueryMineExists:async()=>true,editSavedQuery:async(args:any)=>{writes.push(args);},
    markTabSaved:(tab:any,sql:any)=>{tab.savedSqlBaseline=sql;},addSavedQuery:async(args:any)=>{writes.push(args);return{id:8};},
  };
  const context=vm.createContext(env); vm.runInContext(code,context);
  return{a,b,pending,writes,cancels,env,run:(call:string)=>vm.runInContext(call,context),switchB(){env.activeTab.value=b;env.activeConnection.value={id:'b_host',dbType:'MY_SQL'};}};
}

describe('客户端异步执行上下文',()=>{
  it('A 查询结束后只写 A，B 的结果保持独立',async()=>{
    const h=harness(); const running=h.run('runSql()'); await vi.waitFor(()=>expect(h.pending).toHaveLength(1)); h.switchB();
    h.pending[0]!.resolve({columns:['v'],rows:[{v:'A'}],rowCount:1});await running;
    expect(h.a.result.rows).toEqual([{v:'A'}]);expect(h.a.executing).toBe(false);expect(h.b.result).toBeUndefined();
    expect(h.pending[0]!.args.dbConfigId).toBe('a_host');
  });
  it('A 和 B 并行时停止 A 只取消 A 的 requestId',async()=>{
    const h=harness();const runA=h.run('runSql()');await vi.waitFor(()=>expect(h.pending).toHaveLength(1));h.switchB();const runB=h.run('runSql()');await vi.waitFor(()=>expect(h.pending).toHaveLength(2));
    h.env.activeTab.value=h.a;h.env.activeConnection.value={id:'a_host',dbType:'MY_SQL'};
    await h.run('stopSql()');expect(h.cancels).toEqual([h.pending[0]!.args.requestId]);
    expect(h.cancels).not.toContain(h.pending[1]!.args.requestId);
    h.pending[0]!.resolve({columns:[],rows:[]});h.pending[1]!.resolve({columns:[],rows:[]});await Promise.all([runA,runB]);
    expect(h.a.executing).toBe(false);expect(h.b.executing).toBe(false);
  });
  it('写入确认期间切主机仍绑定确认前的目标',async()=>{
    const h=harness();let resolve:(value:boolean)=>void=()=>{};
    h.env.confirmSqlWrite=()=>new Promise<boolean>((done)=>{resolve=done;});
    const running=h.run("runControlledDdl('DROP TABLE t')");h.switchB();resolve(true);await running;
    expect(h.writes[0]).toMatchObject({dbConfigId:'a_host',instanceName:'a_db'});
    expect(h.a.resultTab).toBe('messages');expect(h.b.result).toBeUndefined();
  });
  it('保存期间输入和切标签不会覆盖另一标签或错误重置基线',async()=>{
    const h=harness();h.a.savedQueryId=3;let resolve:(value:boolean)=>void=()=>{};
    h.env.checkSavedQueryMineExists=()=>new Promise<boolean>((done)=>{resolve=done;});
    const saving=h.run("persistActiveQuery({preferUpdate:true,queryName:'saved A'})");
    h.a.sql='SELECT edited during save';h.switchB();resolve(true);await saving;
    expect(h.writes[0]).toMatchObject({dbConfigId:'a_host',sqlText:'SELECT 1',id:3,instanceName:'a_db'});
    expect(h.a.savedSqlBaseline).toBe('SELECT 1');expect(h.a.sql).toBe('SELECT edited during save');expect(h.b.title).toBeUndefined();
  });
});
