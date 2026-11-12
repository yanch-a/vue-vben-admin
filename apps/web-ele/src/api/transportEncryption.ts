import type {
  InternalAxiosRequestConfig,
  RequestClient,
  RequestClientConfig,
  RequestResponse,
} from '@vben/request';
import { AxiosError, CanceledError } from '@vben/request';

/** v2 仅交换临时 AES 密钥，浏览器中不保存固定私钥。 @author yanch */
const VERSION_HEADER = 'X-Lemon-Encryption';
const KEY_HEADER = 'X-Lemon-Key';
const KEY_ID_HEADER = 'X-Lemon-Key-Id';
const VERSION = '2';

/** 公钥协商只返回开关、版本和服务端公钥。 */
interface TransportSettings {
  enabled: boolean;
  publicKey: null | string;
  keyId?: null | string;
  version: string;
}

/** 仅持久化公开配置和客户端本地日期，不保存临时 AES 密钥。 */
interface DailyTransportSettings {
  date: string;
  settings: TransportSettings;
}

/** 已导入的公钥在内存中复用。 */
interface PreparedTransportSettings {
  enabled: boolean;
  revision: number;
  keyId?: string;
  publicKey?: CryptoKey;
}

/** 两个业务客户端共享同一个协商客户端时，共享日缓存与在途更新。 */
interface TransportCacheState {
  cached?: { date: string; value: PreparedTransportSettings };
  pending?: { date: string; promise: Promise<PreparedTransportSettings> };
  revision: number;
}

const settingsCaches = new WeakMap<RequestClient, TransportCacheState>();

/** 使用客户端本地日历日判断零点，避免 UTC 日期和固定 24 小时造成偏差。 */
function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** 同源下不同 API 地址分开缓存，避免连接不同服务时复用错误公钥。 */
function storageKey(keyClient: RequestClient): string {
  return `lemon:transport-encryption:v2:${keyClient.instance.getUri({ url: '/publicKey/transport' })}`;
}

/** 校验公开配置，损坏的本地缓存不能被当作“关闭加密”。 */
function validSettings(value: unknown): value is TransportSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<TransportSettings>;
  return (
    typeof settings.enabled === 'boolean' &&
    settings.version === VERSION &&
    (settings.publicKey === null || typeof settings.publicKey === 'string') &&
    (!settings.enabled || !!settings.publicKey?.trim()) &&
    (settings.keyId == null || typeof settings.keyId === 'string')
  );
}

/** 仅接受当天缓存；浏览器禁用存储时仍可使用内存日缓存。 */
function readDailySettings(
  key: string,
  today: string,
): DailyTransportSettings | undefined {
  try {
    const cached = JSON.parse(
      globalThis.localStorage?.getItem(key) ?? 'null',
    ) as DailyTransportSettings | null;
    if (cached?.date === today && validSettings(cached.settings)) return cached;
  } catch {
    // 读取失败或 JSON 损坏时重新协商，不降级成明文。
  }
  return undefined;
}

/** 管理操作或服务端确认旧公钥失效时清除缓存；旧的在途协商不能覆盖更新后的配置。 @author yanch */
export function invalidateTransportEncryptionCache(
  keyClient: RequestClient,
): void {
  const state = settingsCaches.get(keyClient);
  if (state) {
    state.cached = undefined;
    state.pending = undefined;
    state.revision++;
  }
  try {
    globalThis.localStorage?.removeItem(storageKey(keyClient));
  } catch {
    // 存储不可用时，内存缓存已失效。
  }
}

/** 每次请求携带独立解密上下文，以支持并发和 Axios 重试。 */
type TransportConfig = RequestClientConfig & {
  /** Axios 重试沿用已加密报文和对应密钥，避免二次加密。 */
  __lemonTransport?: { key: CryptoKey; cacheRevision: number };
};

/** 调用方可独立取消或超时，共享协商继续供其他请求和当天缓存使用。 */
function waitForSettings(
  promise: Promise<PreparedTransportSettings>,
  config: InternalAxiosRequestConfig,
): Promise<PreparedTransportSettings> {
  if (config.signal?.aborted)
    return Promise.reject(new CanceledError('canceled', config));
  if (!config.signal && !config.timeout) return promise;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** 结束等待时清理监听，避免每次业务请求积累 AbortSignal 回调。 */
    const cleanup = () => {
      clearTimeout(timer);
      config.signal?.removeEventListener?.('abort', abort);
    };
    /** 只取消此调用方，不取消共享配置请求。 */
    const abort = () => {
      cleanup();
      reject(new CanceledError('canceled', config));
    };
    config.signal?.addEventListener?.('abort', abort);
    if (config.timeout && config.timeout > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(
          new AxiosError(
            `timeout of ${config.timeout}ms exceeded`,
            'ECONNABORTED',
            config,
          ),
        );
      }, config.timeout);
    }
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** 二进制按块编码，避免大 JSON/SQL 结果触发展开参数的调用栈限制。 */
function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** 将服务端标准 Base64/SPKI 公钥转换为 Web Crypto 可用的字节。 */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** 每段请求体、查询串及响应都生成独立 nonce；tag 由 Web Crypto 自动追加。 */
async function encrypt(content: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(content),
  );
  return `${toBase64(iv)}.${toBase64(encrypted)}`;
}

