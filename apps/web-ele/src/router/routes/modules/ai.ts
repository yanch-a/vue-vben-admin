import type { RouteRecordRaw } from 'vue-router';

/**
 * AI 模型维护（菜单未配置时仍可直接访问）
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'AiModelManage',
    path: '/ai/model',
    component: () => import('#/views/ai/model/index.vue'),
    meta: {
      title: 'AI 模型配置',
      hideInMenu: true,
    },
  },
];

export default routes;
