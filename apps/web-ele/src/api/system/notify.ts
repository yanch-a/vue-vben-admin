/**
 * 消息通知渠道 API（企微 / 钉钉 / 飞书）。
 *
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';
import type { NotifyChannelRow } from '#/api/visual/etl';

const url = `${adminUrl}/notify/`;

export interface NotifyChannelSave {
  id?: number | string;
  channelType: 'WECOM' | 'DINGTALK' | 'FEISHU';
  channelName: string;
  enabled: boolean;
  webhookUrl: string;
  /** 安全关键词；空字符串表示清空 */
  keyword?: string;
  /** 明文密钥；空表示不修改已存密钥 */
  secretInput?: string;
  /** 清空已存加签密钥 */
  clearSecret?: boolean;
}

export function listNotifyChannels() {
  return request({ url: `${url}channels`, method: 'get' });
}

export function saveNotifyChannel(data: NotifyChannelSave) {
  return request({ url: `${url}channels`, method: 'post', data });
}

export function deleteNotifyChannel(id: string | number) {
  return request({
    url: `${url}channels/${encodeURIComponent(id)}`,
    method: 'delete',
  });
}

export function testNotifyChannel(id: string | number) {
  return request({
    url: `${url}channels/${encodeURIComponent(id)}/test`,
    method: 'post',
    data: {},
  });
}

export function sendNotifyMessage(data: {
  title?: string;
  content: string;
  channelIds?: Array<string | number>;
}) {
  return request({ url: `${url}send`, method: 'post', data });
}

export type { NotifyChannelRow };
