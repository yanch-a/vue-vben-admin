/**
 * 会员分组（部门）API
 * @author yanch
 */
import request from '@/utils/request'

const urlPre = '/admin/member/memberUserGroup/'

/** 分页列表 */
export function listMemberUserGroup(query: any) {
  return request({
    url: urlPre + 'getPage',
    method: 'get',
    params: query,
  })
}

/** 全量列表（下拉 / 授权弹窗） */
export function getMemberUserGroupList(query?: any) {
  return request({
    url: urlPre + 'getList',
    method: 'get',
    params: query,
  })
}

/** 详情 */
export function getMemberUserGroup(id: number | string) {
  return request({
    url: urlPre + id,
    method: 'get',
  })
}

/** 组内会员 */
export function listMemberUsersByGroup(groupId: number | string) {
  return request({
    url: urlPre + 'users/' + groupId,
    method: 'get',
  })
}

/** 新增 */
export function addMemberUserGroup(data: any) {
  return request({
    url: urlPre + 'add',
    method: 'post',
    data,
  })
}

/** 修改 */
export function updateMemberUserGroup(data: any) {
  return request({
    url: urlPre + 'doEdit',
    method: 'post',
    data,
  })
}

/** 删除，ids 逗号分隔或数组 */
export function delMemberUserGroup(ids: string | number | Array<string | number>) {
  const path = Array.isArray(ids) ? ids.join(',') : ids
  return request({
    url: urlPre + 'del/' + path,
    method: 'get',
  })
}
