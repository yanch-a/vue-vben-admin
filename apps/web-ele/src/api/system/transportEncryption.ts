import { clearTransportEncryptionCache, requestClient } from '#/api/request';

/** 加密管理白名单响应；服务端不向页面返回私钥。 @author yanch */
export interface EncryptionSettings {
  enabled: boolean;
  keyReady: boolean;
  publicKey: null | string;
  keyId: null | string;
  algorithm: string;
  updatedAt: null | string;
}

const BASE = '/admin/secretKeyConfigManage';

/** 查看当前默认配置及公钥。 */
export function getEncryptionSettings() {
  return requestClient.get<EncryptionSettings>(`${BASE}/settings`);
}

/** 保存成功后清除当前页面日缓存，其他客户端仍按本地零点更新。 */
export async function setEncryptionEnabled(enabled: boolean) {
  const settings = await requestClient.post<EncryptionSettings>(
    `${BASE}/enabled`,
    { enabled },
  );
  clearTransportEncryptionCache();
  return settings;
}

/** 密钥在服务器生成并保存，响应只包含公钥及指纹。 */
export async function rotateEncryptionKey() {
  const settings = await requestClient.post<EncryptionSettings>(
    `${BASE}/rotateKey`,
    undefined,
    { timeout: 30_000 },
  );
  clearTransportEncryptionCache();
  return settings;
}
