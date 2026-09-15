import type { RouteRecordRaw } from 'vue-router';

/**
 * 可视化 / 数据库客户端
 * 列表页通过 name 跳转；backend 菜单若未配置隐藏子页会兜底
 */
const routes: RouteRecordRaw[] = [
  /**
   * 图表资产、大屏列表与编辑器共用唯一可见入口。
   * @author yanch
   */
  {
    name: 'VisualDashboardWorkbench',
    path: '/visual/dashboard',
    component: () => import('#/views/visual/dashboard/index.vue'),
    meta: {
      title: '数据大屏工作台',
    },
  },
  {
    name: 'VisualDashboardView',
    // 查看页与后台菜单路由保持一致，具体大屏 ID 通过 screenId 查询参数传递。
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
  {
    name: 'VisualClient',
    path: '/visual/client',
    component: () => import('#/views/visual/client/index.vue'),
    meta: {
      title: '数据库客户端',
      hideInMenu: true,
    },
  },
  {
    name: 'SavedQueryManage',
    path: '/visual/client/savedQueries',
    component: () => import('#/views/visual/client/savedQueryManage.vue'),
    meta: {
      title: '查询文件管理',
      hideInMenu: true,
      activePath: '/visual/client',
    },
  },
  {
    name: 'SqlWorkOrder',
    path: '/lSql/sqlWorkOrder',
    component: () => import('#/views/visual/sqlWorkOrder/index.vue'),
    meta: {
      title: 'SQL 工单',
      hideInMenu: true,
      activePath: '/lSql/visualClient',
    },
  },
  {
    name: 'RedisConsole',
    path: '/lSql/redisConsole',
    component: () => import('#/views/visual/redisConsole/index.vue'),
    meta: {
      title: 'Redis 工作台',
      hideInMenu: true,
      activePath: '/lSql/visualClient',
    },
  },
  {
    name: 'QueryConfig',
    path: '/visual/visualQuery/index',
    // 历史 Options SFC、无 lang=ts，vue-tsc 不生成模块声明
    // @ts-expect-error SFC without typed module
    component: () => import('#/views/visual/visualQuery/index.vue'),
    meta: {
      title: '查询视图',
      hideInMenu: true,
    },
  },
  {
    name: 'DbConfigCanvas',
    path: '/visual/dbConfig/canvas',
    // 历史 Options SFC、无 lang=ts，vue-tsc 不生成模块声明
    // @ts-expect-error SFC without typed module
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
    // 历史 script setup 无 lang=ts，vue-tsc 不生成模块声明
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
