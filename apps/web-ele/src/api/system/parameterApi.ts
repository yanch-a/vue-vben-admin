import request from '@/utils/request'

const urlPre = '/system/parameterManage/'

export function getPage(params: any) {
  return request({
    url: urlPre + 'getPage',
    method: 'get',
    params,
  })
}

export function getById(params: any) {
  if (params.id) {
    return request({
      url: urlPre + params.id,
      method: 'get',
    })
  }
}

export function doEdit(data: any) {
  if (data.id) {
    return request({
      url: urlPre + 'doEdit',
      method: 'post',
      data,
    })
  }
  return request({
    url: urlPre + 'add',
    method: 'post',
    data,
  })
}

export function doDelete(data: any) {
  return request({
    url: urlPre + 'del/' + data.ids,
    method: 'get',
    data,
  })
}

export function updateByCode(data: any) {
  if (data) {
    return request({
      url: urlPre + 'updateByCode',
      method: 'post',
      data,
    })
  }
}
