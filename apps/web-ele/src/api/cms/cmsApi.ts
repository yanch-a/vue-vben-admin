import { adminUrl } from '#/config';
import request from '#/utils/request';

const urlPre = adminUrl + '/lmcms/cmsApi/'

/**
 * 获取内容分页
 * @param params 
 * @returns 
 */
export function getContentPage(params: any) {
  return request({
    url: urlPre + 'getContentPage',
    method: 'get',
    params,
  })
}

export function getContentList(params: any) {
  return request({
    url: urlPre + 'getContentList',
    method: 'get',
    params,
  })
}

export function getContentById(contentId: any) {
  if(contentId){
    return request({
      url: urlPre + 'content/' + contentId,
      method: 'get',
    })
  }
}

/**
 * 获取频道树
 * @param params 
 * @returns 
 */
export function getChannelsWithExtByParentId(parentId: any) {
  return request({
    url: urlPre + 'getChannelsWithExtByParentId/' + parentId,
    method: 'get',
  })
}

export function getChannelById(channelId: any) {
  if(channelId){
    return request({
      url: urlPre + 'channel/' + channelId,
      method: 'get',
    })
  }
}

export function addContent(data: any) {
  return request({
    url: urlPre + 'addContent',
    method: 'post',
    data,
  })
}