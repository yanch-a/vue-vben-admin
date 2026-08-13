import request from '@/utils/request'

export function getList(params?: any) {
  return request({
    url: '/system/roleManagement/getList',
    method: 'get',
    params,
  })
}

export function doEdit(data: any) {
  if(data.roleId){
    return request({
      url: '/system/roleManagement/doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: '/system/roleManagement/add',
      method: 'post',
      data,
    })
  }
  
}

export function doDelete(data: any) {
  return request({
    url: '/system/roleManagement/del/'+data.ids,
    method: 'get',
  })
}

export function getRoleList(params: any) {
  return request({
    url: '/system/roleManagement/getList',
    method: 'get',
    params,
  })
}

export function getById(params: any) {
  return request({
    url: '/system/roleManagement/'+params.id,
    method: 'get',
  })
}

export function getModuleOperations(params: any) {
  return request({
    url: '/system/roleManagement/getOperations',
    method: 'post',
    params,
  })
}

export function getModuleIds(params: any) {
  return request({
    url: '/system/roleManagement/getRoleModuleIds',
    method: 'get',
    params,
  })
}

export function updateRolePerm(params: any) {
  return request({
    url: '/system/roleManagement/updateRolePerm',
    method: 'post',
    params,
  })
}

export function updateRoleOpera(params: any) {
  return request({
    url: '/system/roleManagement/updateRoleOpera',
    method: 'post',
    params,
  })
}

export function getOptionselect() {
  return request({
    url: '/system/roleManagement/optionselect',
    method: 'get',
  })
}

export function updateRoleChannelPerm(params: any) {
  return request({
    url: '/system/roleManagement/updateRoleChannelPerm',
    method: 'post',
    params,
  })
}

export function getChannelIds(params: any) {
  return request({
    url: '/system/roleManagement/getChannelIds',
    method: 'get',
    params,
  })
}


