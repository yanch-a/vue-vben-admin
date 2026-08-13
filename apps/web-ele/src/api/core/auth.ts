import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  export interface LoginParams {
    password?: string;
    username?: string;
    code?: string;
    uuid?: string;
  }

  export interface LoginResult {
    accessToken: string;
    token?: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

function toAccessToken(data: AuthApi.LoginResult | null | undefined) {
  const token = data?.accessToken || data?.token;
  if (!token) {
    throw new Error('登录失败：未返回 token');
  }
  return { accessToken: token };
}

/** 管理员登录 */
export async function loginApi(data: AuthApi.LoginParams) {
  const result = await requestClient.post<AuthApi.LoginResult>('/login', data);
  return toAccessToken(result);
}

/** 会员密码登录 */
export async function memberLoginApi(data: AuthApi.LoginParams) {
  const result = await requestClient.post<AuthApi.LoginResult>(
    '/member/login',
    data,
  );
  return toAccessToken(result);
}

/**
 * 刷新 accessToken（lemon 无此接口，保留兼容）
 */
export async function refreshTokenApi() {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>('/auth/refresh', {
    withCredentials: true,
  });
}

/** 管理员退出 */
export async function logoutApi() {
  return requestClient.get('/logout');
}

/** 会员退出 */
export async function memberLogoutApi() {
  return requestClient.get('/member/logout');
}

/**
 * 获取用户权限码 —— 由 getUserInfo 的 permissions 提供，此处仅占位
 */
export async function getAccessCodesApi() {
  return [] as string[];
}
