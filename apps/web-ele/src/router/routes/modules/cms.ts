import type { RouteRecordRaw } from 'vue-router';

/**
 * CMS 内容编辑页：原版从列表跳转 /cmsContent/detail
 * 菜单中可能没有该隐藏路由，这里静态注册以保证可访问
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'CmsContentInfo',
    path: '/cmsContent/detail',
    // @ts-expect-error Options API SFC：vue-tsc 无法为其生成模块声明
    component: () => import('#/views/cms/cmsContent/CmsContentEdit.vue'),
    meta: {
      hideInMenu: true,
      title: '内容详情',
      activePath: '/CMS/cmsContent',
    },
  },
];

export default routes;
