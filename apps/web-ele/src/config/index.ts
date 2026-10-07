/** 兼容 admin-plus 的配置导出 */

/** 后台 API 前缀（context-path） */
export const adminUrl = '/admin';
export const baseURL = import.meta.env.VITE_GLOB_API_URL || '/lmdb';

/**
 * 把后台返回的附件相对路径转换成当前服务端可访问的资源地址。
 * Web 端拼接后台 context-path，Electron 端则继续通过固定的 /lmdb 代理
 * 转发到用户当前选择的服务端，避免头像请求落到前端页面自身地址。
 *
 * @author yanch
 */
export function resolveBackendAssetUrl(url?: null | string): string {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  // 浏览器解析 URL 时会忽略空白/控制字符，判断协议前先去掉，防止 `java\tscript:` 绕过。
  const compact = trimmed.replaceAll(/[\u0000-\u0020\u007F]+/g, '');
  if (/^https?:\/\//i.test(compact) || /^blob:/i.test(compact)) {
    return trimmed;
  }
  // data: 只放行图片，避免 data:text/html 之类被当作资源地址使用。
  if (/^data:/i.test(compact)) {
    return /^data:image\/[\w.+-]+[;,]/i.test(compact) ? compact : '';
  }
  // 其它协议（javascript:/vbscript:/file: 等）一律丢弃。
  if (/^[a-z][\d+.a-z-]*:/i.test(compact)) return '';

  // 同时去掉开头的反斜杠：浏览器会把 `/\\evil.com` 当成协议相对地址 `//evil.com`。
  const normalizedPath = `/${trimmed.replace(/^[/\\]+/, '')}`;
  const prefix = String(baseURL || '').replace(/\/+$/, '');
  if (!prefix || prefix === '/') return normalizedPath;

  // 相对 API 前缀已经存在时不重复拼接，例如 /lmdb/attachment/a.jpg。
  if (
    prefix.startsWith('/') &&
    (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))
  ) {
    return normalizedPath;
  }
  return `${prefix}${normalizedPath}`;
}

/**
 * 前端 public 目录静态资源（logo / 登录背景等）。
 * 必须走 Vite BASE_URL（生产为 /lmdb/view/），不能写死站点根路径 /xxx。
 */
export function publicAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const clean = String(path || '')
    .trim()
    .replace(/^\//, '');
  if (!clean) {
    return base.endsWith('/') ? base : `${base}/`;
  }
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${clean}`;
}

/** 是否为前端 public 目录下的品牌静态资源 */
export function isPublicBrandAsset(url: string): boolean {
  return /^\/?(logo|login-bg|favicon)(\.[a-z0-9]+)?$/i.test(
    String(url || '').trim(),
  );
}
