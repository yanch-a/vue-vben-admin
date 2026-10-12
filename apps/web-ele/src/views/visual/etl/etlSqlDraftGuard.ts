import { createEtlPreviewSession } from './etlPreviewSession';

/** 元数据生成 SQL 的代次门禁，保护切换步骤、资源变更及用户新输入。@author yanch */
export function createEtlSqlDraftGuard(context: () => string) {
  const requests = createEtlPreviewSession(context);
  return {
    ...requests,
    /** 捕获目标对象，异步完成后只写同一个仍有效的草稿对象。 */
    capture: <T extends { config: Record<string, any> }>(target: T) => {
      const request = requests.begin();
      return {
        current: () => requests.current(request),
        latest: () => requests.latest(request),
        apply: (sql: string) => {
          if (!requests.current(request)) return false;
          target.config.sql = sql; return true;
        },
      };
    },
  };
}
