import { adminUrl } from '#/config';
import request from '#/utils/request';

const urlPre = adminUrl + '/lmcms/cmsModelManage/'

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
  if(params.id){
    return request({
      url: urlPre + params.id,
      method: 'get',
    })
  }
}

export function doEdit(data: any) {
  if(data.id){
    return request({
      url: urlPre + 'doEdit',
      method: 'post',
      data,
    })
  }else {
    return request({
      url: urlPre + 'add',
      method: 'post',
      data,
    })  
  }
}

export function doDelete(data: any) {
  return request({
    url: urlPre + 'del/'+data.ids,
    method: 'get',
    data,
  })
}

export function doUpdateStatus(data: any) {
  return request({
    url: urlPre + 'doUpdateStatus',
    method: 'post',
    data,
  })
}

// 模型项查询
export function getModelItem(params: any) {
  return request({
    url: urlPre + 'getModelItem',
    method: 'get',
    params,
  })
}

// 根据栏目id查模型项
export function getModelItemByChannelId(params: any) {
  return request({
    url: urlPre + 'getModelItemByChannelId',
    method: 'get',
    params,
  })
}

export function saveModelItem(data: any) {
  return request({
      url: urlPre + 'updateModelItem',
      method: 'post',
      data,
    })
}