/** 先校验 GCM 标签，再交给业务拦截器解析，禁止失败后按明文继续处理。 */
async function decrypt(content: unknown, key: CryptoKey): Promise<unknown> {
  if (typeof content !== 'string') throw new Error('加密响应格式错误');
  // responseType:text 时 Axios 不会去掉 JSON 字符串外层引号。
  const value: string = content.startsWith('"') ? JSON.parse(content) : content;
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('加密响应格式错误');
  const iv = fromBase64(parts[0]!);
  if (iv.length !== 12) throw new Error('加密响应格式错误');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64(parts[1]!),
  );
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
}

/** 文件、流、表单及已有 NoEncrypt 的配置接口整次跳过，响应也不参与解密。 */
function shouldSkip(config: RequestClientConfig): boolean {
  const path = String(config.url ?? '')
    .split('?')[0]!
    .replace(/\/$/, '');
  const type = String(config.headers?.['Content-Type'] ?? '').toLowerCase();
  const accept = String(config.headers?.Accept ?? '').toLowerCase();
  const data = config.data;
  return (
    config.skipEncryption === true ||
    /\/publicKey(?:\/transport)?$/.test(path) ||
    /\/system\/config(?:\/|$)/.test(path) ||
    ['arraybuffer', 'blob', 'stream'].includes(config.responseType ?? '') ||
    accept.includes('text/event-stream') ||
    accept.includes('application/octet-stream') ||
    (type !== '' && !type.includes('json')) ||
    data instanceof FormData ||
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    data instanceof URLSearchParams ||
    (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream)
  );
}

