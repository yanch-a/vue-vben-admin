/**
 * 数据库客户端运行时配置
 * 修改后需刷新页面；与 localStorage 会话恢复上限也会参考这些值
 *
 * @author yanch
 */
export const visualClientConfig = {
  /**
   * 是否允许同时打开多个数据库连接。
   * false：打开新连接时会关闭已打开的其它连接（始终只保留一个）
   */
  allowMultipleConnections: true,

  /**
   * 最多同时打开的数据库连接数（页签数）。
   * 仅当 allowMultipleConnections=true 时生效
   */
  maxOpenConnections: 10,

  /**
   * 每个连接下最多可打开的 SQL 编辑器 Tab 数
   */
  maxSqlEditorsPerConnection: 20,

  /**
   * 自由 SQL 未写 LIMIT/TOP 时的默认返回行数（安全阀）
   */
  defaultQueryMaxRows: 200,

  /**
   * 跨库复制里勾选「限制行数」后的默认上限。
   * 查询结果导出和表右键导出 Excel 不使用这个值，按 SQL 实际结果导出。
   */
  exportMaxRows: 50_000,
} as const;

export type VisualClientConfig = typeof visualClientConfig;
