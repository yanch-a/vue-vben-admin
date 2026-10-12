/** 预览请求同时绑定任务/工作区/配置和请求代次，旧响应及旧 finally 均不得干扰新预览。@author yanch */
export function createEtlPreviewSession(context: () => string) {
  let generation = 0;
  return {
    /** 开始请求时冻结上下文，后发请求自动使之前的请求失效。 */
    begin: () => ({ generation: ++generation, context: context() }),
    /** 展示结果、错误提示前同时确认当前意图及配置快照。 */
    current: (request: { generation: number; context: string }) =>
      request.generation === generation && request.context === context(),
    /** loading 只属于最后请求，即使配置改变，也允许其最终清理自己的 loading。 */
    latest: (request: { generation: number }) => request.generation === generation,
    /** 切换任务、关闭页面或主动废弃请求后，返回相同任务也不能恢复旧请求。 */
    invalidate: () => { generation++; },
  };
}
