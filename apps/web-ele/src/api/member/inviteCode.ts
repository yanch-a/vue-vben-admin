import request from '@/utils/request'

// 查询邀请码列表
export function listInviteCode(query: any) {
  return request({
    url: '/admin/member/invite/getList',
    method: 'get',
    params: query,
  })
}

// 查询邀请码详细
export function getInviteCode(id: number) {
  return request({
    url: '/admin/member/invite/' + id,
    method: 'get',
  })
}

// 新增邀请码
export function addInviteCode(data: any) {
  return request({
    url: '/admin/member/invite/add',
    method: 'post',
    data,
  })
}

// 修改邀请码
export function updateInviteCode(data: any) {
  return request({
    url: '/admin/member/invite/doEdit',
    method: 'post',
    data,
  })
}

// 删除邀请码
export function delInviteCode(ids: string) {
  return request({
    url: '/admin/member/invite/doDelete/' + ids,
    method: 'get',
  })
}

// 批量生成邀请码
export function batchGenerateInviteCode(
  memberUserId: number,
  count: number,
  parentInviteCode?: string
) {
  return request({
    url: '/admin/member/invite/batchGenerate',
    method: 'post',
    params: {
      memberUserId,
      count,
      parentInviteCode,
    },
  })
}

// 验证邀请码
export function validateInviteCode(inviteCode: string) {
  return request({
    url: '/admin/member/invite/validate/' + inviteCode,
    method: 'get',
  })
}

// 个人中心-更新邀请码（绑定邀请码）
export function updatePersonalInviteCode(inviteCode: string) {
  return request({
    url: '/admin/member/personal/updateInviteCode',
    method: 'post',
    data: { inviteCode },
  })
}
