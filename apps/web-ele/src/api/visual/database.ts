import { adminUrl } from '#/config';
import request from '#/utils/request';

const databaseUrl = adminUrl + '/dataBaseOperate/'

/**
 * 测试连接
 * @param dbConfigId
 * @returns 
 */
export function testConnection(dbConfigId: any) {
    return request({
        url: databaseUrl + "testConnection/" + dbConfigId,
        method: 'get',
    })
}

/**
 * 获取数据库实例
 * @param dbConfigId
 * @returns 
 */
export function getInstances(dbConfigId: any) {
    return request({
        url: databaseUrl + "getInstances/" + dbConfigId,
        method: 'get',
    })
}

/**
 * 获取数据库实例表
 * @param dbConfigId
 * @param instanceName
 * @returns 
 */
export function getTables(dbConfigId: any, instanceName: any) {
    return request({
        url: databaseUrl + "getTables/" + dbConfigId + "/" + instanceName,
        method: 'get',
    })
}

/**
 * 获取数据库实例表和字段
 * @param dbConfigId
 * @param instanceName
 * @param tableName
 * @returns 
 */
export function getTableColumns(dbConfigId: any, instanceName: any, tableName: any) {
    return request({
        url: databaseUrl + "getTableColumns/" + dbConfigId + "/" + instanceName + "/" + tableName,
        method: 'get',
    })
}

/**
 * 获取数据库实例表和字段
 * @param dbConfigId
 * @param instanceName
 */
export function getTablesWithColumns(dbConfigId: any, instanceName: any) {
    return request({
        url: databaseUrl + "getTablesWithColumns/" + dbConfigId + "/" + instanceName,
        method: 'get',
    })
}

/**
 * 获取数据库表DDL
 * @param dbConfigId
 * @param instanceName
 * @param tableName
 */
export function getTableDDL(dbConfigId: any, instanceName: any, tableName: any) {
    return request({
        url: databaseUrl + "getTableDDL/" + dbConfigId + "/" + instanceName + "/" + tableName,
        method: 'get',
    })
}
