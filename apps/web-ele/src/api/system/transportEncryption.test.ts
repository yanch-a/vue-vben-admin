import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('#/api/request', () => ({
  requestClient: { get: mocks.get, post: mocks.post },
  clearTransportEncryptionCache: mocks.clear,
}));

import {
  getEncryptionSettings,
  rotateEncryptionKey,
  setEncryptionEnabled,
} from './transportEncryption';

/** 管理接口成功后才清除日缓存，失败不能伪造本地新配置。 @author yanch */
describe('encryption management cache invalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.post.mockResolvedValue({ enabled: true });
  });

  it('clears the daily cache after saving the switch', async () => {
    await expect(setEncryptionEnabled(true)).resolves.toEqual({
      enabled: true,
    });
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it('clears the daily cache after rotating the key', async () => {
    await rotateEncryptionKey();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache when a management write fails', async () => {
    mocks.post.mockRejectedValue(new Error('denied'));
    await expect(setEncryptionEnabled(true)).rejects.toThrow('denied');
    await expect(rotateEncryptionKey()).rejects.toThrow('denied');
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('does not refresh transport settings just for viewing the management page', async () => {
    await getEncryptionSettings();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
