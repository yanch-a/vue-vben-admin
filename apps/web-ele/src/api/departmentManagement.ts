import request from '@/utils/request'

export function getList(params?: any) {
  return request({
    url: '/system/department/getList',
    method: 'get',
    params,
  })
}

export function doEdit(data: any) {
  return request({
    url: '/system/department/doEdit',
    method: 'post',
    data,
  })
}

export function doDelete(params: any) {
  return request({
    url: '/system/department/del/'+params.id,
    method: 'get',
  })
}

export function getTree(params: any) {
  return request({
    url: '/system/department/getTree',
    method: 'get',
    params,
  })
}

export function getById(params: any) {
  return request({
    url: '/system/department/'+params.id,
    method: 'get',
  })
}
