import {
  defineOverridesPreferences,
} from '@vben/preferences';

/**
 * @description 项目配置文件
 * 只需要覆盖项目中的一部分配置，不需要的配置不用覆盖，会自动使用默认配置
 * !!! 更改配置后请清空缓存，否则可能不生效
 *
 * 布局 / 登录页布局记忆位置见：
 * docs/品牌与布局配置记忆.md
 *
 * @author yanch
 */
export const overridesPreferences = defineOverridesPreferences({
  // overrides
  app: {
    defaultHomePath: '/dashboard',
    accessMode: 'backend',
    enableRefreshToken: false,
    // 系统简短标题（菜单左侧文字）；启动后可被后台 ui.brand.appTitle 覆盖
    name: import.meta.env.VITE_APP_TITLE || 'Lemon',
    // 默认双列菜单（侧边混合菜单 sidebar-mixed-nav）
    // 偏好设置面板入口：右上角「偏好设置」→ 布局 → 「双列菜单」
    // 代码位置：packages/@core/preferences/src/config.ts 默认值；此处覆盖
    layout: 'sidebar-mixed-nav',
    // 登录页布局默认：panel-right（表单在右）
    // 登录页右上角切换组件：packages/effects/layouts/src/widgets/layout-toggle.vue
    // Toolbar 注入：packages/effects/layouts/src/authentication/toolbar.vue
    authPageLayout: 'panel-right',
  },
  logo: {
    enable: true,
    source: '/logo.png',
    showText: true,
  },
  copyright: {
    companyName: 'Lemon',
    companySiteLink: '',
    date: `${new Date().getFullYear()}`,
    enable: true,
    // 备案号默认空：未配置时不展示；后台可填 ui.brand.icp
    icp: '',
    icpLink: 'https://beian.miit.gov.cn/',
    settingShow: true,
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
});
