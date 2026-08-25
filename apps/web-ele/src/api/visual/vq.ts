import { adminUrl } from '#/config';
import request from '#/utils/request';

const visualQueryUrl = adminUrl + '/visualQuery/'
const dbTableUrl = adminUrl + '/dbTable/'
const dbFieldUrl = adminUrl + '/dbField/'
const dbConfigUrl = adminUrl + '/dbConfig/'
const tableGroupUrl = adminUrl + '/tableGroup/'
const queryConfigUrl = adminUrl + '/queryConfig/'
const queryConfigItemUrl = adminUrl + '/queryConfigItem/'
const tableRelationshipUrl = adminUrl + '/tableRelationship/'
const queryExecuteUrl = adminUrl + '/queryExecute/'

/** 获取字典项 */
export function getVqDict() {
  return request({
    url: visualQueryUrl + "dict",
    method: 'get',
  })
}

/** ********************************** DbConfigController *********************************/
export function getDbConfigList(params: any) {
  return request({
    url: dbConfigUrl + 'getList',
    method: 'get',
    params,
  })
}

export function getDbConfigPage(params: any) {
  return request({
    url: dbConfigUrl + 'getPage',
    method: 'get',
    params,
  })
}

export function editDbConfig(data: any) {
  if(data.id){
    return request({
      url: dbConfigUrl + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: dbConfigUrl + 'add',
      method: 'post',
      data,
    })  
  }
}

export function getDbConfigById(params: any) {
  if(params.id){
    return request({
      url: dbConfigUrl + params.id,
      method: 'get',
    })
  }
}

export function deleteDbConfig(data: any) {
  return request({
    url: dbConfigUrl + 'del/'+data.ids,
    method: 'get',
    data,
  })
}

/** ********************************** TableGroupController *********************************/
export function getTableGroupList(params: any) {
  return request({
    url: tableGroupUrl + 'getList',
    method: 'get',
    params,
  })
}

export function editTableGroup(data: any) {
  if(data.id){
    return request({
      url: tableGroupUrl + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: tableGroupUrl + 'add',
      method: 'post',
      data,
    })  
  }
}

export function getTableGroupById(params: any) {
  if(params.id){
    return request({
      url: tableGroupUrl + params.id,
      method: 'get',
    })
  }
}

export function deleteTableGroup(data: any) {
  return request({
    url: tableGroupUrl + 'del/'+data.ids,
    method: 'get',
    data,
  })
}

/** ********************************** DbTableController *********************************/
export function getTablesWithColumns(data: any) {
  return request({
    url: dbTableUrl + 'getTablesWithColumns',
    method: 'post',
    data,
  })
}

/** 按分组引用加载表及字段 */
export function getGroupTablesWithColumns(groupId: number | string) {
  return request({
    url: dbTableUrl + 'getGroupTablesWithColumns/' + groupId,
    method: 'get',
  })
}

export function editDbTable(data: any) {
  if(data.id){
    return request({
      url: dbTableUrl + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: dbTableUrl + 'add',
      method: 'post',
      data,
    })  
  }
}

/** 保存分组到数据库 */
export function saveGroupTables2DB(groupId: string, tables: any[]) {
  return request({
    url: dbTableUrl + 'save/' + groupId,
    method: 'post',
    data: tables,
  })
}

export function getDbTableById(params: any) {
  if(params.id){
    return request({
      url: dbTableUrl + params.id,
      method: 'get',
    })
  }
}

export function deleteDbTable(data: any) {
  return request({
    url: dbTableUrl + 'del/'+data.ids,
    method: 'get',
    data,
  })
}

/** ********************************** DbFieldController *********************************/
export function getDbFieldList(params: any) {
  return request({
    url: dbFieldUrl + 'getList',
    method: 'get',
    params,
  })
}

export function getDbFieldById(params: any) {
  if(params.id){
    return request({
      url: dbFieldUrl + params.id,
      method: 'get',
    })
  }
}

export function editDbField(data: any) {
  if(data.id){
    return request({
      url: dbFieldUrl + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: dbFieldUrl + 'add',
      method: 'post',
      data,
    })  
  }
}

export function deleteDbField(data: any) {
  return request({
    url: dbFieldUrl + 'del/'+data.ids,
    method: 'get',
    data,
  })
}

/** ********************************** QueryConfigController *********************************/
export function getQueryConfigList(data: any) {
  return request({
    url: queryConfigUrl + 'getList',
    method: 'post',
    data,
  })
}

export function editQueryConfig(data: any) {
  if(data.id){
    return request({
      url: queryConfigUrl + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: queryConfigUrl + 'add',
      method: 'post',
      data,
    })  
  }
}

export function getQueryConfigById(params: any) {
  if(params.id){
    return request({
      url: queryConfigUrl + params.id,
      method: 'get',
    })
  }
}

export function deleteQueryConfig(id: string) {
  return request({
    url: queryConfigUrl + 'del/'+id,
    method: 'get',
  })
}

/** ********************************** QueryConfigItemController *********************************/
/** 获取查询配置项（按 COLUMN/WHERE/GROUP/ORDER 分组返回） */
export function getQueryConfigItems(queryConfigId: string) {
  return request({
    url: queryConfigItemUrl + 'getQueryConfigItems/' + queryConfigId,
    method: 'get',
  })
}

export function saveQueryItems(queryConfigId: string, data: any ) {
  return request({
    url: queryConfigItemUrl + 'saveQueryItems/' + queryConfigId,
    method: 'post',
    data,
  })
}

