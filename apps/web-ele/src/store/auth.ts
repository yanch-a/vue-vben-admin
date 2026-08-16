import type { Recordable } from '@vben/types';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { ElNotification } from 'element-plus';
import { defineStore } from 'pinia';

import {
  extractAccessCodes,
  getUserInfoApi,
  loginApi,
  logoutApi,
  memberLoginApi,
  memberLogoutApi,
} from '#/api';
import { $t } from '#/locales';

export type LoginUserType = 'ADMIN' | 'MEMBER';

const LOGIN_USER_TYPE_KEY = 'lemon_login_user_type';

function readLoginUserType(): LoginUserType {
  try {
    const v = localStorage.getItem(LOGIN_USER_TYPE_KEY);
    return v === 'MEMBER' ? 'MEMBER' : 'ADMIN';
  } catch {
    return 'ADMIN';
  }
}

function saveLoginUserType(type: LoginUserType) {
  try {
    localStorage.setItem(LOGIN_USER_TYPE_KEY, type);
  } catch {
    // ignore
  }
}

export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);
  const loginUserType = ref<LoginUserType>(readLoginUserType());

  async function afterLogin(
    accessToken: string,
    type: LoginUserType,
    onSuccess?: () => Promise<void> | void,
  ) {
    accessStore.setAccessToken(accessToken);
    loginUserType.value = type;
    saveLoginUserType(type);

    const userInfo = await fetchUserInfo();
    userStore.setUserInfo(userInfo);
    accessStore.setAccessCodes(extractAccessCodes(userInfo as any));

    if (accessStore.loginExpired) {
      accessStore.setLoginExpired(false);
    } else {
      // 先进入 defaultHomePath，由 access 守卫生成菜单后改写为角色第一个菜单
      onSuccess
        ? await onSuccess?.()
        : await router.push(
            userInfo.homePath || preferences.app.defaultHomePath,
          );
    }

    if (userInfo?.realName) {
      ElNotification({
        message: `${$t('authentication.loginSuccessDesc')}:${userInfo?.realName}`,
        title: $t('authentication.loginSuccess'),
        type: 'success',
      });
    }

    return { userInfo };
  }

  /**
   * 管理员登录
   */
  async function authLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
  ) {
    try {
      loginLoading.value = true;
      const { accessToken } = await loginApi(params);
      return await afterLogin(accessToken, 'ADMIN', onSuccess);
    } finally {
      loginLoading.value = false;
    }
  }

  /**
   * 会员密码登录
   */
  async function memberLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
  ) {
    try {
      loginLoading.value = true;
      const { accessToken } = await memberLoginApi(params);
      return await afterLogin(accessToken, 'MEMBER', onSuccess);
    } finally {
      loginLoading.value = false;
    }
  }

  /**
   * 短信 / 微信等已拿到 token 后的统一入口
   */
  async function loginWithToken(
    accessToken: string,
    type: LoginUserType = 'MEMBER',
    onSuccess?: () => Promise<void> | void,
  ) {
    try {
      loginLoading.value = true;
      return await afterLogin(accessToken, type, onSuccess);
    } finally {
      loginLoading.value = false;
    }
  }

  async function clearAuthState() {
    loginUserType.value = 'ADMIN';
    saveLoginUserType('ADMIN');
    resetAllStores();
    accessStore.setLoginExpired(false);
  }

  async function logout(redirect: boolean = true) {
    const type = loginUserType.value;
    try {
      // 仍持有 token 时先通知后端；失败（含无效 token）忽略
      if (accessStore.accessToken) {
        if (type === 'MEMBER') {
          await memberLogoutApi();
        } else {
          await logoutApi();
        }
      }
    } catch {
      // ignore
    }

    await clearAuthState();

    await router.replace({
      path: LOGIN_PATH,
      query: redirect
        ? {
            redirect: encodeURIComponent(router.currentRoute.value.fullPath),
          }
        : {},
    });
  }

  async function fetchUserInfo() {
    const userInfo = await getUserInfoApi();
    if ((userInfo as any).loginUserType) {
      loginUserType.value = (userInfo as any).loginUserType as LoginUserType;
      saveLoginUserType(loginUserType.value);
    }
    userStore.setUserInfo(userInfo);
    return userInfo;
  }

  function $reset() {
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    afterLogin,
    fetchUserInfo,
    loginLoading,
    loginUserType,
    loginWithToken,
    logout,
    clearAuthState,
    memberLogin,
  };
});
