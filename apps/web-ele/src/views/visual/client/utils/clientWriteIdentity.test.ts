// @vitest-environment node
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {resolveSqlDialect,resolveTableIdent} from '../dialect/sqlDialect';
import {parseQueryTables} from './resultRowSql';

/** 提取实际页面函数验证确认框/分步结果的目的地，不用测试替身重新实现写入逻辑。@author yanch */
function actual(name:string,env:Record<string,unknown>) {
  const script=readFileSync(new URL('../index.vue',import.meta.url),'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
  const ast=ts.createSourceFile('client.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const fn=ast.statements.find((node)=>ts.isFunctionDeclaration(node)&&node.name?.text===name)!;
  const context=vm.createContext({resolveSqlDialect,resolveTableIdent,...env});
  vm.runInContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return (...args:unknown[])=>{context.arguments_=args;return vm.runInContext(`${name}(...arguments_)`,context);};
}

describe('数据写入目标身份',()=>{
  it.each(['truncateTable','dropTable','dropDatabase'])('确认 %s 期间切主机仍只操作发起的 A',async(action)=>{
    let release:()=>void=()=>{};const pending=new Promise<void>((resolve)=>{release=resolve;});
    const a={id:1,dbType:'MY_SQL',schemaName:'safe_a'},b={id:2,dbType:'POSTGRE_SQL',schemaName:'safe_b'};
    const current={value:a};const writes=vi.fn().mockResolvedValue({affectedRows:1});
    const originalTabs=[{id:'a',instanceName:'target'}],otherTabs=[{id:'b',instanceName:'target'}];const tabs={value:originalTabs};
    const run=actual('onTreeContextAction',{activeConnection:current,instanceOptions:{value:['safe_a','target']},tabs,
      ElMessageBox:{confirm:()=>pending},ElMessage:{success:vi.fn(),warning:vi.fn(),error:vi.fn()},executeDdl:writes,executeDml:writes,
      objectTreeRef:{value:null},refreshBrowseObjects:vi.fn()});
    const writing=run({action,node:{instanceName:'target',name:'records'}});current.value=b;tabs.value=otherTabs;release();await writing;
    expect(writes).toHaveBeenCalledOnce();expect(writes.mock.calls[0]![0].dbConfigId).toBe(1);
    expect(otherTabs[0]!.instanceName).toBe('target');
  });
  it('批量传输保留每条结果的库和连接身份',()=>{
    const map=actual('mapBatchResultSet',{markRaw:(value:unknown)=>value});
    const result=map({columns:['id'],rows:[{id:1}],sourceInstanceName:'B',sourceConnectionFingerprint:'original',readOnlyReason:'unknown namespace'},0);
    expect(result.sourceInstanceName).toBe('B');expect(result.sourceConnectionFingerprint).toBe('original');expect(result.readOnlyReason).toBe('unknown namespace');
  });
  it('派生表或 CTE 混入查询时不能把剩余表误当唯一回写目标',()=>{
    expect(parseQueryTables('SELECT x.id,b.v FROM (SELECT id FROM a) x JOIN b ON x.id=b.a_id')).toEqual([]);
    expect(parseQueryTables('WITH x AS (SELECT id FROM a) SELECT x.id,b.v FROM x JOIN b ON x.id=b.a_id')).toEqual([]);
  });
});
