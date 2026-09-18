import { requestClient } from '#/api/request';
import { readBlobErrorMessage } from '#/utils/blobDownload';

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
  responseReturn?: 'body' | 'raw';
  /** 定时轮询、自动保存等后台请求可关闭全局错误弹窗。 */
  showErrorMessage?: boolean;
  signal?: AbortSignal;
  timeout?: number;
  url: string;
}) {
  const method = (config.method || 'get').toLowerCase();
  const options: Record<string, any> = {
    responseReturn: config.responseReturn || 'body',
  };
  if (config.showErrorMessage != null) {
    options.showErrorMessage = config.showErrorMessage;
  }
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

  // 文件下载：直接返回 Blob；若实为业务失败 JSON（常见 HTTP 200），拒绝并抛出 msg
  // @author yanch
  if (config.responseType === 'blob') {
    if (body instanceof Blob) {
      const errMsg = await readBlobErrorMessage(body);
      if (errMsg) {
        return Promise.reject(
          Object.assign(new Error(errMsg), { msg: errMsg, code: 500 }),
        );
      }
    }
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
