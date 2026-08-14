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
];

export default routes;
