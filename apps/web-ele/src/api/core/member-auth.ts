import { requestClient } from '#/api/request';

export namespace MemberAuthApi {
  export interface SmsLoginParams {
    phoneNumber: string;
    code: string;
  }

  export interface ForgotResetParams {
    phoneNumber: string;
    code: string;
    newPassword: string;
  }

  export interface RegisterParams {
    username: string;
    phonenumber: string;
    smsCode: string;
    password: string;
    inviteCode?: string;
    realName?: string;
    email?: string;
    registerSource?: 'PC_CLIENT' | 'WEB';
  }

  export interface RegisterResult {
    memberUserId?: number;
    inviteCode?: string;
    hasGift?: boolean;
    giftApiCount?: number;
    message?: string;
  }

  export interface WxScanQrcodeResult {
    state: string;
    appId: string;
    redirectUri: string;
    qrConnectUrl?: string;
    expireSeconds?: number;
  }

  export interface WxScanPollResult {
    status: 'error' | 'expired' | 'success' | 'waiting' | string;
    token?: string;
    message?: string;
  }

  export interface PrivacyPolicy {
    id?: number;
    title?: string;
    content?: string;
    version?: string;
    policyType?: string;
  }
}

/** 发送登录短信验证码 */
export function sendLoginCodeApi(phoneNumber: string) {
  return requestClient.post('/member/sendLoginCode', null, {
    params: { phoneNumber },
  });
}

/** 手机验证码登录 */
export async function loginByPhoneApi(data: MemberAuthApi.SmsLoginParams) {
  const result = await requestClient.post<{ token: string }>(
    '/member/loginByPhone',
    null,
    { params: data },
  );
  return { accessToken: result.token };
}

/** 发送找回密码短信验证码 */
export function sendForgotPasswordCodeApi(phoneNumber: string) {
  return requestClient.post('/member/forgot/sendCode', null, {
    params: { phoneNumber },
  });
}

/** 短信验证码重置密码 */
export function resetPasswordBySmsApi(data: MemberAuthApi.ForgotResetParams) {
  return requestClient.post('/member/forgot/resetPassword', null, {
    params: data,
  });
}

/** 创建微信 PC 扫码登录会话 */
export function createWxScanQrcodeApi() {
  return requestClient.get<MemberAuthApi.WxScanQrcodeResult>(
    '/member/wxScan/qrcode',
  );
}

/** 轮询微信扫码登录状态 */
export function pollWxScanStatusApi(state: string) {
  return requestClient.get<MemberAuthApi.WxScanPollResult>(
    '/member/wxScan/poll',
    { params: { state } },
  );
}

/** 发送注册短信验证码 */
export function sendRegisterCodeApi(phoneNumber: string) {
  return requestClient.post('/admin/member/register/sendCode', null, {
    params: { phoneNumber },
  });
}

/** 会员注册 */
export function registerMemberUserApi(data: MemberAuthApi.RegisterParams) {
  return requestClient.post<MemberAuthApi.RegisterResult>(
    '/admin/member/register',
    {
      registerSource: 'WEB',
      ...data,
    },
  );
}

/** 检查用户名是否可用 */
export function checkUsernameApi(username: string) {
  return requestClient.get<boolean>(`/admin/member/checkUsername/${username}`);
}

/** 检查手机号是否可用 */
export function checkPhoneApi(phone: string) {
  return requestClient.get<boolean>(`/admin/member/checkPhone/${phone}`);
}

/** 获取隐私政策 */
export function getPolicyByTypeApi(policyType: string) {
  return requestClient.get<MemberAuthApi.PrivacyPolicy>(
    `/member/privacy/get/${policyType}`,
  );
}
