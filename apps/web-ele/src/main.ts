import { initPreferences, updatePreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

import {
  getDesktopServerStorageKey,
  initializeDesktopRuntime,
} from './desktop/runtime';
import { overridesPreferences } from './preferences';

/**
 * 应用初始化完成之后再进行页面加载渲染
 *
 * @author yanch
 */
async function initApplication() {
  // Electron 需要先取得主进程中当前选择的服务端，再初始化任何请求模块。
  await initializeDesktopRuntime();

  // name用于指定项目唯一标识
  // 用于区分不同项目的偏好设置以及存储数据的key前缀以及其他一些需要隔离的数据
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const desktopServerKey = getDesktopServerStorageKey();
  const namespace =
    `${import.meta.env.VITE_APP_NAMESPACE}-${appVersion}-${env}` +
    (desktopServerKey ? `-${desktopServerKey}` : '');

  // app偏好设置初始化
  await initPreferences({
    namespace,
    overrides: overridesPreferences,
  });

  // 本地缓存的偏好会覆盖 overrides，这里强制关掉页面缓存/过渡，避免连点菜单右侧空白
  // 同时强制关掉版本检测：否则会每分钟 HEAD BASE_URL（生产是 /lmdb/view/）
  updatePreferences({
    tabbar: { keepAlive: false },
    transition: { enable: false },
    app: { enableCheckUpdates: false },
  });

  // 先落到本地品牌默认，再尝试拉后台覆盖（失败不影响启动）
  const { applyBrandConfigMap, loadRemoteBrandConfig } = await import(
    './store/branding'
  );
  applyBrandConfigMap(null);
  await loadRemoteBrandConfig();

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);

  // 移除并销毁loading
  unmountGlobalLoading();
}

initApplication();
