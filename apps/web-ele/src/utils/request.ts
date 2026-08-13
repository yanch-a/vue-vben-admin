import { requestClient } from '#/api/request';

/**
 * 兼容 admin-plus 的 request({ url, method, params, data }) 写法。
 * 返回形态对齐旧前端：{ code, msg, data }
 */
export default async function request(config: {
  data?: any;
  headers?: Record<string, any>;
  method?: string;
  params?: any;
  responseType?: any;
  url: string;
}) {
  const method = (config.method || 'get').toLowerCase();
  const options: Record<string, any> = {
    responseReturn: 'body',
  };
  if (config.params) options.params = config.params;
  if (config.responseType) options.responseType = config.responseType;
  if (config.headers) options.headers = config.headers;

  let body: any;
  if (method === 'get' || method === 'delete') {
    body = await requestClient.request(config.url, {
      method,
      ...options,
    });
  } else {
    body = await requestClient.request(config.url, {
      method,
      data: config.data,
      ...options,
    });
  }

  // 已是标准 body
  if (body && typeof body === 'object' && 'code' in body) {
    return body;
  }
  return { code: 200, msg: 'ok', data: body };
}
