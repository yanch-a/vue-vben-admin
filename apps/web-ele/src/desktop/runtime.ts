/**
 * Electron 预加载脚本向页面暴露的最小接口。
 * Web 环境不存在该接口，因此不会改变原有浏览器端行为。
 *
 * @author yanch
 */
interface LemonDesktopBridge {
  readonly isDesktop: true;
  getActiveServer: () => Promise<DesktopServer | null>;
  openServerSelector: () => Promise<void>;
  setAuthenticated: (authenticated: boolean) => Promise<void>;
  setLocale: (locale: 'en-US' | 'zh-CN') => Promise<void>;
  /** 原生菜单触发导出临时查询；返回取消订阅函数 */
  onExportTemporarySession?: (listener: () => void) => () => void;
  /** 原生菜单触发导入临时查询；返回取消订阅函数 */
  onImportTemporarySession?: (listener: () => void) => () => void;
}

/** 当前由 Electron 主进程选中的服务端。 */
interface DesktopServer {
  id: string;
  name: string;
  url: string;
}

declare global {
  interface Window {
    lemonDesktop?: LemonDesktopBridge;
  }
}

let activeServer: DesktopServer | null = null;

/** 生成稳定的短指纹，地址变化后自动切换到新的本地缓存空间。 */
function hashServerUrl(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 在 Vue 应用加载前同步桌面端运行信息。
 * 服务端的实际代理由 Electron 主进程完成，渲染进程不会接触文件系统。
 */
export async function initializeDesktopRuntime(): Promise<void> {
  if (!window.lemonDesktop?.isDesktop) {
    return;
  }

  activeServer = await window.lemonDesktop.getActiveServer();
  if (!activeServer) {
    throw new Error('Electron 未选择服务端，应用无法初始化');
  }
}

/** 是否运行在 Lemon Electron 客户端中。 */
export function isDesktopApp(): boolean {
  return window.lemonDesktop?.isDesktop === true;
}

/**
 * 将服务端配置 ID 加入 Store 命名空间，防止切换服务端时串用登录令牌和偏好。
 */
export function getDesktopServerStorageKey(): string {
  if (!activeServer?.id || !activeServer.url) {
    return '';
  }
  const safeId = activeServer.id.replaceAll(/[^a-zA-Z0-9_-]/g, '');
  return `desktop-${safeId}-${hashServerUrl(activeServer.url)}`;
}

/** 为依赖服务端的普通 localStorage 数据生成隔离键；Web 端继续使用原键。 */
export function getDesktopScopedStorageKey(baseKey: string): string {
  const serverKey = getDesktopServerStorageKey();
  return serverKey ? `${baseKey}:${serverKey}` : baseKey;
}

/** 打开原生客户端的服务端选择窗口。 */
export async function openDesktopServerSelector(): Promise<void> {
  await window.lemonDesktop?.openServerSelector();
}

/** 将登录状态同步给主进程，供下次启动决定是否直接打开主程序。 */
export async function setDesktopAuthenticated(
  authenticated: boolean,
): Promise<void> {
  try {
    await window.lemonDesktop?.setAuthenticated(authenticated);
  } catch (error) {
    // 登录流程不能因客户端状态标记写入失败而中断。
    console.warn('[desktop] 登录状态同步失败', error);
  }
}

/** 将右上角选择的语言同步给 Electron 原生菜单和服务端选择窗口。 */
export async function setDesktopLocale(locale: 'en-US' | 'zh-CN'): Promise<void> {
  try {
    await window.lemonDesktop?.setLocale(locale);
  } catch (error) {
    // Web 端不存在该桥接；桌面菜单同步失败也不应阻断页面语言切换。
    console.warn('[desktop] 语言同步失败', error);
  }
}
