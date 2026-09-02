/**
 * Lemon 品牌/登录展示配置
 * 本地默认 + 后台 sys_setting(ui.brand.*) 覆盖
 *
 * @author yanch
 */

import { reactive, readonly } from 'vue';

import { updatePreferences } from '@vben/preferences';

import { baseURL, isPublicBrandAsset, publicAssetUrl } from '#/config';

/** 后台配置编码 */
export const BRAND_CONFIG_KEYS = {
  accountMark: 'ui.brand.accountMark',
  appTitle: 'ui.brand.appTitle',
  browserTitle: 'ui.brand.browserTitle',
  logo: 'ui.brand.logo',
  loginBg: 'ui.brand.loginBg',
  welcome: 'ui.brand.welcome',
  pageTitle: 'ui.brand.pageTitle',
  pageDesc: 'ui.brand.pageDesc',
  icp: 'ui.brand.icp',
  icpLink: 'ui.brand.icpLink',
  companyName: 'ui.brand.companyName',
} as const;

export interface BrandingState {
  /** 登录页左上角账号/品牌标识 */
  accountMark: string;
  /** 菜单左侧短标题 */
  appTitle: string;
  /** 浏览器标签标题 */
  browserTitle: string;
  /** Logo 地址 */
  logo: string;
  /** 登录背景图 */
  loginBg: string;
  /** 登录表单欢迎语 */
  welcome: string;
  /** 登录页侧栏主标题 */
  pageTitle: string;
  /** 登录页侧栏描述 */
  pageDesc: string;
  /** 备案号 */
  icp: string;
  /** 备案链接 */
  icpLink: string;
  /** 版权公司名 */
  companyName: string;
  /** 是否已尝试拉取远程配置 */
  loaded: boolean;
}

/**
 * 前端内置默认值（未改后台或后台为空时使用）
 * 布局默认「双列菜单」在 preferences.ts 中设置，不放这里。
 */
const DEFAULT_BRANDING: Omit<BrandingState, 'loaded'> = {
  accountMark: 'lemonDbClient',
  appTitle: 'lemonDbClient',
  browserTitle: 'lemonDbClient',
  logo: publicAssetUrl('logo.png'),
  loginBg: publicAssetUrl('login-bg.png'),
  welcome: '欢迎登录 lemonDbClient',
  pageTitle: 'lemonDbClient',
  pageDesc: '可视化数据库客户端',
  icp: '',
  icpLink: 'https://beian.miit.gov.cn/',
  companyName: 'lemonDbClient',
};

const state = reactive<BrandingState>({
  ...DEFAULT_BRANDING,
  loaded: false,
});

/**
 * 把相对路径补成可访问 URL；已是 http(s)/data/blob 则原样返回。
 * public 品牌图走 Vite BASE_URL；其它相对路径拼后台 API 前缀。
 */
export function resolveAssetUrl(url?: null | string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  // 兼容后台仍返回 /logo.png、/login-bg.png
  if (isPublicBrandAsset(trimmed)) {
    return publicAssetUrl(trimmed);
  }
  const viteBase = import.meta.env.BASE_URL || '/';
  if (viteBase !== '/' && trimmed.startsWith(viteBase)) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  const prefix = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  return `${prefix}/${trimmed.replace(/^\//, '')}`;
}

function pick(
  map: Record<string, string>,
  key: string,
  fallback: string,
): string {
  const raw = map[key];
  if (raw == null) return fallback;
  const value = String(raw).trim();
  // 空串表示「保持默认」，不覆盖
  return value === '' ? fallback : value;
}

/**
 * 将品牌配置同步到 Vben preferences（侧栏标题、Logo、版权等）
 */
export function syncBrandingToPreferences() {
  updatePreferences({
    app: {
      name: state.appTitle,
    },
    logo: {
      source: resolveAssetUrl(state.logo) || state.logo,
      enable: true,
      showText: true,
    },
    copyright: {
      companyName: state.companyName,
      icp: state.icp,
      icpLink: state.icpLink || DEFAULT_BRANDING.icpLink,
      enable: true,
    },
  });
}

/**
 * 应用后台返回的 configCode -> value 映射
 */
export function applyBrandConfigMap(map?: null | Record<string, string>) {
  const data = map || {};
  state.accountMark = pick(
    data,
    BRAND_CONFIG_KEYS.accountMark,
    DEFAULT_BRANDING.accountMark,
  );
  state.appTitle = pick(
    data,
    BRAND_CONFIG_KEYS.appTitle,
    DEFAULT_BRANDING.appTitle,
  );
  state.browserTitle = pick(
    data,
    BRAND_CONFIG_KEYS.browserTitle,
    DEFAULT_BRANDING.browserTitle,
  );
  state.logo = pick(data, BRAND_CONFIG_KEYS.logo, DEFAULT_BRANDING.logo);
  state.loginBg = pick(
    data,
    BRAND_CONFIG_KEYS.loginBg,
    DEFAULT_BRANDING.loginBg,
  );
  state.welcome = pick(
    data,
    BRAND_CONFIG_KEYS.welcome,
    DEFAULT_BRANDING.welcome,
  );
  state.pageTitle = pick(
    data,
    BRAND_CONFIG_KEYS.pageTitle,
    DEFAULT_BRANDING.pageTitle,
  );
  state.pageDesc = pick(
    data,
    BRAND_CONFIG_KEYS.pageDesc,
    DEFAULT_BRANDING.pageDesc,
  );
  state.icp = pick(data, BRAND_CONFIG_KEYS.icp, DEFAULT_BRANDING.icp);
  state.icpLink = pick(
    data,
    BRAND_CONFIG_KEYS.icpLink,
    DEFAULT_BRANDING.icpLink,
  );
  state.companyName = pick(
    data,
    BRAND_CONFIG_KEYS.companyName,
    DEFAULT_BRANDING.companyName,
  );
  state.loaded = true;
  syncBrandingToPreferences();
}

/**
 * 启动时拉取公开品牌配置（免登录）。失败则保留本地默认。
 */
export async function loadRemoteBrandConfig(): Promise<void> {
  try {
    const api = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const res = await fetch(`${api}/system/systemSetting/brandConfig`, {
      method: 'GET',
      credentials: 'omit',
    });
    if (!res.ok) {
      applyBrandConfigMap(null);
      return;
    }
    const json = (await res.json()) as {
      code?: number | string;
      data?: Record<string, string>;
    };
    if (Number(json.code) === 200 && json.data) {
      applyBrandConfigMap(json.data);
      return;
    }
    applyBrandConfigMap(null);
  } catch (error) {
    console.warn('[branding] 远程品牌配置加载失败，使用本地默认', error);
    applyBrandConfigMap(null);
  }
}

export const branding = readonly(state);

export function useBranding() {
  return {
    branding,
    resolveAssetUrl,
    reload: loadRemoteBrandConfig,
  };
}