/** 安装顺序：请求在业务发送前执行；响应解密必须位于鉴权和业务码拦截器之前。 @author yanch */
export function installTransportEncryption(
  client: RequestClient,
  keyClient: RequestClient,
): void {
  const state: TransportCacheState = settingsCaches.get(keyClient) ?? {
    revision: 0,
  };
  settingsCaches.set(keyClient, state);
  let importedKey: { source: string; key: CryptoKey } | undefined;

  /** 当天直接使用缓存；首次、跨过本地零点或主动失效后，才合并发起一次协商。 */
  function getSettings(): Promise<PreparedTransportSettings> {
    const today = localDate();
    if (state.cached?.date === today)
      return Promise.resolve(state.cached.value);
    if (state.pending?.date === today) return state.pending.promise;
    const key = storageKey(keyClient);
    const stored = readDailySettings(key, today);
    const revision = ++state.revision;
    const source = stored
      ? Promise.resolve(stored)
      : keyClient
          .get<RequestResponse<{ code: number; data: TransportSettings }>>(
            '/publicKey/transport',
            { responseReturn: 'raw' },
          )
          .then(({ data: result }): DailyTransportSettings => {
            if (result.code !== 200 || !validSettings(result.data))
              throw new Error('获取传输加密配置失败');
            // 明确选取公开字段，避免把接口未来新增的敏感字段写进本地缓存。
            return {
              // 以发起协商的日期归属缓存；零点前的迟到响应不能被记成次日配置。
              date: today,
              settings: {
                enabled: result.data.enabled,
                publicKey: result.data.publicKey,
                keyId: result.data.keyId,
                version: result.data.version,
              },
            };
          });
    const pending = source
      .then(async (entry) => {
        const settings = entry.settings;
        let value: PreparedTransportSettings = { enabled: false, revision };
        if (settings.enabled) {
          if (!globalThis.crypto?.subtle) {
            throw new Error('传输加密需要 HTTPS 或 localhost 安全环境');
          }
          const der = settings.publicKey!.replace(/-----[\w ]+-----|\s/g, '');
          if (importedKey?.source !== der) {
            importedKey = {
              source: der,
              key: await crypto.subtle.importKey(
                'spki',
                fromBase64(der),
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                false,
                ['encrypt'],
              ),
            };
          }
          value = {
            enabled: true,
            revision,
            keyId: settings.keyId ?? undefined,
            publicKey: importedKey.key,
          };
        }
        if (state.revision === revision && state.pending?.promise === pending) {
          state.cached = { date: entry.date, value };
          try {
            globalThis.localStorage?.setItem(key, JSON.stringify(entry));
          } catch {
            // 本地存储被禁用或已满时，仍保留当天内存缓存。
          }
        }
        return value;
      })
      .catch((error) => {
        if (state.revision === revision)
          invalidateTransportEncryptionCache(keyClient);
        throw error;
      })
      .finally(() => {
        if (state.pending?.promise === pending) state.pending = undefined;
      });
    state.pending = { date: today, promise: pending };
    return pending;
  }

  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const transport = config as typeof config & TransportConfig;
      if (transport.__lemonTransport) return config;
      if (shouldSkip(config)) {
        // 服务端在下载失败返回 JSON 时仍需识别此请求属于附件传输。
        if (
          ['arraybuffer', 'blob', 'stream'].includes(config.responseType ?? '')
        ) {
          config.headers.Accept =
            config.responseType === 'stream'
              ? 'text/event-stream'
              : 'application/octet-stream';
        }
        // FormData 必须在 Axios transformRequest 前纠正默认 JSON 类型。
        if (config.data instanceof FormData)
          config.headers['Content-Type'] = 'multipart/form-data';
        if (config.data instanceof URLSearchParams)
          config.headers['Content-Type'] =
            'application/x-www-form-urlencoded;charset=utf-8';
        return config;
      }
      if (config.signal?.aborted) throw new CanceledError('canceled', config);
      const startedAt = performance.now();
      const timeout = config.timeout ?? 0;
      /** 配置等待与加密时间计入本次请求预算，业务适配器仅使用剩余超时。 */
      const finish = () => {
        if (config.signal?.aborted) throw new CanceledError('canceled', config);
        if (timeout > 0) {
          const remaining = timeout - Math.ceil(performance.now() - startedAt);
          if (remaining <= 0)
            throw new AxiosError(
              `timeout of ${timeout}ms exceeded`,
              'ECONNABORTED',
              config,
            );
          config.timeout = remaining;
        }
        return config;
      };
      const settings = await waitForSettings(getSettings(), config);
      if (!settings.enabled) return finish();
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const key = await crypto.subtle.importKey(
        'raw',
        rawKey,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt'],
      );
      const wrapped = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        settings.publicKey!,
        rawKey,
      );

      // 复用 Axios 的实际序列化结果，保留重复参数、数组、日期及自定义 serializer 的语义。
      const uri = client.instance.getUri(config);
      const queryIndex = uri.indexOf('?');
      if (queryIndex >= 0) {
        const query = uri.slice(queryIndex + 1).split('#')[0]!;
        config.url = String(config.url).split('?')[0];
        config.params = { __lemon_params: await encrypt(query, key) };
        // 密文参数使用 Axios 默认编码，不能再次应用业务自定义 serializer。
        config.paramsSerializer = undefined;
      }
      if (config.data !== undefined && config.data !== null) {
        // JSON 字符串 body 已经序列化；对象/数组/标量按 JSON 标准编码。
        let body = JSON.stringify(config.data);
        if (typeof config.data === 'string') {
          // 对齐 Axios 的 JSON 字符串处理：合法 JSON 原样发送，普通字符串补 JSON 引号。
          try {
            JSON.parse(config.data);
            body = config.data;
          } catch {
            /* 使用 JSON.stringify 的结果。 */
          }
        }
        config.data = JSON.stringify(await encrypt(body, key));
        config.headers['Content-Type'] = 'application/json;charset=utf-8';
      }
      config.headers[VERSION_HEADER] = VERSION;
      config.headers[KEY_HEADER] = toBase64(wrapped);
      if (settings.keyId) config.headers[KEY_ID_HEADER] = settings.keyId;
      transport.__lemonTransport = { key, cacheRevision: settings.revision };
      return finish();
    },
  });

  /** HTTP 错误也必须先解密，后续 401 处理及错误提示才能读到真实业务消息。 */
  async function decodeResponse(response: RequestResponse) {
    const context = (response.config as TransportConfig).__lemonTransport;
    const version = response.headers[VERSION_HEADER.toLowerCase()];
    if (version !== undefined) {
      if (version !== VERSION || !context) throw new Error('无法识别加密响应');
      try {
        response.data = await decrypt(response.data, context.key);
      } catch {
        throw Object.assign(new Error('响应解密失败，请刷新后重试'), {
          response,
          config: response.config,
        });
      }
    } else if (
      context &&
      response.status < 400 &&
      response.data != null &&
      response.status !== 204
    ) {
      throw Object.assign(new Error('服务端未返回加密响应'), {
        response,
        config: response.config,
      });
    }
    return response;
  }

  client.addResponseInterceptor({
    fulfilled: decodeResponse,
    rejected: async (error) => {
      if (
        error?.response?.status === 409 &&
        error.response.data?.encryptionConfigChanged === true &&
        (error.response.config as TransportConfig)?.__lemonTransport
          ?.cacheRevision === state.revision
      ) {
        // 旧公钥已被服务端拒绝，清除日缓存供下一次显式重试使用，不重放当前业务请求。
        invalidateTransportEncryptionCache(keyClient);
      }
      if (error?.response) await decodeResponse(error.response);
      throw error;
    },
  });
}
