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

/** 执行只读自由 SQL */
export function executeSql(data: {
  dbConfigId: number | string
  instanceName?: string
  sql: string
  maxRows?: number
}) {
  return request({
    url: databaseUrl + 'executeSql',
    method: 'post',
    data,
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
