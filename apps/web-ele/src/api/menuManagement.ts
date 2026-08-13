import request from '@/utils/request'

export function getTree(params?: any) {
  return request({
    url: '/system/menuManagement/getTree',
    method: 'get',
    params,
  })
}

export function getList(params: any) {
  return request({
    url: '/system/menuManagement/getList',
    method: 'get',
    params,
  })
}

export function doEdit(data: any) {
  return request({
    url: '/system/menuManagement/doEdit',
    method: 'post',
    data,
  })
}

export function doDelete(params: any) {
  return request({
    url: '/system/menuManagement/del/'+params.id,
    method: 'get',
  })
}

export function getById(params: any) {
  return request({
    url: '/system/menuManagement/'+params.menuId,
    method: 'get',
  })
}

export function doUpdate(data: any) {
  return request({
    url: '/system/menuManagement/doUpdate',
    method: 'post',
    data,
  })
}

export function getModules() {
  return request({
    url: '/system/menuManagement/getMemoryMenus',
    method: 'get',
  })
}