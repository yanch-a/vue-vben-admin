import {
  appCopyrightPreferences,
  defineOverridesPreferences,
} from '@vben/preferences';

/**
 * @description 项目配置文件
 * 只需要覆盖项目中的一部分配置，不需要的配置不用覆盖，会自动使用默认配置
 * !!! 更改配置后请清空缓存，否则可能不生效
 */
export const overridesPreferences = defineOverridesPreferences({
  // overrides
  app: {
    defaultHomePath: '/dashboard',
    accessMode: 'backend',
    enableRefreshToken: false,
    name: import.meta.env.VITE_APP_TITLE,
  },
  // 关闭 Alt+L / L 相关锁屏快捷键，避免在 SQL 编辑时误触锁屏
  shortcutKeys: {
    globalLockScreen: false,
  },
  // 关闭页面缓存与过渡，避免连点菜单时右侧内容挂载失败后空白
  tabbar: {
    keepAlive: false,
  },
  transition: {
    enable: false,
  },
  copyright: appCopyrightPreferences,
});
