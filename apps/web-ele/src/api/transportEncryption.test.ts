// @vitest-environment node
import type { RequestResponse } from '@vben/request';

import { webcrypto } from 'node:crypto';

import { RequestClient, defaultResponseInterceptor } from '@vben/request';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  installTransportEncryption,
  invalidateTransportEncryptionCache,
} from './transportEncryption';

const cryptoApi = webcrypto as unknown as Crypto;
let rsa: CryptoKeyPair;
let publicKey: string;

/** 使用独立的服务端解包逻辑验证真实 Axios 拦截顺序和标准 Web Crypto 报文。 @author yanch */
beforeAll(async () => {
  rsa = await cryptoApi.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  publicKey = Buffer.from(
    await cryptoApi.subtle.exportKey('spki', rsa.publicKey),
  ).toString('base64');
});

beforeEach(() => {
  vi.stubGlobal('crypto', cryptoApi);
  vi.stubGlobal('localStorage', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 持久化测试使用独立存储，避免不同测试共用同一个接口地址的缓存。 */
function mockStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

/** 模拟 Java 端解包临时密钥，AES-GCM 密文格式与 Java 测试使用的协议一致。 */
async function unwrap(wrapped: string) {
  const bytes = await cryptoApi.subtle.decrypt(
    'RSA-OAEP',
    rsa.privateKey,
    Buffer.from(wrapped, 'base64'),
  );
  return cryptoApi.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function readCipher(value: string, key: CryptoKey) {
  const [iv, body] = value.split('.');
  const result = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv!, 'base64') },
    key,
    Buffer.from(body!, 'base64'),
  );
  return new TextDecoder().decode(result);
}

async function writeCipher(value: unknown, key: CryptoKey) {
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const result = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${Buffer.from(iv).toString('base64')}.${Buffer.from(result).toString('base64')}`;
}

/** 只有协商客户端可明文读取设置；业务客户端响应随后走现有解包拦截器。 */
function setup(enabled = true) {
  const client = new RequestClient({ baseURL: '/lmdb' });
  const keyClient = new RequestClient({ baseURL: '/lmdb' });
  const negotiate = vi.fn(async (config: RequestResponse['config']) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { code: 200, data: { enabled, publicKey, version: '2' } },
  }));
  keyClient.instance.defaults.adapter = negotiate;
  installTransportEncryption(client, keyClient);
  return { client, keyClient, negotiate };
}

describe('transport encryption', () => {
  it('keeps the switch cached until local midnight or explicit invalidation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 59));
    const { client, keyClient } = setup();
    let enabled = false;
    keyClient.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled, publicKey, version: '2', keyId: 'current-key' },
      },
    });
    const states: boolean[] = [];
    client.instance.defaults.adapter = async (config) => {
      const encrypted = config.headers['X-Lemon-Key'] !== undefined;
      states.push(encrypted);
      if (!encrypted)
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { code: 200 },
        };
      expect(config.headers['X-Lemon-Key-Id']).toBe('current-key');
      const key = await unwrap(String(config.headers['X-Lemon-Key']));
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'x-lemon-encryption': '2' },
        data: JSON.stringify(await writeCipher({ code: 200 }, key)),
      };
    };
    await client.get('/before');
    enabled = true;
    await client.get('/same-day');
    vi.setSystemTime(new Date(2026, 10, 12, 0, 0, 0));
    await client.get('/enabled');
    enabled = false;
    await client.get('/still-enabled');
    invalidateTransportEncryptionCache(keyClient);
    await client.get('/disabled');
    expect(states).toEqual([false, false, true, true, false]);
  });

  it('uses the newly negotiated RSA public key after rotation', async () => {
    const { client, keyClient } = setup();
    const nextRsa = await cryptoApi.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const nextPublicKey = Buffer.from(
      await cryptoApi.subtle.exportKey('spki', nextRsa.publicKey),
    ).toString('base64');
    let rotated = false;
    keyClient.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: {
          enabled: true,
          publicKey: rotated ? nextPublicKey : publicKey,
          version: '2',
          keyId: rotated ? 'new-key' : 'old-key',
        },
      },
    });
    client.instance.defaults.adapter = async (config) => {
      expect(config.headers['X-Lemon-Key-Id']).toBe(
        rotated ? 'new-key' : 'old-key',
      );
      const raw = await cryptoApi.subtle.decrypt(
        'RSA-OAEP',
        rotated ? nextRsa.privateKey : rsa.privateKey,
        Buffer.from(String(config.headers['X-Lemon-Key']), 'base64'),
      );
      const key = await cryptoApi.subtle.importKey(
        'raw',
        raw,
        'AES-GCM',
        false,
        ['encrypt'],
      );
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'x-lemon-encryption': '2' },
        data: JSON.stringify(await writeCipher({ code: 200 }, key)),
      };
    };
    await client.get('/before');
    rotated = true;
    invalidateTransportEncryptionCache(keyClient);
    await client.get('/after');
  });

  it('negotiates only once for sequential disabled requests on the same day', async () => {
    const { client, negotiate } = setup(false);
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {},
    });
    await client.get('/one');
    await client.get('/two');
    await client.get('/three');
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('persists public settings and reuses them after a page reload', async () => {
    const values = mockStorage();
    const first = setup();
    first.keyClient.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: {
          enabled: true,
          publicKey,
          version: '2',
          privateKey: 'must-not-persist',
          secretKey: 'must-not-persist',
        },
      },
    });
    first.client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await first.client.get('/before-reload');
    const stored = JSON.parse([...values.values()][0]!);
    expect(stored.settings.publicKey).toBe(publicKey);
    expect(stored.settings.enabled).toBe(true);
    expect(stored.settings).not.toHaveProperty('privateKey');
    expect(stored.settings).not.toHaveProperty('secretKey');
    const reloaded = setup();
    reloaded.client.instance.defaults.adapter =
      first.client.instance.defaults.adapter;
    await reloaded.client.get('/after-reload');
    expect(reloaded.negotiate).not.toHaveBeenCalled();
  });

  it('shares the daily cache across clients using the same negotiation client', async () => {
    const first = setup(false);
    first.client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    const second = new RequestClient({ baseURL: '/lmdb' });
    second.instance.defaults.adapter = first.client.instance.defaults.adapter;
    installTransportEncryption(second, first.keyClient);
    await Promise.all([first.client.get('/a'), second.get('/b')]);
    await second.get('/c');
    expect(first.negotiate).toHaveBeenCalledTimes(1);
  });

  it('stores the client local calendar date and refreshes corrupted storage', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 12, 0, 0, 1));
    const values = mockStorage();
    const first = setup(false);
    first.client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await first.client.get('/a');
    const [key, stored] = [...values.entries()][0]!;
    expect(JSON.parse(stored).date).toBe('2026-11-12');
    values.set(key, '{broken-json');
    const reloaded = setup(false);
    reloaded.client.instance.defaults.adapter =
      first.client.instance.defaults.adapter;
    await reloaded.client.get('/b');
    expect(reloaded.negotiate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get(key)!).date).toBe('2026-11-12');
  });

  it('does not restore an invalidated cache when an earlier negotiation completes late', async () => {
    const { client, keyClient } = setup(false);
    let release: (response: RequestResponse) => void = () => {
      throw new Error('Negotiation has not started');
    };
    let calls = 0;
    keyClient.instance.defaults.adapter = async (config) => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          release = resolve;
        });
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { code: 200, data: { enabled: true, publicKey, version: '2' } },
      };
    };
    const states: boolean[] = [];
    client.instance.defaults.adapter = async (config) => {
      states.push(config.headers['X-Lemon-Key'] !== undefined);
      return {
        config,
        status: 204,
        statusText: 'No Content',
        headers: {},
        data: '',
      };
    };
    const earlier = client.get('/earlier');
    await vi.waitFor(() => expect(calls).toBe(1));
    invalidateTransportEncryptionCache(keyClient);
    await client.get('/updated');
    release({
      config: {} as RequestResponse['config'],
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled: false, publicKey: null, version: '2' },
      },
    });
    await earlier;
    await client.get('/still-updated');
    expect(states).toEqual([true, false, true]);
    expect(calls).toBe(2);
  });

  it('does not share a previous-day pending negotiation across midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 59));
    const values = mockStorage();
    const { client, keyClient } = setup(false);
    let release: (response: RequestResponse) => void = () => {
      throw new Error('not started');
    };
    let calls = 0;
    keyClient.instance.defaults.adapter = async (config) => {
      if (++calls === 1)
        return new Promise<RequestResponse>((resolve) => {
          release = resolve;
        });
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { code: 200, data: { enabled: true, publicKey, version: '2' } },
      };
    };
    const states: boolean[] = [];
    client.instance.defaults.adapter = async (config) => {
      states.push(config.headers['X-Lemon-Key'] !== undefined);
      return {
        config,
        status: 204,
        statusText: 'No Content',
        headers: {},
        data: '',
      };
    };
    const yesterday = client.get('/yesterday');
    await vi.waitFor(() => expect(calls).toBe(1));
    vi.setSystemTime(new Date(2026, 10, 12, 0, 0, 0));
    const today = client.get('/today');
    await vi.waitFor(() => expect(calls).toBe(2));
    await today;
    release({
      config: {} as RequestResponse['config'],
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled: false, publicKey: null, version: '2' },
      },
    });
    await yesterday;
    await client.get('/later');
    expect(states).toEqual([true, false, true]);
    expect(JSON.parse([...values.values()][0]!).settings.enabled).toBe(true);
    expect(calls).toBe(2);
  });

  it('does not let a late old-key rejection clear the refreshed daily cache', async () => {
    const { client, negotiate } = setup();
    const rejections: Array<() => void> = [];
    client.instance.defaults.adapter = async (config) =>
      new Promise((_, reject) => {
        rejections.push(() =>
          reject({
            config,
            response: {
              config,
              status: 409,
              headers: {},
              data: { code: 409, encryptionConfigChanged: true },
            },
          }),
        );
      });
    const first = client.get('/first').catch((error) => error);
    const second = client.get('/second').catch((error) => error);
    await vi.waitFor(() => expect(rejections).toHaveLength(2));
    rejections[0]!();
    await first;
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await client.get('/refreshed');
    rejections[1]!();
    await second;
    await client.get('/still-cached');
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it('lets a canceled caller stop waiting without canceling shared negotiation', async () => {
    const { client, keyClient } = setup(false);
    let release: (response: RequestResponse) => void = () => {
      throw new Error('not started');
    };
    const negotiate = vi.fn(
      async (config: RequestResponse['config']) =>
        new Promise<RequestResponse>((resolve) => {
          release = (response) => resolve({ ...response, config });
        }),
    );
    keyClient.instance.defaults.adapter = negotiate;
    const send = vi.fn(async (config: RequestResponse['config']) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    }));
    client.instance.defaults.adapter = send;
    const controller = new AbortController();
    const canceled = client
      .get('/canceled', { signal: controller.signal })
      .catch((error) => error);
    const surviving = client.get('/surviving');
    await vi.waitFor(() => expect(negotiate).toHaveBeenCalledTimes(1));
    controller.abort();
    expect((await canceled).code).toBe('ERR_CANCELED');
    expect(send).not.toHaveBeenCalled();
    release({
      config: {} as RequestResponse['config'],
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled: false, publicKey: null, version: '2' },
      },
    });
    await surviving;
    await client.get('/cached');
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('applies the caller timeout while waiting and keeps shared negotiation alive', async () => {
    const { client, keyClient } = setup(false);
    let release: (response: RequestResponse) => void = () => {
      throw new Error('not started');
    };
    const negotiate = vi.fn(
      async (config: RequestResponse['config']) =>
        new Promise<RequestResponse>((resolve) => {
          release = (response) => resolve({ ...response, config });
        }),
    );
    keyClient.instance.defaults.adapter = negotiate;
    const send = vi.fn(async (config: RequestResponse['config']) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    }));
    client.instance.defaults.adapter = send;
    const timedOut = client
      .get('/short', { timeout: 20 })
      .catch((error) => error);
    const surviving = client.get('/long', { timeout: 10_000 });
    expect((await timedOut).code).toBe('ECONNABORTED');
    expect(send).not.toHaveBeenCalled();
    release({
      config: {} as RequestResponse['config'],
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled: false, publicKey: null, version: '2' },
      },
    });
    await surviving;
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].timeout).toBeLessThan(10_000);
  });

  it('does not negotiate for a request whose signal was already canceled', async () => {
    const { client, negotiate } = setup(false);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.get('/canceled', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(negotiate).not.toHaveBeenCalled();
  });

  it('refreshes once for concurrent requests at local midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 59));
    const { client, negotiate } = setup(false);
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {},
    });
    await client.get('/before');
    vi.setSystemTime(new Date(2026, 10, 12, 0, 0, 0));
    await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    await client.get('/later');
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it('does not use yesterday settings when the midnight refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 59));
    const { client, keyClient, negotiate } = setup(false);
    const send = vi.fn(async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {},
    }));
    client.instance.defaults.adapter = send;
    await client.get('/before');
    vi.setSystemTime(new Date(2026, 10, 12, 0, 0, 0));
    keyClient.instance.defaults.adapter = vi
      .fn()
      .mockRejectedValue(new Error('offline'));
    await expect(client.get('/after')).rejects.toThrow('offline');
    expect(send).toHaveBeenCalledTimes(1);
    keyClient.instance.defaults.adapter = negotiate;
    await client.get('/retry');
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it('isolates persisted settings by API address', async () => {
    const values = mockStorage();
    const first = setup(false);
    first.client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await first.client.get('/a');
    const keyClient = new RequestClient({ baseURL: '/other-api' });
    const negotiate = vi.fn(async (config: RequestResponse['config']) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        code: 200,
        data: { enabled: false, publicKey: null, version: '2' },
      },
    }));
    keyClient.instance.defaults.adapter = negotiate;
    const second = new RequestClient({ baseURL: '/other-api' });
    second.instance.defaults.adapter = first.client.instance.defaults.adapter;
    installTransportEncryption(second, keyClient);
    await second.get('/b');
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(values.size).toBe(2);
  });

  it('uses memory caching when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    const { client, negotiate } = setup(false);
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await client.get('/a');
    await client.get('/b');
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a confirmed stale-key rejection without replaying the business request', async () => {
    const { client, negotiate } = setup();
    const send = vi.fn(async (config: RequestResponse['config']) => {
      throw {
        config,
        response: {
          config,
          status: 409,
          headers: {},
          data: { code: 409, encryptionConfigChanged: true },
        },
      };
    });
    client.instance.defaults.adapter = send;
    await expect(client.get('/stale')).rejects.toMatchObject({
      response: { status: 409 },
    });
    expect(send).toHaveBeenCalledTimes(1);
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await client.get('/retry');
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it('encrypts JSON and serialized queries, then decrypts before business unwrapping', async () => {
    const { client, negotiate } = setup();
    const body = { name: '中文🍋', values: [1, 2] };
    client.instance.defaults.adapter = async (config) => {
      expect(config.headers['X-Lemon-Encryption']).toBe('2');
      const key = await unwrap(String(config.headers['X-Lemon-Key']));
      expect(
        JSON.parse(await readCipher(JSON.parse(config.data), key)),
      ).toEqual(body);
      const query = await readCipher(config.params.__lemon_params, key);
      const params = new URLSearchParams(query);
      expect(params.get('name')).toBe('中文+ &');
      expect(params.getAll('ids')).toEqual(['1', '2']);
      expect(config.url).toBe('/echo');
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'x-lemon-encryption': '2' },
        data: JSON.stringify(await writeCipher({ code: 200, data: body }, key)),
      };
    };
    client.addResponseInterceptor(
      defaultResponseInterceptor({
        codeField: 'code',
        dataField: 'data',
        successCode: 200,
      }),
    );
    expect(
      await client.post('/echo?name=%E4%B8%AD%E6%96%87%2B%20%26', body, {
        params: { ids: [1, 2] },
        paramsSerializer: 'repeat',
        responseReturn: 'data',
      }),
    ).toEqual(body);
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('shares negotiation but isolates concurrent request keys', async () => {
    const { client, negotiate } = setup();
    const keys = new Set<string>();
    client.instance.defaults.adapter = async (config) => {
      const wrapped = String(config.headers['X-Lemon-Key']);
      keys.add(wrapped);
      const key = await unwrap(wrapped);
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'x-lemon-encryption': '2' },
        data: JSON.stringify(await writeCipher({ url: config.url }, key)),
      };
    };
    const results = await Promise.all([
      client.get<RequestResponse>('/a'),
      client.get<RequestResponse>('/b'),
    ]);
    expect(results.map((result) => result.data.url)).toEqual(['/a', '/b']);
    expect(keys.size).toBe(2);
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('keeps files, forms, downloads, streams and explicit exclusions out of negotiation', async () => {
    const { client, negotiate } = setup();
    client.instance.defaults.adapter = async (config) => {
      expect(config.headers['X-Lemon-Key']).toBeUndefined();
      return { config, status: 200, statusText: 'OK', headers: {}, data: {} };
    };
    const form = new FormData();
    form.append('name', 'file');
    await client.post('/upload', form);
    await client.post('/binary', new Uint8Array([1, 2]));
    await client.post('/form', new URLSearchParams({ code: '123' }));
    await client.get('/download', { responseType: 'blob' });
    await client.post(
      '/sse',
      { prompt: 'hi' },
      { headers: { Accept: 'text/event-stream' } },
    );
    await client.get('/system/config/getList');
    await client.get('/plain', { skipEncryption: true });
    expect(negotiate).not.toHaveBeenCalled();
  });

  it('passes plaintext only when the server explicitly disables encryption', async () => {
    const { client } = setup(false);
    client.instance.defaults.adapter = async (config) => {
      expect(config.headers['X-Lemon-Key']).toBeUndefined();
      expect(config.data).toBe('{"name":"中文"}');
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { code: 200 },
      };
    };
    await client.post('/echo', { name: '中文' });
  });

  it('does not downgrade on failed negotiation and retries negotiation on the next request', async () => {
    const { client, keyClient, negotiate } = setup();
    const send = vi.fn();
    client.instance.defaults.adapter = send;
    keyClient.instance.defaults.adapter = vi
      .fn()
      .mockRejectedValue(new Error('offline'));
    await expect(client.get('/a')).rejects.toThrow('offline');
    expect(send).not.toHaveBeenCalled();
    keyClient.instance.defaults.adapter = negotiate;
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
    });
    await client.get('/b');
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('decrypts HTTP failures before forwarding them to error handlers', async () => {
    const { client } = setup();
    client.instance.defaults.adapter = async (config) => {
      const key = await unwrap(String(config.headers['X-Lemon-Key']));
      throw {
        config,
        response: {
          config,
          status: 401,
          headers: { 'x-lemon-encryption': '2' },
          data: await writeCipher({ code: 401, msg: '登录过期' }, key),
        },
      };
    };
    await expect(client.get('/private')).rejects.toMatchObject({
      response: { data: { code: 401, msg: '登录过期' } },
    });
  });

  it('rejects tampering and unexpected plaintext responses', async () => {
    const { client } = setup();
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: { 'x-lemon-encryption': '2' },
      data: 'AAAAAAAAAAAAAAAA.AAAA',
    });
    await expect(client.get('/tampered')).rejects.toThrow('响应解密失败');
    client.instance.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { code: 200 },
    });
    await expect(client.get('/downgrade')).rejects.toThrow(
      '服务端未返回加密响应',
    );
  });

  it('retries a request without encrypting its ciphertext a second time', async () => {
    const { client } = setup();
    let original: string | undefined;
    client.instance.defaults.adapter = async (config) => {
      original ??= config.data;
      expect(config.data).toBe(original);
      const key = await unwrap(String(config.headers['X-Lemon-Key']));
      expect(
        JSON.parse(await readCipher(JSON.parse(config.data), key)),
      ).toEqual({ count: 1 });
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'x-lemon-encryption': '2' },
        data: JSON.stringify(await writeCipher({ code: 200 }, key)),
      };
    };
    const first = await client.post<RequestResponse>('/retry', { count: 1 });
    await client.request('/retry', first.config);
  });
});
