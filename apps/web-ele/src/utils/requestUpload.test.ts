import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('#/api/request', () => ({
  requestClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock('#/utils/humanizeApiError', () => ({
  humanizeApiError: (msg: string) => msg,
}));

vi.mock('#/utils/blobDownload', () => ({
  readBlobErrorMessage: async () => '',
}));

import request from './request';

/** 备份导入、SQL 上传都走 FormData，必须避免被默认 JSON 头序列化。 @author yanch */
describe('request FormData content type', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ code: 200, data: { taskId: '1' } });
  });

  it('keeps FormData and marks the request as multipart', async () => {
    const form = new FormData();
    form.append('dbConfigId', '12');
    form.append('instanceName', 'demo');
    await request({
      url: '/admin/databaseTool/import',
      method: 'post',
      data: form,
    });
    const config = requestMock.mock.calls[0][1];
    expect(config.data).toBe(form);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
  });

  it('does not add a content type for ordinary JSON bodies', async () => {
    await request({
      url: '/admin/databaseTool/test',
      method: 'post',
      data: { dbType: 'MYSQL' },
    });
    const config = requestMock.mock.calls[0][1];
    expect(config.headers).toBeUndefined();
    expect(config.data).toEqual({ dbType: 'MYSQL' });
  });
});
