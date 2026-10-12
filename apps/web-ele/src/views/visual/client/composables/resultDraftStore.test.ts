import { describe, expect, it } from 'vitest';
import { allResultStates, focusBatchResult, getResultDraft, hasResultDraft, isResultSaving, putResultDraft, setResultSaving, syncBatchResult } from './resultDraftStore';
import type { QueryResultSet, QueryResultState } from './useQueryTabs';

/** 多 SQL 分步结果必须独立保留元数据、草稿和保存状态。@author yanch */
describe('分步结果身份及草稿',()=>{
  /** 创建字段形状相同但类型/集合不同的两份结果，覆盖错误混用的条件。 */
  function fixture():QueryResultState {
    const sets:QueryResultSet[]=['a','b'].map((table,index)=>({index:index+1,sql:`SELECT id,payload FROM ${table}`,success:true,
      columns:['id','payload'],columnMetadata:[{label:'payload',name:'payload',jdbcType:index?12:1111,typeName:index?'varchar':'json',precision:0,scale:0}],rows:[{id:index+1,payload:index?'text':'{}'}],rowCount:1}));
    return {...sets[0]!,sourceSql:sets[0]!.sql,sourceInstanceName:'origin',sets,activeSet:0};
  }
  it('切换产生独立身份，回来后恢复原草稿和原类型',()=>{
    const a=fixture();putResultDraft(a,{rows:[{id:1,payload:'changed'}],original:a.rows,dirty:new Set([0]),added:new Set(),editingCell:null,editDraft:''});
    const b=focusBatchResult(a,1);expect(b).not.toBe(a);expect(b.columnMetadata?.[0]?.typeName).toBe('varchar');expect(getResultDraft(b)).toBeUndefined();
    const restored=focusBatchResult(b,0);expect(restored).toBe(a);expect(restored.columnMetadata?.[0]?.typeName).toBe('json');expect(getResultDraft(restored)?.rows[0]?.payload).toBe('changed');
  });
  it('隐藏分步结果的草稿和执行状态都能被关闭保护发现',()=>{
    const a=fixture();setResultSaving(a,true);putResultDraft(a,{rows:a.rows,original:a.rows,dirty:new Set([0]),added:new Set(),editingCell:null,editDraft:''});
    const b=focusBatchResult(a,1);expect(allResultStates(b).some(hasResultDraft)).toBe(true);expect(allResultStates(b).some(isResultSaving)).toBe(true);
    setResultSaving(a,false);expect(allResultStates(b).some(isResultSaving)).toBe(false);
  });
  it('刷新当前分步结果更换当前 set，其它分步草稿仍可恢复',()=>{
    const a=fixture();putResultDraft(a,{rows:a.rows,original:a.rows,dirty:new Set([0]),added:new Set(),editingCell:null,editDraft:''});
    const b=focusBatchResult(a,1);const sets=b.sets!.slice();sets[1]={...sets[1]!,rows:[{id:2,payload:'fresh'}]};
    const refreshed={...b,rows:sets[1]!.rows,sets};expect(focusBatchResult(refreshed,0)).toBe(a);expect(getResultDraft(a)).toBeDefined();
  });
  it('异步删除原结果后，堆叠表格同步新的行引用和数量',()=>{
    const a=fixture();const b=focusBatchResult(a,1);
    a.rows=[];a.rowCount=0;syncBatchResult(a);
    expect(b.sets![0]!.rows).toBe(a.rows);expect(b.sets![0]!.rowCount).toBe(0);
    expect(focusBatchResult(b,0).rows).toEqual([]);
  });
  it('USE 切库后每份分步结果仍使用各自实例和只读状态',()=>{
    const a=fixture();a.sourceInstanceName='A';a.sets![0]!.sourceInstanceName='A';
    a.sets![1]!.sourceInstanceName='B';a.sets![1]!.readOnlyReason='namespace not confirmed';
    const b=focusBatchResult(a,1);expect(b.sourceInstanceName).toBe('B');expect(b.readOnlyReason).toBe('namespace not confirmed');
    expect(focusBatchResult(b,0).sourceInstanceName).toBe('A');
  });
});
