import type {
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
  RouteRecordStringComponent,
} from '@vben/types';

import { generateAccessible } from '@vben/access';
import { preferences } from '@vben/preferences';
import { mapTree } from '@vben/utils';

import { ElMessage } from 'element-plus';

import { getAllMenusApi } from '#/api';
import { BasicLayout, IFrameView } from '#/layouts';
import { $t } from '#/locales';

const forbiddenComponent = () => import('#/views/_core/fallback/forbidden.vue');
const comingSoonComponent = '/_core/fallback/coming-soon';

/**
 * 与 generate-routes-backend.normalizeViewPath 保持一致，用于判断页面是否存在
 */
function normalizeViewPath(path: string): string {
  const normalizedPath = path.replace(/^(\.\/|\.\.\/)+/, '');
  const viewPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `/${normalizedPath}`;
  return viewPath.replace(/^\/views/, '');
}

function toPageKey(component: string): string {
  const normalized = normalizeViewPath(component);
  return normalized.endsWith('.vue') ? normalized : `${normalized}.vue`;
}

function joinRoutePath(parent: string, child: string): string {
  if (!child) return parent || '/';
  if (child.startsWith('/')) return child;
  const base = parent.endsWith('/') ? parent.slice(0, -1) : parent;
  const joined = `${base}/${child}`.replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function isPageComponent(component?: null | string): boolean {
  return (
    !!component && component !== 'IFrameView' && component !== 'BasicLayout'
  );
}

/**
 * 列表页挂详情/画布子路由时，Layout 只会渲染父组件（列表页无嵌套 router-view），
 * 表现为「地址栏变了、右侧内容不变」。把带页面组件的叶子子路由提升为顶级绝对路径。
 */
function flattenPageDetailChildren(
  menus: RouteRecordStringComponent[],
): RouteRecordStringComponent[] {
  const lifted: RouteRecordStringComponent[] = [];

  const walk = (
    nodes: RouteRecordStringComponent[],
    parentAbsPath: string,
  ): RouteRecordStringComponent[] => {
    return nodes.map((menu) => {
      const absPath = menu.path?.startsWith('/')
        ? menu.path
        : joinRoutePath(parentAbsPath, menu.path || '');

      if (!menu.children?.length) {
        return menu;
      }

      if (isPageComponent(menu.component)) {
        const remain: RouteRecordStringComponent[] = [];
        for (const child of menu.children) {
          const childIsLeaf = !child.children?.length;
          if (isPageComponent(child.component) && childIsLeaf) {
            const childAbs = child.path?.startsWith('/')
              ? child.path
              : joinRoutePath(absPath, child.path || '');
            lifted.push({
              ...child,
              path: childAbs,
              meta: {
                ...child.meta,
                title:
                  child.meta?.title ??
                  String(child.name ?? childAbs ?? ''),
                hideInMenu: true,
                activePath: child.meta?.activePath || absPath,
              },
            });
          } else {
            remain.push(child);
          }
        }
        return {
          ...menu,
          children: remain.length ? walk(remain, absPath) : undefined,
        };
      }

      return {
        ...menu,
        children: walk(menu.children, absPath),
      };
    });
  };

  return [...walk(menus, ''), ...lifted];
}

function collectRouteKeys(menus: RouteRecordStringComponent[]) {
  const paths = new Set<string>();
  const names = new Set<string>();

  const walk = (nodes: RouteRecordStringComponent[]) => {
    for (const node of nodes) {
      if (node.path?.startsWith('/')) {
        paths.add(node.path);
      }
      if (node.name) {
        names.add(String(node.name));
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(menus);
  return { names, paths };
}

/**
 * 后端菜单可能没有配置的隐藏详情/画布页（原版常靠静态路由或隐藏子菜单）。
 * 以 string component 形式注入，走与 backend 菜单相同的 pageMap 解析。
 */
const HIDDEN_PAGE_ROUTES: RouteRecordStringComponent[] = [
  {
    name: 'MemberUserDetailRoute',
    path: '/memberUser/detail',
    component: '/member/memberUser/MemberUserEdit',
    meta: {
      hideInMenu: true,
      title: '会员详情',
      activePath: '/member/memberUser',
    },
  },
  {
    name: 'MemberOrderDetailRoute',
    path: '/member/memberOrder/detail',
    component: '/member/memberOrder/MemberOrderView',
    meta: {
      hideInMenu: true,
      title: '订单详情',
      activePath: '/member/memberOrder',
    },
  },
  {
    name: 'CmsContentInfo',
    path: '/cmsContent/detail',
    component: '/cms/cmsContent/CmsContentEdit',
    meta: {
      hideInMenu: true,
      title: '内容详情',
      activePath: '/CMS/cmsContent',
    },
  },
  {
    name: 'DbConfigCanvas',
    path: '/visual/dbConfig/canvas',
    component: '/visual/dbConfig/canvas',
    meta: {
      hideInMenu: true,
      title: '表分组',
      activePath: '/visual/client',
    },
  },
  {
    name: 'RelationCanvas',
    path: '/visual/dbConfig/relationCanvas',
    component: '/visual/dbConfig/relationCanvas',
    meta: {
      hideInMenu: true,
      title: '关系画布',
      activePath: '/visual/client',
    },
  },
  {
    name: 'VisualClient',
    path: '/visual/client',
    component: '/visual/client/index',
    meta: {
      hideInMenu: true,
      title: '数据库客户端',
    },
  },
];

function mergeHiddenPageRoutes(
  menus: RouteRecordStringComponent[],
): RouteRecordStringComponent[] {
  const { names, paths } = collectRouteKeys(menus);
  const extras = HIDDEN_PAGE_ROUTES.filter((route) => {
    if (route.name && names.has(String(route.name))) {
      return false;
    }
    if (route.path && paths.has(route.path)) {
      return false;
    }
    return true;
  });
  return [...menus, ...extras];
}

/**
 * 可选：把旧菜单路径临时指到已有页面（渐进迁移）
 * key/value 均为 vben 风格：/xxx/yyy（无 .vue）
 */
const COMPONENT_ALIASES: Record<string, string> = {
  '/cmsContent/detail': '/cms/cmsContent/CmsContentEdit',
  '/cms/cmsContent/detail': '/cms/cmsContent/CmsContentEdit',
  '/memberUser/detail': '/member/memberUser/MemberUserEdit',
  '/member/memberOrder/detail': '/member/memberOrder/MemberOrderView',
  '/visual/dbConfig/canvas': '/visual/dbConfig/canvas',
  '/visual/dbConfig/relationCanvas': '/visual/dbConfig/relationCanvas',
  '/visual/client': '/visual/client/index',
  '/visual/index': '/visual/client/index',
  '/setting/parameter/index': '/setting/parameter/index',
  '/setting/attachment/index': '/setting/attachment/index',
};

function buildPageKeySet(pageMap: ComponentRecordType): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(pageMap)) {
    keys.add(toPageKey(key));
  }
  return keys;
}

/**
 * 缺失页面 → coming-soon，避免控制台刷 invalid + 白屏
 */
function applyMissingComponentFallback(
  menus: RouteRecordStringComponent[],
  pageMap: ComponentRecordType,
): RouteRecordStringComponent[] {
  const pageKeys = buildPageKeySet(pageMap);

  return mapTree(menus, (route) => {
    const component = route.component;
    if (!component || component === 'IFrameView') {
      return route;
    }
    // 仍有子路由的目录节点不校验 component
    if (route.children?.length && !isPageComponent(component)) {
      return route;
    }

    const aliased = COMPONENT_ALIASES[component] || component;
    const pageKey = toPageKey(aliased);

    if (pageKeys.has(pageKey)) {
      return aliased === component ? route : { ...route, component: aliased };
    }

    return {
      ...route,
      component: comingSoonComponent,
      meta: {
        ...route.meta,
        title:
          route.meta?.title ?? String(route.name ?? route.path ?? '未命名'),
        note: `missing:${component}`,
      },
    };
  });
}

async function generateAccess(options: GenerateMenuAndRoutesOptions) {
  const pageMap: ComponentRecordType = import.meta.glob('../views/**/*.vue');

  const layoutMap: ComponentRecordType = {
    BasicLayout,
    IFrameView,
  };

  return await generateAccessible(preferences.app.accessMode, {
    ...options,
    fetchMenuListAsync: async () => {
      ElMessage({
        duration: 1500,
        message: `${$t('common.loadingMenu')}...`,
      });
      const menus = await getAllMenusApi();
      const flattened = flattenPageDetailChildren(menus || []);
      const withHidden = mergeHiddenPageRoutes(flattened);
      return applyMissingComponentFallback(withHidden, pageMap);
    },
    forbiddenComponent,
    layoutMap,
    pageMap,
  });
}

export { generateAccess };
