/**
 * 大屏分享 / 嵌入链接的纯函数工具（与 view.vue、ShareDialog.vue 共用，便于单测）。
 * @author yanch
 */

export const SHARE_ROUTE_PATH = '/visual/dashboard/share/';
export const SHARE_TOKEN_PATTERN = /^[\w-]{43}$/;

export type ShareTheme = '' | 'dark' | 'light';
export type ShareFit = 'contain' | 'cover' | 'stretch' | 'width';

export const SHARE_FIT_OPTIONS: Array<{ label: string; value: ShareFit }> = [
  { label: '等比完整显示', value: 'contain' },
  { label: '等比铺满（可能裁切）', value: 'cover' },
  { label: '拉伸铺满', value: 'stretch' },
  { label: '按宽度适配（可滚动）', value: 'width' },
];

export interface EmbedOptions {
  fit: ShareFit;
  /** false 时隐藏分享页顶部标题栏和底部状态条 */
  header: boolean;
  /** iframe 高度，数字按 px，也可写 100vh 之类 */
  height: string;
  /** null 跟随大屏配置；0 关闭；其余为秒数（10~86400） */
  refresh: null | number;
  theme: ShareTheme;
  width: string;
}

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  fit: 'contain',
  header: true,
  height: '600',
  refresh: null,
  theme: '',
  width: '100%',
};

/** 分享页路由前缀：hash 路由时为 `/lmdb/view/#`，history 路由（开发）时为空串。 */
export function appPrefixFromHref(href: string, token: string): string {
  const suffix = `${SHARE_ROUTE_PATH}${token}`;
  const index = href.lastIndexOf(suffix);
  return index >= 0 ? href.slice(0, index) : '';
}

/** 直接打开的分享链接。 */
export function buildShareUrl(origin: string, appPrefix: string, token: string): string {
  return `${trimSlash(origin)}${appPrefix}${SHARE_ROUTE_PATH}${token}`;
}

/** 后端默认的前端前缀（与 ShareEmbedPage.DEFAULT_APP_SUFFIX 一致）。 */
export function defaultAppPrefix(apiBase: string): string {
  return `${trimSlash(apiBase)}/view/#`;
}

/** 嵌入网关地址：后端按链接配置下发 CSP frame-ancestors，再在同源 iframe 里加载分享页。 */
export function buildEmbedUrl(input: {
  apiBase: string;
  appPrefix: string;
  options: EmbedOptions;
  origin: string;
  token: string;
}): string {
  const { apiBase, appPrefix, options, origin, token } = input;
  const params = new URLSearchParams();
  if (appPrefix !== defaultAppPrefix(apiBase)) params.set('app', appPrefix);
  if (options.theme) params.set('theme', options.theme);
  if (!options.header) params.set('header', '0');
  if (options.refresh != null) params.set('refresh', String(normalizeRefresh(options.refresh)));
  if (options.fit && options.fit !== 'contain') params.set('fit', options.fit);
  const query = params.toString();
  return `${trimSlash(origin)}${trimSlash(apiBase)}/admin/biShare/public/${token}/embed${query ? `?${query}` : ''}`;
}

/** iframe 嵌入代码。 */
export function buildEmbedCode(url: string, options: Pick<EmbedOptions, 'height' | 'width'>): string {
  const width = sizeAttr(options.width, '100%');
  const height = sizeAttr(options.height, '600');
  return `<iframe src="${escapeAttr(url)}" width="${escapeAttr(width)}" height="${escapeAttr(height)}" `
    + `style="border:0" allow="fullscreen" allowfullscreen loading="lazy" title="Dashboard"></iframe>`;
}

function sizeAttr(value: string, fallback: string): string {
  const text = String(value ?? '').trim();
  return /^\d{1,5}(?:px|%|vh|vw)?$/.test(text) ? text : fallback;
}

