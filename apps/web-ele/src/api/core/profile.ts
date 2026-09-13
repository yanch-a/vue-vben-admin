import { requestClient } from '#/api/request';
import { resolveBackendAssetUrl } from '#/config';

/** 当前登录用户的统一个人资料。 */
export interface PersonalProfile {
  avatar?: string;
  email?: string;
  id?: number | string;
  nickName?: string;
  personalSignature?: string;
  phoneNumber?: string;
  phonenumber?: string;
  realName?: string;
  remark?: string;
  sex?: number | string;
  userId?: number | string;
  userName: string;
}

/** 头像上传结果，url 是 UploadController 提供的实际访问地址。 */
export interface AvatarUploadResult {
  savePath?: string;
  url?: string;
}

/** 获取当前管理员或会员的最新个人资料。 */
export async function getPersonalProfileApi() {
  const profile = await requestClient.get<PersonalProfile>(
    '/admin/member/personal/info',
  );
  return {
    ...profile,
    avatar: resolveBackendAssetUrl(profile.avatar),
  };
}

/** 更新当前管理员或会员的基本资料。 */
export function updatePersonalProfileApi(data: {
  email?: string;
  phoneNumber?: string;
  realName?: string;
  remark?: string;
  sex?: number;
  userName: string;
}) {
  return requestClient.post('/admin/member/personal/updateInfo', data);
}

/** 使用旧密码修改当前账号密码。 */
export function changePersonalPasswordApi(data: {
  newPassword: string;
  password: string;
}) {
  return requestClient.post('/admin/member/personal/changePassword', {
    ...data,
    reNewPassword: data.newPassword,
  });
}

/** 上传头像并由服务端同步到当前账号。 */
export async function uploadPersonalAvatarApi(file: File) {
  // 必须使用文件上传封装显式发送 multipart/form-data；普通 post 会继承
  // application/json 默认请求头，导致 Spring 无法解析 MultipartFile。
  const result = await requestClient.upload<AvatarUploadResult>(
    '/admin/member/personal/uploadAvatar',
    { file },
  );
  return {
    ...result,
    savePath: resolveBackendAssetUrl(result?.savePath),
    url: resolveBackendAssetUrl(result?.url),
  };
}
