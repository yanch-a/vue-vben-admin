import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

export namespace LemonUserApi {
  export interface RawUserInfo {
    username?: string;
    avatar?: string;
    roles?: string[];
    permissions?: string[];
    device?: string;
    user?: {
      avatar?: string;
      deptId?: number;
      loginUserType?: string;
      nickName?: string;
      userId?: number | string;
      userName?: string;
    };
  }
}

/**
 * 获取用户信息（lemon: GET /userInfo）
 */
export async function getUserInfoApi() {
  const raw = await requestClient.get<LemonUserApi.RawUserInfo>('/userInfo');
  const user = raw.user || {};
  const userInfo: UserInfo & {
    loginUserType?: string;
    permissions?: string[];
  } = {
    userId: String(user.userId ?? ''),
    username: raw.username || user.userName || '',
    realName: user.nickName || raw.username || user.userName || '',
    avatar: raw.avatar || user.avatar || '',
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