export function normalizeRefresh(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(86_400, Math.max(10, Math.round(seconds)));
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function trimSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

// ------------------------------------------------------------------ 允许嵌入的站点

const HOST_ENTRY =
  /^(?:https?:\/\/)?(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?(?:\/.*)?$/;

/** 拆分用户输入的站点列表（换行、逗号、分号、空白分隔），去重保序。 */
export function parseHostsText(text: string): string[] {
  const out: string[] = [];
  for (const part of String(text || '').split(/[\s,;]+/)) {
    const item = part.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** 与后端 ShareHostPolicy 一致的前端预校验；返回非法条目。 */
export function invalidHosts(hosts: string[]): string[] {
  return hosts.filter((raw) => {
    const item = raw.toLowerCase();
    if (!HOST_ENTRY.test(item)) return true;
    const body = item.replace(/^https?:\/\//, '');
    const wildcard = body.startsWith('*.');
    const [host = '', port] = (body.replace(/^\*\./, '').split('/')[0] ?? '').split(':');
    if (wildcard && !host.includes('.')) return true;
    return port !== undefined && (Number(port) < 1 || Number(port) > 65_535);
  });
}

// ------------------------------------------------------------------ 状态

export interface ShareStatusMeta {
  label: string;
  type: 'danger' | 'info' | 'success' | 'warning';
}

export function shareStatusMeta(status?: string): ShareStatusMeta {
  switch (status) {
    case 'ACTIVE':
      return { label: '生效中', type: 'success' };
    case 'DISABLED':
      return { label: '已停用', type: 'warning' };
    case 'EXPIRED':
      return { label: '已过期', type: 'info' };
    case 'REVOKED':
      return { label: '已撤销', type: 'danger' };
    default:
      return { label: '未知', type: 'info' };
  }
}

export interface ShareStateView {
  icon: 'error' | 'info' | 'warning';
  retryable: boolean;
  title: string;
}

/** 公开页的状态页文案（中文 key，模板里经 $tr 翻译）。 */
export function shareStateView(state?: string): ShareStateView {
  switch (state) {
    case 'NOT_FOUND':
      return { icon: 'error', retryable: false, title: '分享链接不存在或已失效' };
    case 'REVOKED':
      return { icon: 'error', retryable: false, title: '分享链接已被撤销' };
    case 'DISABLED':
      return { icon: 'warning', retryable: true, title: '分享链接已被停用' };
    case 'EXPIRED':
      return { icon: 'warning', retryable: false, title: '分享链接已过期' };
    case 'RATE_LIMITED':
      return { icon: 'warning', retryable: true, title: '访问过于频繁，请稍后再试' };
    case 'FEATURE_DISABLED':
      return { icon: 'info', retryable: false, title: '系统未开启大屏分享' };
    case 'EMBED_DENIED':
      return { icon: 'error', retryable: false, title: '该页面不允许以这种方式嵌入' };
    default:
      return { icon: 'error', retryable: true, title: '大屏暂时无法查看' };
  }
}

// ------------------------------------------------------------------ 分享页显示参数

export interface ShareDisplayOptions {
  embed: boolean;
  fit: ShareFit;
  header: boolean;
  theme: ShareTheme;
}

function first(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw == null ? '' : String(raw).trim().toLowerCase();
}

export function parseShareDisplayOptions(query: Record<string, unknown>): ShareDisplayOptions {
  const theme = first(query.theme);
  const fit = first(query.fit);
  return {
    embed: first(query.embed) === '1',
    fit: (['contain', 'cover', 'stretch', 'width'] as string[]).includes(fit) ? (fit as ShareFit) : 'contain',
    header: first(query.header) !== '0',
    theme: theme === 'dark' || theme === 'light' ? theme : '',
  };
}

export interface FitTransform {
  scaleX: number;
  scaleY: number;
  /** width 模式下画布顶对齐、容器可纵向滚动 */
  scroll: boolean;
}

export function computeFitTransform(
  fit: ShareFit,
  viewport: { height: number; width: number },
  canvas: { height: number; width: number },
): FitTransform {
  const cw = Math.max(1, Number(canvas.width) || 1);
  const ch = Math.max(1, Number(canvas.height) || 1);
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const sx = vw / cw;
  const sy = vh / ch;
  switch (fit) {
    case 'cover': {
      const s = Math.max(sx, sy);
      return { scaleX: s, scaleY: s, scroll: false };
    }
    case 'stretch':
      return { scaleX: sx, scaleY: sy, scroll: false };
    case 'width':
      return { scaleX: sx, scaleY: sx, scroll: true };
    default: {
      const s = Math.min(sx, sy);
      return { scaleX: s, scaleY: s, scroll: false };
    }
  }
}

/**
 * 嵌入校验：被 iframe 加载时，父页面必须是同源的后端嵌入网关
 * （…/biShare/public/{token}/embed，响应头带链接配置的 frame-ancestors）。
 * 外站直接 iframe 分享页（绕过网关）会因跨域读不到父页面地址而被拒绝。
 */
export function isEmbedParentAllowed(win: Window, token: string): boolean {
  let parent: Window;
  try {
    parent = win.parent;
    if (!parent || parent === win) return true;
  } catch {
    return false;
  }
  try {
    if (parent.location.origin !== win.location.origin) return false;
    return parent.location.pathname.endsWith(`/biShare/public/${token}/embed`);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ 密码访问凭证

const GRANT_PREFIX = 'lemon-share-grant:';

export interface GrantStore {
  getItem: (key: string) => null | string;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export function readGrant(store: GrantStore | null | undefined, token: string, now = Date.now()): string {
  if (!store) return '';
  try {
    const raw = store.getItem(GRANT_PREFIX + token);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { expiresAt?: number; grant?: string };
    if (!parsed.grant || !parsed.expiresAt || parsed.expiresAt <= now) {
      store.removeItem(GRANT_PREFIX + token);
      return '';
    }
    return parsed.grant;
  } catch {
    return '';
  }
}

export function saveGrant(store: GrantStore | null | undefined, token: string, grant: string, expiresAt: number) {
  if (!store || !grant) return;
  try {
    store.setItem(GRANT_PREFIX + token, JSON.stringify({ expiresAt, grant }));
  } catch {
    // 存储不可用（第三方 iframe 存储隔离等）时只在内存中使用
  }
}

export function clearGrant(store: GrantStore | null | undefined, token: string) {
  try {
    store?.removeItem(GRANT_PREFIX + token);
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------------ 过期时间

export type ExpiryPreset = '1d' | '7d' | '30d' | 'custom' | 'never';

export const EXPIRY_PRESETS: Array<{ label: string; value: ExpiryPreset }> = [
  { label: '永久有效', value: 'never' },
  { label: '1 天', value: '1d' },
  { label: '7 天', value: '7d' },
  { label: '30 天', value: '30d' },
  { label: '自定义', value: 'custom' },
];

export function expiryFromPreset(preset: ExpiryPreset, now: number, custom?: null | number): null | number {
  const day = 86_400_000;
  switch (preset) {
    case '1d':
      return now + day;
    case '7d':
      return now + 7 * day;
    case '30d':
      return now + 30 * day;
    case 'custom':
      return custom && custom > now ? custom : null;
    default:
      return null;
  }
}

export function formatDateTime(value?: null | number | string): string {
  if (value == null || value === '') return '—';
  const date = new Date(typeof value === 'number' ? value : String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
