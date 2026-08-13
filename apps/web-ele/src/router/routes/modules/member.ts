import type { RouteRecordRaw } from 'vue-router';

/**
 * 会员详情 / 订单详情：列表跳转用，菜单中可能无隐藏路由
 */
const routes: RouteRecordRaw[] = [
  {
    name: 'MemberUserDetailRoute',
    path: '/memberUser/detail',
    // @ts-expect-error Options API SFC：vue-tsc 无法为其生成模块声明
    component: () => import('#/views/member/memberUser/MemberUserEdit.vue'),
    meta: {
      hideInMenu: true,
      title: '会员详情',
      activePath: '/member/memberUser',
    },
  },
  {
    name: 'MemberOrderDetailRoute',
    path: '/member/memberOrder/detail',
    // @ts-expect-error Options API SFC：vue-tsc 无法为其生成模块声明
    component: () => import('#/views/member/memberOrder/MemberOrderView.vue'),
    meta: {
      hideInMenu: true,
      title: '订单详情',
      activePath: '/member/memberOrder',
    },
  },
];

export default routes;
