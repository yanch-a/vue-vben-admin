import { adminUrl } from '#/config';
import request from '#/utils/request';

const urlPre = adminUrl + '/lmcms/cmsGlobalConfigManage/'

export function getOne() {
  return request({
    url: urlPre + 'getOne',
    method: 'get',
  })
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

