/** 兼容 admin-plus 的配置导出 */

/** 后台 API 前缀（context-path） */
export const adminUrl = '/admin';
export const baseURL = import.meta.env.VITE_GLOB_API_URL || '/lmdb';

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
  return /^\/?(logo|login-bg|favicon)(\.[a-z0-9]+)?$/i.test(String(url || '').trim());
}
