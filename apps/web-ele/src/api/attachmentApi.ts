import { adminUrl } from '@/config'
import request from '@/utils/request'

const urlPre = adminUrl + '/attachmentManage/'

export function getAttachments(params: any) {
  if (params.ids) {
    return request({
      url: '/attachment/getAttachment',
      method: 'get',
      params,
    })
  }
}

export function getByBelongIds(params: any) {
  if (params.ids) {
    return request({
      url: '/attachment/getByBelongIds',
      method: 'get',
      params,
    })
  }
}

export function getPage(params: any) {
  return request({
    url: urlPre + 'getPage',
    method: 'get',
    params,
  })
}

export function getList(params: any) {
  return request({
    url: urlPre + 'getList',
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
