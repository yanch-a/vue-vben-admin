import request from '@/utils/request'

export function getList(params?: any) {
  return request({
    url: '/system/userManagement/getList',
    method: 'get',
    params,
  })
}

export function searchUser(params?: any) {
  return request({
    url: '/system/userManagement/search',
    method: 'get',
    params,
  })
}

export function doEdit(data: any) {
  if(data.userId){
    return request({
      url: '/system/userManagement/doEdit',
      method: 'post',
      data,
    })   
  } else {
    return request({
      url: '/system/userManagement/add',
      method: 'post',
      data,
    })
  }
}

export function doDelete(data: any) {
  return request({
    url: '/system/userManagement/doDelete/'+data.userIds,
    method: 'get',
    data,
  })
}

export function getById(params: any) {
  if(params.userId==0){
    return request({
      url: '/system/userManagement/',
      method: 'get',
    })
  }else {
    return request({
      url: '/system/userManagement/'+params.userId,
      method: 'get',
    })
  }
}

export function resetPwd(data: any) {
  return request({
    url: '/system/userManagement/resetPwd',
    method: 'post',
    data,
  })
}

export function updatePassword(data: any) {
  return request({
    url: '/system/userManagement/updatePassword',
    method: 'post',
    data,
  })
}
