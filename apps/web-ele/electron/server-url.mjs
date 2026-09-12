/** Electron 内部用于识别 API 请求的固定虚拟路径。 */
export const RENDERER_API_PREFIX = '/lmdb';

/**
 * 校验并标准化用户输入的服务端 API 根地址。
 * 地址必须包含 http(s) 协议，并建议包含 Lemon 的 context-path（默认 /lmdb）。
 *
 * @author yanch
 */
export function normalizeServerUrl(rawUrl) {
  const value = String(rawUrl ?? '').trim();
  if (!value) {
    throw new Error('请输入服务端地址');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('服务端地址格式不正确，请输入完整的 http:// 或 https:// 地址');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('服务端地址仅支持 http:// 或 https:// 协议');
  }
  if (!parsed.hostname) {
    throw new Error('服务端地址缺少主机名');
  }
  if (parsed.username || parsed.password) {
    throw new Error('服务端地址不能包含用户名或密码');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('服务端地址不能包含查询参数或锚点');
  }

  // 保留可能存在的 context-path，仅去除尾部斜杠，方便后续安全拼接请求路径。
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

/**
 * 把渲染进程的 /lmdb 请求映射到用户选择的服务端 API 根地址。
 */
export function buildProxyTarget(serverUrl, rendererRequestUrl) {
  const requestUrl = new URL(rendererRequestUrl);
  const pathname = requestUrl.pathname;
  if (pathname !== RENDERER_API_PREFIX && !pathname.startsWith(`${RENDERER_API_PREFIX}/`)) {
    throw new Error(`不是可代理的 API 路径: ${pathname}`);
  }

  const suffix = pathname.slice(RENDERER_API_PREFIX.length);
  return `${normalizeServerUrl(serverUrl)}${suffix}${requestUrl.search}`;
}
