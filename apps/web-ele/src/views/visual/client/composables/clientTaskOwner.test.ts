import { nextTick } from 'vue';
import { useUserStore } from '@vben/stores';
import { describe, expect, it, vi } from 'vitest';
import { useClientTasks } from './useClientTasks';

const api=vi.hoisted(()=>({list:vi.fn(),get:vi.fn()}));
vi.mock('@vben/stores',async()=>{
  const {reactive}=await import('vue');const store=reactive({userInfo:{userId:40}});
  return {useUserStore:()=>store};
});
vi.mock('#/desktop/runtime',()=>({getDesktopScopedStorageKey:(key:string)=>key}));
vi.mock('#/api/visual/dbCopy',()=>({listDbCopyTasks:api.list,getDbCopyTask:api.get,cancelDbCopyTask:vi.fn()}));
vi.mock('#/api/ai/schemaDoc',()=>({schemaDocTaskList:async()=>[],schemaDocTask:vi.fn(),cancelSchemaDocTask:vi.fn()}));
vi.mock('#/api/visual/sqlScript',()=>({listSqlScriptTasks:async()=>[],getSqlScriptTask:vi.fn(),cancelSqlScriptTask:vi.fn()}));
vi.mock('#/api/visual/dbBackup',()=>({listDbBackupTasks:async()=>[],getDbBackupTask:vi.fn(),cancelDbBackupTask:vi.fn()}));

/** 模拟退出并切换用户，旧列表响应和无权详情不能保留在新用户后台任务中。@author yanch */
describe('后台任务用户隔离',()=>{
  it('用户缓存与迟到响应隔离，并移除无权任务',async()=>{
    vi.useFakeTimers();let finishOld:(value:any)=>void=()=>{};
    api.list.mockImplementationOnce(()=>new Promise((resolve)=>{finishOld=resolve;})).mockResolvedValue([]);
    api.get.mockRejectedValue({response:{status:403},message:'无权访问任务'});
    const task={id:'old-task',source:'copy',kind:'COPY',status:'RUNNING',title:'private A',total:1,done:0,createTime:Date.now(),errors:[]};
    localStorage.setItem('vc:client-running-tasks:u:40',JSON.stringify([task]));
    localStorage.setItem('vc:client-running-tasks:u:41',JSON.stringify([{...task,id:'new-task',title:'private B'}]));
    const state=useClientTasks();expect(state.tasks.value[0]?.id).toBe('old-task');
    (useUserStore().userInfo as any).userId=41;await nextTick();
    for(let i=0;i<8;i++)await Promise.resolve();
    expect(state.tasks.value.every((t)=>t.id!=='old-task')).toBe(true);
    finishOld([{taskId:'late-A',status:'RUNNING',sourceInstance:'private A'}]);
    for(let i=0;i<8;i++)await Promise.resolve();
    expect(state.tasks.value).toEqual([]);
    (useUserStore() as any).userInfo=null;await nextTick();expect(state.runningCount.value).toBe(0);
    state.dispose();vi.useRealTimers();
  });
});
