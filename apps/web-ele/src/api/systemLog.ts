import request from '@/utils/request'

export function getOperLogList(params?: any) {
  return request({
    url: '/system/operlog/getPage',
    method: 'get',
    params,
  })
}

export function getLoginLogList(params?: any) {
  return request({
    url: '/system/logininfor/getPage',
    method: 'get',
    params,
  })
}
