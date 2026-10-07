/**
 * 大屏图片 / 内嵌网页地址的安全策略。
 *
 * <ul>
 *   <li>网页组件只允许 http/https（以及后台附件相对路径），拦截 data:、javascript:、blob: 等协议；</li>
 *   <li>配置了域名白名单（后端 lemon.dashboard.iframe-allowed-hosts）时，外站地址必须命中白名单；</li>
 *   <li>iframe 一律带 sandbox：同源内容不给 allow-same-origin，避免读取本站 localStorage 中的登录 token；
 *       任何情况都不给 allow-top-navigation，防止内嵌页把整个大屏跳转到钓鱼页；</li>
 *   <li>图片组件允许 http/https、相对路径、blob: 与 data:image/*，其余协议直接丢弃。</li>
 * </ul>
 *
 * @author yanch
 */
import { resolveBackendAssetUrl } from '#/config';

export type DashboardMediaKind = 'iframe' | 'image';

export interface DashboardMediaPolicy {
  /**
   * 内嵌网页允许的域名，支持 `example.com`、`*.example.com`、`host:8080`。
   * 为空或缺省时允许任意 http/https 域名（仍然强制 sandbox）。
   */
  iframeAllowedHosts?: null | string[];
}

export interface ResolvedDashboardMedia {
  /** 可直接绑定到 src 的地址；被拦截时为空字符串 */
  src: string;
  /** 是否因策略被拦截 */
  blocked: boolean;
  /** 拦截原因（中文原文，展示时走 $tr） */
  reason: string;
  /** 是否与当前页面同源 */
  sameOrigin: boolean;
  /** iframe sandbox 属性值 */
  sandbox: string;
}

/** 外站内嵌页：允许脚本、自身同源存储、表单与新窗口，不允许跳转顶层窗口。 */
export const IFRAME_SANDBOX_CROSS_ORIGIN =
  'allow-scripts allow-same-origin allow-forms allow-popups';
/** 本站内容（如上传的附件）：只给脚本，落到不透明源，读不到本站 token。 */
export const IFRAME_SANDBOX_SAME_ORIGIN = 'allow-scripts';

const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml|x-icon)[;,]/i;
const SCHEME_RE = /^([a-z][\d+.a-z-]*):/i;

const EMPTY: ResolvedDashboardMedia = {
  src: '',
  blocked: false,
  reason: '',
  sameOrigin: false,
  sandbox: IFRAME_SANDBOX_SAME_ORIGIN,
};

function blocked(reason: string): ResolvedDashboardMedia {
  return { ...EMPTY, blocked: true, reason };
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

/** 去掉浏览器解析 URL 时会忽略的空白与控制字符，防止 `java\tscript:` 之类绕过。 */
function compactForScheme(value: string): string {
  return value.replaceAll(/[\u0000-\u0020\u007F]+/g, '');
}

/** 规范化白名单条目：去协议、路径、首尾点与空白，统一小写。 */
export function normalizeAllowedHosts(hosts?: null | string[]): string[] {
  if (!Array.isArray(hosts)) return [];
  const result: string[] = [];
  for (const raw of hosts) {
    let host = String(raw ?? '').trim().toLowerCase();
    if (!host) continue;
    host = host.replace(/^[a-z][\d+.a-z-]*:\/\//, '').replace(/\/.*$/, '');
    host = host.replace(/^\.+|\.+$/g, '');
    if (host) result.push(host);
  }
  return result;
}

/**
 * 判断 URL 的主机是否命中白名单。
 * `*` 放行全部；`*.example.com` 匹配任意子域（不含 example.com 本身）；
 * 条目带端口时按 host:port 精确比较。
 */
export function isHostAllowed(url: URL, allowedHosts?: null | string[]): boolean {
  const list = normalizeAllowedHosts(allowedHosts);
  if (list.length === 0) return true;
  const hostname = url.hostname.toLowerCase();
  const hostWithPort = url.host.toLowerCase();
  return list.some((pattern) => {
    if (pattern === '*') return true;
    const target = pattern.includes(':') ? hostWithPort : hostname;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) && target.length > suffix.length;
    }
    return target === pattern;
  });
}

/**
 * 按组件类型解析并校验媒体地址。
 *
 * @param raw 组件配置里的 mediaUrl（或历史数据里的 textContent）
 * @param kind image / iframe
 * @param policy 后端下发的白名单策略
 * @param origin 当前页面 origin，测试时可注入
 */
export function resolveDashboardMediaUrl(
  raw: null | string | undefined,
  kind: DashboardMediaKind,
  policy?: DashboardMediaPolicy | null,
  origin: string = currentOrigin(),
): ResolvedDashboardMedia {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { ...EMPTY };
  const compact = compactForScheme(trimmed);
  const scheme = SCHEME_RE.exec(compact)?.[1]?.toLowerCase();

  if (kind === 'image') {
    if (scheme === 'data') {
      return SAFE_DATA_IMAGE_RE.test(compact)
        ? { ...EMPTY, src: compact }
        : blocked('仅支持 data:image 格式的内联图片');
    }
    if (scheme === 'blob') return { ...EMPTY, src: trimmed, sameOrigin: true };
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      return blocked('图片地址仅支持 http/https 或上传后的相对路径');
    }
    const src = scheme ? trimmed : resolveBackendAssetUrl(trimmed);
    return src ? { ...EMPTY, src } : blocked('图片地址无效');
  }

  // iframe
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    return blocked('网页地址仅支持 http/https，已拦截 data:/javascript: 等协议');
  }
  let absolute: URL;
  let src: string;
  // 相对路径来自本系统上传的附件（可能经后端地址解析成另一个源），不受外站白名单约束
  let systemAsset = false;
  try {
    if (scheme) {
      src = trimmed;
      absolute = new URL(trimmed);
    } else if (/^[/\\]{2}/.test(compact)) {
      // 协议相对地址（含浏览器会当成 // 的反斜杠写法）指向外站，按外站规则校验
      absolute = new URL(trimmed, origin);
      src = absolute.toString();
    } else {
      src = resolveBackendAssetUrl(trimmed);
      if (!src) return blocked('网页地址无效');
      absolute = new URL(src, origin);
      systemAsset = true;
    }
  } catch {
    return blocked('网页地址无效');
  }
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
    return blocked('网页地址仅支持 http/https，已拦截 data:/javascript: 等协议');
  }
  const sameOrigin = absolute.origin === origin;
  if (!sameOrigin && !systemAsset && !isHostAllowed(absolute, policy?.iframeAllowedHosts)) {
    return blocked('该网页域名不在管理员配置的白名单内');
  }
  return {
    src,
    blocked: false,
    reason: '',
    sameOrigin,
    sandbox: sameOrigin ? IFRAME_SANDBOX_SAME_ORIGIN : IFRAME_SANDBOX_CROSS_ORIGIN,
  };
}

/**
 * 生成 CSS background-image 用的 url(...)，转义引号、反斜杠与换行，
 * 防止地址里夹带 `")` 跳出 url() 注入其它样式。
 */
export function toCssUrl(src: string): string {
  if (!src) return '';
  const escaped = src.replaceAll(/["\\\n\r\f]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
  return `url("${escaped}")`;
}
