import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';
import { resolveBackendAssetUrl } from '#/config';

import { getPersonalProfileApi } from './profile';

export namespace LemonUserApi {
  export interface RawUserInfo {
    username?: string;
    avatar?: string;
    roles?: string[];
    permissions?: string[];
    device?: string;
    user?: {
      avatar?: string;
      email?: string;
      deptId?: number;
      loginUserType?: string;
      nickName?: string;
      personalSignature?: string;
      userId?: number | string;
      userName?: string;
    };
  }
}

/**
 * 获取用户信息（lemon: GET /userInfo）
 */
export async function getUserInfoApi() {
  const [raw, profile] = await Promise.all([
    requestClient.get<LemonUserApi.RawUserInfo>('/userInfo'),
    getPersonalProfileApi(),
  ]);
  const user = raw.user || {};
  const userInfo: UserInfo & {
    loginUserType?: string;
    permissions?: string[];
  } = {
    userId: String(profile.userId ?? profile.id ?? user.userId ?? ''),
    username: profile.userName || raw.username || user.userName || '',
    realName:
      profile.nickName ||
      profile.realName ||
      user.nickName ||
      raw.username ||
      user.userName ||
      '',
    avatar: resolveBackendAssetUrl(
      profile.avatar || raw.avatar || user.avatar || '',
    ),
    email: profile.email || user.email || '',
    phoneNumber: profile.phoneNumber || profile.phonenumber || '',
    personalSignature:
      profile.personalSignature ||
      profile.remark ||
      user.personalSignature ||
      '',
    roles: raw.roles || [],
    desc: '',
    homePath: '',
    token: '',
    loginUserType: user.loginUserType || 'ADMIN',
    permissions: raw.permissions || [],
  };
  return userInfo;
}

/** 从用户信息中提取权限码 */
export function extractAccessCodes(
  userInfo: Awaited<ReturnType<typeof getUserInfoApi>>,
) {
  const permissions = userInfo.permissions || [];
  if (permissions.includes('*') || permissions.includes('*:*:*')) {
    return ['*'];
  }
  return permissions;
}
