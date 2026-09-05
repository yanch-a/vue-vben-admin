import { adminUrl } from '#/config';
import request from '#/utils/request';

const databaseUrl = adminUrl + '/dataBaseOperate/'

/**
 * 测试连接
 */
export function testConnection(dbConfigId: any) {
  return request({
    url: databaseUrl + 'testConnection/' + dbConfigId,
    method: 'get',
  })
}

/**
 * 测试未保存的连接：直接用表单内容建连
 * 编辑已有连接时可只传 id 而不传密码，后端会补齐已保存的密码
 */
export function testConnectionDraft(data: {
  id?: number | string
  dbType: string
  dbHost?: string
  dbPort?: number | string
  schemaName?: string
  jdbcUrl?: string
  username?: string
  password?: string
  sshEnabled?: number
  sshHost?: string
  sshPort?: number | string
  sshUsername?: string
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  aiEnabled?: number
  aiAllowSampleData?: number
}) {
  return request({
    url: databaseUrl + 'testConnectionDraft',
    method: 'post',
    data,
  })
}

/** 预览连接实际使用的 JDBC URL */
export function previewJdbcUrl(data: {
  dbType: string
  dbHost?: string
  dbPort?: number | string
  schemaName?: string
  jdbcUrl?: string
}) {
  return request({
    url: databaseUrl + 'previewJdbcUrl',
    method: 'post',
    data,
  })
}

/** 服务端支持的数据库产品档案（连接形态 / 默认端口 / 驱动可用性） */
export function getDbTypeProfiles() {
  return request({
    url: databaseUrl + 'dbTypeProfiles',
    method: 'get',
  })
}

/**
 * 获取数据库实例
 */
export function getInstances(dbConfigId: any) {
  return request({
    url: databaseUrl + 'getInstances/' + dbConfigId,
    method: 'get',
  })
}

/**
 * 获取数据库实例表
 */
export function getTables(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getTables/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

/**
 * 获取表字段
 */
export function getTableColumns(dbConfigId: any, instanceName: any, tableName: any) {
  return request({
    url:
      databaseUrl +
      'getTableColumns/' +
      dbConfigId +
      '/' +
      instanceName +
      '/' +
      tableName,
    method: 'get',
  })
}

/**
 * 获取表和字段
 */
export function getTablesWithColumns(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getTablesWithColumns/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

/**
 * 获取表 DDL
 */
export function getTableDDL(dbConfigId: any, instanceName: any, tableName: any) {
  return request({
    url:
      databaseUrl +
      'getTableDDL/' +
      dbConfigId +
      '/' +
      instanceName +
      '/' +
      tableName,
    method: 'get',
  })
}

/** 表详情：字段 / 索引 / DDL / 方言扩展属性 */
export function getTableInfo(
  dbConfigId: number | string,
  instanceName: string,
  tableName: string,
) {
  return request({
    url:
      databaseUrl +
      'getTableInfo/' +
      dbConfigId +
      '/' +
      instanceName +
      '/' +
      tableName,
    method: 'get',
  })
}

/** 执行只读自由 SQL（可长时间运行；传 requestId 便于取消） */
export function executeSql(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
  maxRows?: number
  /** 与 cancelSql 配对 */
  requestId?: string
  /** 来源：manual / ai，写入 SQL 历史 */
  source?: string
}, opts?: { signal?: AbortSignal }) {
  return request({
    url: databaseUrl + 'executeSql',
    method: 'post',
    data,
    signal: opts?.signal,
    // 长查询：不走默认 10s；取消靠后端 Statement.cancel
    timeout: 0,
  })
}

/** 取消正在执行的自由 SQL（服务端 kill/cancel） */
export function cancelSql(data: { requestId: string }) {
  return request({
    url: databaseUrl + 'cancelSql',
    method: 'post',
    data,
    timeout: 15_000,
  })
}

/**
 * 执行单条 DML（INSERT / UPDATE / DELETE）
 * 供查询结果行：修改 / 删除
 */
export function executeDml(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
}) {
  return request({
    url: databaseUrl + 'executeDml',
    method: 'post',
    data,
  })
}

/** 执行单条受控 DDL（建删库/Schema/用户、删表、GRANT 等） */
export function executeDdl(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
}) {
  return request({
    url: databaseUrl + 'executeDdl',
    method: 'post',
    data,
  })
}

/**
 * 自由 SQL 导出 Excel：后台重新执行 SQL 后返回 xlsx（blob）
 * @author yanch
 */
export function exportSqlExcel(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
  maxRows?: number
}) {
  return request({
    url: databaseUrl + 'exportExcel',
    method: 'post',
    responseType: 'blob',
    data,
  })
}

/**
 * 自由 SQL 导出 INSERT：后台重查后按库方言生成 .sql（blob）
 * @author yanch
 */
export function exportSqlInsert(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
  tableName: string
  schemaName?: string
  maxRows?: number
}) {
  return request({
    url: databaseUrl + 'exportSqlInsert',
    method: 'post',
    responseType: 'blob',
    data,
  })
}

/**
 * 表结构/数据 SQL 转储导出（blob .sql）
 * @author yanch
 */
export function exportSqlDump(data: {
  dbConfigId: number | string
  instanceName: string
  tableNames: string[]
  mode?: 'structure' | 'data' | 'both'
  includeUseDatabase?: boolean
  includeCreateDatabase?: boolean
  foreignKeyChecks0?: boolean
  createBulkInsert?: boolean
  oneRowPerLine?: boolean
  includeDrop?: boolean
  includeVersionInfo?: boolean
  convertBlobToHex?: boolean
  maxRows?: number
}) {
  return request({
    url: databaseUrl + 'exportSqlDump',
    method: 'post',
    responseType: 'blob',
    data,
  })
}

export function getViews(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getViews/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

export function getProcedures(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getProcedures/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

export function getFunctions(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getFunctions/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

export function getTriggers(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getTriggers/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

export function getEvents(dbConfigId: any, instanceName: any) {
  return request({
    url: databaseUrl + 'getEvents/' + dbConfigId + '/' + instanceName,
    method: 'get',
  })
}

/**
 * 生成视图/过程/函数/触发器/事件的编辑脚本（后端按方言实现）
 * action: execute | create | alter | drop
 * objectKind: view | procedure | function | trigger | event（也可传复数）
 */
export function getObjectScript(data: {
  dbConfigId: number | string
  instanceName: string
  objectKind: string
  action: 'execute' | 'create' | 'alter' | 'drop' | string
  objectName?: string
}) {
  return request({
    url: databaseUrl + 'objectScript',
    method: 'post',
    data,
  })
}
