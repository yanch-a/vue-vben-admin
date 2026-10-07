/**
 * 大屏分享链接 API：所有者管理（需登录 + BiScreen:share）与匿名访问（/admin/biShare/public，免登录）。
 * @author yanch
 */
import { adminUrl } from '#/config';
import request from '#/utils/request';

const shareUrl = `${adminUrl}/biScreen/share/`;
const publicUrl = `${adminUrl}/biShare/public/`;

export type ShareDataMode = 'LIVE' | 'SNAPSHOT';
export type ShareStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED';
export type ShareEffectiveStatus = ShareStatus | 'EXPIRED';

export interface ScreenShare {
  allowedHosts: string[];
  createTime?: null | number;
  dataMode: ShareDataMode;
  deniedCount: number;
  effectiveStatus: ShareEffectiveStatus;
  expireTime?: null | number;
  id: string;
  lastAccessTime?: null | number;
  name?: null | string;
  passwordProtected: boolean;
  revokeTime?: null | number;
  screenId: string;
  snapshotTime?: null | number;
  status: ShareStatus;
  token: string;
  viewCount: number;
}

export interface ScreenShareOptions {
  allowLive: boolean;
  enabled: boolean;
  liveRefusedReason?: null | string;
  maxPerScreen: number;
  published: boolean;
  screenRefreshMode?: string;
}

export interface ScreenShareSaveRequest {
  allowedHosts?: string[];
  clearPassword?: boolean;
  dataMode?: ShareDataMode;
  expireTime?: null | number;
  id?: string;
  name?: string;
  password?: string;
  screenId?: string;
}

export type PublicShareState =
  | 'DISABLED'
  | 'EXPIRED'
  | 'FEATURE_DISABLED'
  | 'NOT_FOUND'
  | 'OK'
  | 'PASSWORD_INVALID'
  | 'PASSWORD_REQUIRED'
  | 'RATE_LIMITED'
  | 'REVOKED'
  | 'UNAVAILABLE';

export interface PublicShareResult {
  grant?: string;
  grantExpiresAt?: number;
  message?: string;
  retryAfterSeconds?: number;
  screen?: any;
  share?: {
    dataMode?: ShareDataMode;
    expireTime?: null | number;
    name?: string;
    passwordProtected?: boolean;
  };
  state: PublicShareState;
}

export function listScreenShares(screenId: number | string) {
  return request({ url: `${shareUrl}list/${screenId}`, method: 'get' });
}

export function getScreenShareOptions(screenId: number | string) {
  return request({ url: `${shareUrl}options/${screenId}`, method: 'get' });
}

export function saveScreenShare(data: ScreenShareSaveRequest) {
  return request({ url: `${shareUrl}save`, method: 'post', data, timeout: 0 });
}

export function setScreenShareEnabled(id: string, enabled: boolean) {
  return request({ url: `${shareUrl}status/${id}`, method: 'post', data: { enabled } });
}

export function revokeScreenShare(id: string) {
  return request({ url: `${shareUrl}revoke/${id}`, method: 'post' });
}

export function refreshScreenShareSnapshot(id: string) {
  return request({ url: `${shareUrl}refreshSnapshot/${id}`, method: 'post', timeout: 0 });
}

/** 匿名加载分享大屏；状态码统一 200，结果看 state。 */
export function loadPublicShare(
  token: string,
  body: { grant?: string; password?: string; refresh?: boolean } = {},
) {
  return request({
    url: `${publicUrl}${encodeURIComponent(token)}`,
    method: 'post',
    data: body,
    showErrorMessage: false,
    timeout: 60_000,
  });
}
