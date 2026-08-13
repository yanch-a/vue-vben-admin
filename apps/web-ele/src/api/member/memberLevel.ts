import request from '@/utils/request'

// 查询会员等级列表
export function listMemberLevel(query: any) {
  return request({
    url: '/admin/member/memberLevelManage/getPage',
    method: 'get',
    params: query
  })
}

// 查询会员等级详细
export function getMemberLevel(id: number) {
  return request({
    url: '/admin/member/memberLevelManage/' + id,
    method: 'get'
  })
}

// 新增会员等级
export function addMemberLevel(data: any) {
  return request({
    url: '/admin/member/memberLevelManage/add',
    method: 'post',
    data
  })
}

// 修改会员等级
export function updateMemberLevel(data: any) {
  return request({
    url: '/admin/member/memberLevelManage/doEdit',
    method: 'post',
    data
  })
}

// 删除会员等级
export function delMemberLevel(ids: string) {
  return request({
    url: '/admin/member/memberLevelManage/del/' + ids,
    method: 'get'
  })
}

// 获取会员等级列表（不分页）
export function getMemberLevelList(query?: any) {
  return request({
    url: '/admin/member/memberLevelManage/getList',
    method: 'get',
    params: query
  })
}
