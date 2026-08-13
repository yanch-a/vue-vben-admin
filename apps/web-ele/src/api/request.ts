/**
 * 该文件可自行根据业务逻辑进行调整
 */
import type { RequestClientOptions } from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';

import { ElMessage } from 'element-plus';

import { useAuthStore } from '#/store';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** lemon 业务未登录码（HTTP 仍可能是 200） */
const AUTH_FAIL_CODES = new Set([401, '401']);

/** Sa-Token / 全局异常常见未登录文案 */
const AUTH_FAIL_MSG_RE =
  /token\s*无效|未能读取到有效token|未登录|登录失效|登录过期|token\s*已过期|invalid\s*token|not\s*login/i;

let isReAuthenticating = false;

function isAuthFailurePayload(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (AUTH_FAIL_CODES.has(data.code)) {
    return true;
  }
  // NotLoginException 经 GlobalExceptionHandler 常变成 code=500 + token 文案
  const msg = String(data.msg ?? data.message ?? '');
  return AUTH_FAIL_MSG_RE.test(msg);
}

function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
  });

  /**
   * 重新认证逻辑（防重入；用 location.replace 跳出可能卡住的导航）
   */
  async function doReAuthenticate() {
    if (isReAuthenticating) {
      return;
    }
    isReAuthenticating = true;
    console.warn('Access token or refresh token is invalid or expired. ');
    try {
      const accessStore = useAccessStore();
      const authStore = useAuthStore();
      const wasAccessChecked = accessStore.isAccessChecked;

      accessStore.setAccessToken(null);
      accessStore.setIsAccessChecked(false);

      if (
        preferences.app.loginExpiredMode === 'modal' &&
        wasAccessChecked
      ) {
        await authStore.clearAuthState();
        accessStore.setLoginExpired(true);
        return;
      }

      await authStore.clearAuthState();

      const fullPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (!fullPath.includes('/auth/login')) {
        window.location.replace(
          `/auth/login?redirect=${encodeURIComponent(fullPath)}`,
        );
      }
    } finally {
      isReAuthenticating = false;
    }
  }

  /**
   * 刷新token逻辑（lemon 无 refresh，保留占位）
   */
  async function doRefreshToken() {
    const accessStore = useAccessStore();
    const resp = await refreshTokenApi();
    const newToken = resp.data;
    accessStore.setAccessToken(newToken);
    return newToken;
  }

  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  // 请求头处理：lemon Sa-Token 认 lmtoken，同时兼容 Authorization Bearer
  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const accessStore = useAccessStore();
      const token = accessStore.accessToken;
      config.headers.Authorization = formatToken(token);
      if (token) {
        config.headers.lmtoken = token;
      }
      config.headers['Accept-Language'] = preferences.app.locale;
      return config;
    },
  });

  // 必须在 default 之前：识别 lemon 未登录（业务码 401 或 token 无效文案）
  client.addResponseInterceptor({
    fulfilled: async (response) => {
      const data = response?.data;
      if (isAuthFailurePayload(data)) {
        const url = String(response?.config?.url || '');
        // 退出接口本身的失败不再二次触发登出
        if (!url.includes('/logout')) {
          await doReAuthenticate();
        }
        return Promise.reject(
          Object.assign(new Error(data?.msg || '登录已失效，请重新登录'), {
            response,
            __isAuthError: true,
          }),
        );
      }
      return response;
    },
  });

  // lemon 成功码为 200；兼容 R<data> 与 TableDataInfo{list,total}
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: (responseData: any) => {
        if (
          responseData &&
          Object.prototype.hasOwnProperty.call(responseData, 'data')
        ) {
          return responseData.data;
        }
        if (
          responseData &&
          (Array.isArray(responseData.list) ||
            Array.isArray(responseData.rows) ||
            typeof responseData.total !== 'undefined')
        ) {
          return {
            list: responseData.list ?? responseData.rows ?? [],
            total: responseData.total ?? 0,
          };
        }
        return responseData;
      },
      successCode: 200,
    }),
  );

  // token过期的处理（HTTP 401）
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken: preferences.app.enableRefreshToken,
      formatToken,
    }),
  );

  // 通用的错误处理（鉴权失败不重复弹窗）
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg: string, error) => {
      if (error?.__isAuthError || isReAuthenticating) {
        return;
      }
      const responseData = error?.response?.data ?? {};
      if (isAuthFailurePayload(responseData)) {
        return;
      }
      const errorMessage =
        responseData?.msg ??
        responseData?.error ??
        responseData?.message ??
        '';
      ElMessage.error(errorMessage || msg);
    }),
  );

  return client;
}

export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

export const baseRequestClient = new RequestClient({ baseURL: apiURL });
