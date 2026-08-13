import request from '@/utils/request'

// 查询会员用户列表
export function listMemberUser(query: any) {
  return request({
    url: '/admin/member/memberUserManage/getPage',
    method: 'get',
    params: query
  })
}

// 查询会员用户列表
export function searchMemberUser(query: any) {
  return request({
    url: '/admin/member/memberUserManage/search',
    method: 'get',
    params: query
  })
}

// 查询会员用户详细
export function getMemberUser(id: number) {
  return request({
    url: '/admin/member/memberUserManage/' + id,
    method: 'get'
  })
}

// 新增会员用户
export function addMemberUser(data: any) {
  return request({
    url: '/admin/member/memberUserManage/add',
    method: 'post',
    data
  })
}

// 修改会员用户
export function updateMemberUser(data: any) {
  return request({
    url: '/admin/member/memberUserManage/doEdit',
    method: 'post',
    data
  })
}

// 删除会员用户
export function delMemberUser(ids: string) {
  return request({
    url: '/admin/member/memberUserManage/del/' + ids,
    method: 'get'
  })
}

// 会员用户注册
export function registerMemberUser(data: any) {
  return request({
    url: '/admin/member/register',
    method: 'post',
    data
  })
}

// 发送注册短信验证码
export function sendRegisterCode(phoneNumber: string) {
  return request({
    url: '/admin/member/register/sendCode',
    method: 'post',
    params: { phoneNumber },
  })
}

// 检查用户名是否可用
export function checkUsername(username: string) {
  return request({
    url: '/admin/member/checkUsername/' + username,
    method: 'get'
  })
}

// 检查手机号是否可用
export function checkPhone(phone: string) {
  return request({
    url: '/admin/member/checkPhone/' + phone,
    method: 'get'
  })
}
