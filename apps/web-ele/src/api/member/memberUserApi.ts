import { adminUrl } from '@/config'
import request from '@/utils/request'

const urlPre = adminUrl + '/member/memberUserManage/'

export function getPage(params: any) {
  return request({
    url: urlPre + 'getPage',
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

/**
 * 检查用户名是否可用（true=可用）
 * @author yanch
 */
export function checkUsername(username: string) {
  return request({
    url: `${adminUrl}/member/checkUsername/${encodeURIComponent(username)}`,
    method: 'get',
  })
}

