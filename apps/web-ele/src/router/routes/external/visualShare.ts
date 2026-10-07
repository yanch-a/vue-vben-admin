import type { RouteRecordRaw } from 'vue-router';

/**
 * 公开（免登录）路由：大屏分享链接 / 外站嵌入。
 * <p>后台菜单只对登录用户下发，匿名访问者拿不到动态路由，因此分享页放在 vben 预留的
 * external 路由槽（静态、无布局、不进菜单）。复用大屏查看页组件，令牌模式下只调用
 * 匿名分享接口 /admin/biShare/public/{token}，不触发登录与菜单加载。</p>
 * 这里不是业务菜单页面：业务页仍以后台菜单为准，不写进 access.ts / visual.ts。
 * @author yanch
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'VisualDashboardShare',
    path: '/visual/dashboard/share/:token',
    component: () => import('#/views/visual/dashboard/view.vue'),
    meta: {
      title: '数据大屏',
      ignoreAccess: true,
      hideInMenu: true,
      hideInTab: true,
      hideInBreadcrumb: true,
      noBasicLayout: true,
    },
  },
];

export default routes;