/** ********************************** TableRelationshipController *********************************/
/** 按数据库加载关系网；可选 canvasGroupId */
export function loadRelationCanvas(
  dbConfigId: string | number,
  canvasGroupId?: string | number | null,
) {
  return request({
    url: tableRelationshipUrl + 'loadCanvas/' + dbConfigId,
    method: 'get',
    params: canvasGroupId != null && canvasGroupId !== '' ? { canvasGroupId } : undefined,
  })
}

/** 批量保存关系画布：{ dbConfigId, nodes: [{tableId,posX,posY}], relationships: [...] } */
export function saveRelationCanvas(data: any) {
  return request({
    url: tableRelationshipUrl + 'saveCanvas',
    method: 'post',
    data,
  })
}

/** 自动寻路：{ dbConfigId, tableIds } → { connected, relationships, intermediateTableIds, message } */
export function findBestRelationshipPath(data: any) {
  return request({
    url: tableRelationshipUrl + 'findBestRelationshipPath',
    method: 'post',
    data,
  })
}

/** 按库加载表目录（含字段），关系画布左侧列表用 */
export function getTablesByDbConfig(dbConfigId: string) {
  return request({
    url: dbTableUrl + 'getTablesWithColumns',
    method: 'post',
    data: { dbConfigId },
  })
}

/** 按库加载表目录（不含字段，轻量） */
export function getCatalogTablesLight(dbConfigId: number | string) {
  return request({
    url: dbTableUrl + 'getTablesByDbConfigId/' + dbConfigId,
    method: 'get',
  })
}

/** 按表主键批量加载表及字段 */
export function getTablesWithColumnsByIds(ids: Array<number | string>) {
  return request({
    url: dbTableUrl + 'getTablesWithColumnsByIds',
    method: 'post',
    data: ids,
  })
}

/** 将远端单表同步到本地目录（含字段） */
export function syncTableToCatalog(data: {
  dbConfigId: number | string
  displayName?: string
  schemaName: string
  tableName: string
}) {
  return request({
    url: dbTableUrl + 'syncTableToCatalog',
    method: 'post',
    data,
  })
}

/** ********************************** QueryExecuteController *********************************/
/** SQL 预览（不执行） */
export function previewQuerySql(configId: string) {
  return request({
    url: queryExecuteUrl + 'previewSql',
    method: 'post',
    data: { configId },
  })
}

/** 根据勾选字段或草稿配置项预览 SQL */
export function previewSqlBySelection(data: {
  dbConfigId: number | string
  groupId?: number | string
  fieldIds?: Array<number | string>
  items?: any[]
  selectDistinct?: number
  canvasGroupIds?: Array<number | string>
  configId?: number | string
}) {
  return request({
    url: queryExecuteUrl + 'previewSqlBySelection',
    method: 'post',
    data,
  })
}

/** 执行查询 */
export function executeQueryConfig(configId: string, limit?: number) {
  return request({
    url: queryExecuteUrl + 'execute',
    method: 'post',
    data: { configId, limit },
  })
}

/** 导出 Excel（blob） */
export function exportQueryExcel(configId: string, limit?: number) {
  return request({
    url: queryExecuteUrl + 'exportExcel',
    method: 'post',
    responseType: 'blob',
    data: { configId, limit },
  })
}

/** ********************************** DbConfig 授权 / 画布分组 *********************************/
const dbConfigUserUrl = adminUrl + '/dbConfigUser/'
const relationCanvasGroupUrl = adminUrl + '/relationCanvasGroup/'
const memberUserGroupUrl = adminUrl + '/member/memberUserGroup/'

/** 授权列表 */
export function listDbConfigUsers(dbConfigId: number | string) {
  return request({
    url: dbConfigUserUrl + 'list/' + dbConfigId,
    method: 'get',
  })
}

/** 全量替换授权 */
export function replaceDbConfigUsers(data: {
  dbConfigId: number | string
  grants: Array<{ memberUserId: number | string; canUse?: number; canEditCanvas?: number }>
}) {
  return request({
    url: dbConfigUserUrl + 'replace',
    method: 'post',
    data,
  })
}

/** 画布分组列表（按库可见） */
export function listRelationCanvasGroups(dbConfigId: number | string) {
  return request({
    url: relationCanvasGroupUrl + 'listByDb/' + dbConfigId,
    method: 'get',
  })
}

export function addRelationCanvasGroup(data: any) {
  return request({
    url: relationCanvasGroupUrl + 'add',
    method: 'post',
    data,
  })
}

export function editRelationCanvasGroup(data: any) {
  return request({
    url: relationCanvasGroupUrl + 'doEdit',
    method: 'post',
    data,
  })
}

export function deleteRelationCanvasGroup(id: number | string) {
  return request({
    url: relationCanvasGroupUrl + 'del/' + id,
    method: 'get',
  })
}

/** 查询配置选用画布 */
export function replaceQueryConfigCanvas(data: {
  configId: number | string
  canvasGroupIds: Array<number | string>
}) {
  return request({
    url: queryConfigUrl + 'replaceCanvas',
    method: 'post',
    data,
  })
}

/** 会员组列表 */
export function listMemberUserGroups(params?: any) {
  return request({
    url: memberUserGroupUrl + 'getList',
    method: 'get',
    params,
  })
}

/** 会员组内用户 */
export function listMemberUsersByGroup(groupId: number | string) {
  return request({
    url: memberUserGroupUrl + 'users/' + groupId,
    method: 'get',
  })
}
