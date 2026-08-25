import type { RouteRecordRaw } from 'vue-router';

/**
 * 可视化 / 数据库客户端
 * 列表页通过 name 跳转；backend 菜单若未配置隐藏子页会兜底
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'VisualClient',
    path: '/visual/client',
    // @ts-expect-error Options/SFC
    component: () => import('#/views/visual/client/index.vue'),
    meta: {
      title: '数据库客户端',
      hideInMenu: true,
    },
  },
  {
    name: 'SavedQueryManage',
    path: '/visual/client/savedQueries',
    // @ts-expect-error Options/SFC
    component: () => import('#/views/visual/client/savedQueryManage.vue'),
    meta: {
      title: '查询文件管理',
      hideInMenu: true,
      activePath: '/visual/client',
    },
  },
  {
    name: 'DbConfigCanvas',
    path: '/visual/dbConfig/canvas',
    // @ts-expect-error Options API SFC
    component: () => import('#/views/visual/dbConfig/canvas.vue'),
    meta: {
      hideInMenu: true,
      title: '表分组',
      activePath: '/visual/client',
    },
  },
  {
    name: 'RelationCanvas',
    path: '/visual/dbConfig/relationCanvas',
    // @ts-expect-error Options API SFC
    component: () => import('#/views/visual/dbConfig/relationCanvas.vue'),
    meta: {
      hideInMenu: true,
      title: '关系画布',
      activePath: '/visual/client',
    },
  },
  /**
   * 查询结果分享页：无基础布局（无侧栏菜单），登录后即可打开协同表格
   * @author yanch
   */
  {
    name: 'QueryResultShare',
    path: '/visual/queryResult/share/:shareCode',
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
