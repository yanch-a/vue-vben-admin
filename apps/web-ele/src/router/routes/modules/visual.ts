import type { RouteRecordRaw } from 'vue-router';

/**
 * 可视 / 数据库客户端相关：静态仅保留旧路径重定向与非菜单全屏页。
 * 列表/工作台等页面路由以后台菜单拉取为准，勿在此写死业务页。
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'VisualClientLegacyRedirect',
    path: '/visual/client',
    redirect: '/lSql/visualClient',
    meta: {
      hideInMenu: true,
      hideInTab: true,
    },
  },
  {
    name: 'VisualClientAliasRedirect',
    path: '/visual/visualClient',
    redirect: '/lSql/visualClient',
    meta: {
      hideInMenu: true,
      hideInTab: true,
    },
  },
  {
    name: 'SqlWorkLegacyRedirect',
    path: '/SqlWork',
    redirect: '/lSql/sqlWorkOrder',
    meta: {
      hideInMenu: true,
      hideInTab: true,
    },
  },
  /**
   * 查看页：无基础布局；大屏 ID 通过 screenId 查询参数传递。
   * 若后台菜单已下发同名路由，框架会去重，此处兜底 noBasicLayout。
   */
  {
    name: 'VisualDashboardView',
    path: '/visual/dashboard/view',
    component: () => import('#/views/visual/dashboard/view.vue'),
    meta: {
      title: '数据大屏',
      hideInMenu: true,
      hideInTab: true,
      hideInBreadcrumb: true,
      noBasicLayout: true,
      activePath: '/visual/dashboard',
    },
  },
  /**
   * 查询结果分享页：无基础布局，登录后即可打开。
   */
  {
    name: 'QueryResultShare',
    path: '/visual/queryResult/share/:shareCode',
    // @ts-expect-error SFC without typed module
    component: () => import('#/views/visual/visualQuery/share.vue'),
    meta: {
      hideInMenu: true,
      hideInTab: true,
      hideInBreadcrumb: true,
      noBasicLayout: true,
      title: '共享查询结果',
    },
  },
];

export default routes;
