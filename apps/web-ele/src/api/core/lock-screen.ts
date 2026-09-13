import { requestClient } from '#/api/request';

/**
 * 使用当前登录账号的密码校验锁屏解锁请求。
 *
 * 密码只随本次 HTTPS/API 请求发送，不写入 Pinia、localStorage 或 Electron 配置文件。
 *
 * @param password 用户输入的当前账号密码
 * @returns 后台校验成功时返回成功提示
 * @author yanch
 */
export function verifyLockScreenPasswordApi(password: string) {
  return requestClient.post<string>(
    '/admin/member/personal/verifyLockPassword',
    { password },
  );
}
