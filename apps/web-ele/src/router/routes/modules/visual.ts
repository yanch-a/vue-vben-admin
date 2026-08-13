import type { RouteRecordRaw } from 'vue-router';

/**
 * 可视化：表分组画布 / 关系画布
 * 列表页通过 name 跳转；backend 菜单若未配置或嵌套在列表下会导致「URL 变了内容不变」
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'DbConfigCanvas',
    path: '/visual/dbConfig/canvas',
    // @ts-expect-error Options API SFC：vue-tsc 无法为其生成模块声明
    component: () => import('#/views/visual/dbConfig/canvas.vue'),
    meta: {
      hideInMenu: true,
      title: '表分组',
      activePath: '/visual/dbConfig',
    },
  },
  {
    name: 'RelationCanvas',
    path: '/visual/dbConfig/relationCanvas',
    // @ts-expect-error Options API SFC：vue-tsc 无法为其生成模块声明
    component: () => import('#/views/visual/dbConfig/relationCanvas.vue'),
    meta: {
      hideInMenu: true,
      title: '关系画布',
      activePath: '/visual/dbConfig',
    },
  },
];

export default routes;
