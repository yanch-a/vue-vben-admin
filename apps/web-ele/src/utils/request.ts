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
  signal?: AbortSignal;
  timeout?: number;
  url: string;
}) {
  const method = (config.method || 'get').toLowerCase();
  const options: Record<string, any> = {
    responseReturn: 'body',
  };
  if (config.params) options.params = config.params;
  if (config.responseType) options.responseType = config.responseType;
  if (config.headers) options.headers = config.headers;
  if (config.signal) options.signal = config.signal;
  if (config.timeout != null) options.timeout = config.timeout;

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

  // 文件流（xlsx / sql 等）直接返回 Blob，切勿包成 { code, data }，
  // 否则调用方 new Blob([包装对象]) 会得到伪文件，Excel 报「扩展名或格式错误」。
  // @author yanch
  if (config.responseType === 'blob') {
    return body;
  }

  // 已是标准 body。responseReturn:'body' 时拦截器不校验业务码，这里补校验，
  // 否则 code=-1 会被当成成功，调用方拿不到错误信息（结果区空白）。
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: number | string }).code;
    if (code !== 200 && code !== 0 && code !== '200' && code !== '0') {
      const msg =
        (body as { msg?: string; message?: string }).msg ||
        (body as { message?: string }).message ||
        '请求失败';
      return Promise.reject(
        Object.assign(new Error(msg), {
          msg,
          code,
          data: (body as { data?: unknown }).data,
        }),
      );
    }
    return body;
  }
  return { code: 200, msg: 'ok', data: body };
}
