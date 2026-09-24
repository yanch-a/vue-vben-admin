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
import { translateUiText } from '#/locales/ui-text';

const forbiddenComponent = () => import('#/views/_core/fallback/forbidden.vue');
const comingSoonComponent = '/_core/fallback/coming-soon';

/**
 * 与 generate-routes-backend.normalizeViewPath 保持一致，用于判断页面是否存在
 * 后端偶发返回非字符串 component（null/数字/对象），必须先兜底，否则登录守卫崩溃回登录页
 * @author yanch
 */
function normalizeViewPath(path: unknown): string {
  const raw = typeof path === 'string' ? path : String(path ?? '');
  const normalizedPath = raw.replace(/^(\.\/|\.\.\/)+/, '');
  const viewPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `/${normalizedPath}`;
  return viewPath.replace(/^\/views/, '');
}

function toPageKey(component: unknown): string {
  const normalized = normalizeViewPath(component);
  if (!normalized || normalized === '/') {
    return '';
  }
  return normalized.endsWith('.vue') ? normalized : `${normalized}.vue`;
}

function joinRoutePath(parent: string, child: unknown): string {
  const childPath = typeof child === 'string' ? child : String(child ?? '');
  if (!childPath) return parent || '/';
  if (childPath.startsWith('/')) return childPath;
  const base = parent.endsWith('/') ? parent.slice(0, -1) : parent;
  const joined = `${base}/${childPath}`.replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function isPageComponent(component?: unknown): boolean {
  return (
    typeof component === 'string' &&
    !!component &&
    component !== 'IFrameView' &&
    component !== 'BasicLayout'
  );
}

/**
 * 清洗后端菜单：component/path 统一成字符串，避免后续 mapTree 里 path.replace 崩溃
 * @author yanch
 */
function sanitizeMenuTree(
  menus: RouteRecordStringComponent[] | null | undefined,
): RouteRecordStringComponent[] {
  if (!Array.isArray(menus)) {
    return [];
  }
  return menus.map((menu) => {
    // RouteRecordStringComponent.component 要求 string；空值用 ''，勿用 undefined
    const component =
      menu.component == null || menu.component === ''
        ? ''
        : typeof menu.component === 'string'
          ? menu.component
          : String(menu.component);

    const path =
      typeof menu.path === 'string'
        ? menu.path
        : menu.path == null
          ? ''
          : String(menu.path);

    return {
      ...menu,
      path,
      component,
      children: menu.children?.length
        ? sanitizeMenuTree(menu.children as RouteRecordStringComponent[])
        : undefined,
    };
  });
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
 * 页面路由以后台菜单为准，不再在前端写死隐藏页列表。
 * 若后台未下发某隐藏子页，应在菜单管理中配置，而不是在此硬编码。
 */
const HIDDEN_PAGE_ROUTES: RouteRecordStringComponent[] = [];

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
  }).map((route) => ({
    // 必须深拷贝：convertRoutes 会原地把 component 从字符串改成函数，
    // 若复用模块常量，退出再登录就会 path.replace is not a function
    ...route,
    meta: route.meta ? { ...route.meta } : undefined,
  }));
  // 后端菜单若已注册同名/同路径页面，仍强制补齐全屏 meta，避免查看页被顶栏遮挡。
  const patched = patchFullscreenRouteMeta([...menus, ...extras]);
  return patched;
}

/** 已知应脱离 BasicLayout 的页面：即使来自后端菜单也强制 noBasicLayout。 */
const FULLSCREEN_ROUTE_KEYS = new Set([
  'VisualDashboardView',
  'QueryResultShare',
  '/visual/dashboard/view',
]);

function patchFullscreenRouteMeta(
  menus: RouteRecordStringComponent[],
): RouteRecordStringComponent[] {
  return mapTree(menus, (route) => {
    const matched =
      (route.name && FULLSCREEN_ROUTE_KEYS.has(String(route.name))) ||
      (route.path && FULLSCREEN_ROUTE_KEYS.has(route.path));
    if (!matched) return route;
    return {
      ...route,
      meta: {
        ...route.meta,
        // RouteRecordStringComponent 要求 title 必填；异常后端菜单回落到路由名/路径。
        title: route.meta?.title || String(route.name || route.path || ''),
        hideInMenu: true,
        hideInTab: true,
        hideInBreadcrumb: true,
        noBasicLayout: true,
      },
    };
  });
}

/**
 * 本地化动态菜单和隐藏路由标题。
 *
 * <p>新后台返回已翻译标题；该兼容层同时支持尚未升级的旧服务端，确保桌面端切换
 * 服务地址后也不会因后台版本不同而退回中文。</p>
 *
 * @author yanch
 */
function localizeMenuTitles(
  menus: RouteRecordStringComponent[],
): RouteRecordStringComponent[] {
  return mapTree(menus, (route) => {
    const title = route.meta?.title;
    if (typeof title !== 'string') return route;
    return {
      ...route,
      meta: {
        ...route.meta,
        title: translateUiText(title),
      },
    };
  });
}

/**
 * 可选：把旧菜单路径临时指到已有页面（渐进迁移）
 * key/value 均为 vben 风格：/xxx/yyy（无 .vue）
 */
const COMPONENT_ALIASES: Record<string, string> = {
  '/cmsContent/detail': '/cms/cmsContent/CmsContentEdit',
  '/cms/cmsContent/detail': '/cms/cmsContent/CmsContentEdit',
  '/memberUser/detail': '/member/memberUser/MemberUserEdit',
  '/member/memberUserGroup': '/member/memberUserGroup/index',
  '/member/memberUserGroup/index': '/member/memberUserGroup/index',
  '/member/memberOrder/detail': '/member/memberOrder/MemberOrderView',
  '/visual/dbConfig/canvas': '/visual/dbConfig/canvas',
  '/visual/dbConfig/relationCanvas': '/visual/dbConfig/relationCanvas',
  '/visual/client': '/visual/client/index',
  '/lSql/visualClient': '/visual/client/index',
  '/visual/client/savedQueries': '/visual/client/savedQueryManage',
  '/visual/dashboard/view': '/visual/dashboard/view',
  '/visual/queryResult/share/:shareCode': '/visual/visualQuery/share',
  '/visual/index': '/visual/client/index',
  '/ai/model': '/ai/model/index',
  '/ai/model/index': '/ai/model/index',
  '/setting/parameter': '/setting/parameter/index',
  '/setting/parameter/index': '/setting/parameter/index',
  '/setting/systemSetting': '/setting/systemSetting/index',
  '/setting/systemSetting/index': '/setting/systemSetting/index',
  '/setting/attachment': '/setting/attachment/index',
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
 * 解析实际存在的页面组件：别名 → 原路径 → 自动补 /index
 * 菜单里常写成 /setting/systemSetting，真实文件是 /setting/systemSetting/index.vue
 */
function resolvePageComponent(
  component: string,
  pageKeys: Set<string>,
): null | string {
  const aliased = COMPONENT_ALIASES[component] || component;
  const normalized = aliased.replace(/\/$/, '');
  const candidates = [aliased, normalized];
  if (!normalized.endsWith('/index')) {
    candidates.push(`${normalized}/index`);
  }
  for (const item of candidates) {
    const pageKey = toPageKey(item);
    if (pageKey && pageKeys.has(pageKey)) {
      return item.endsWith('.vue') ? item.replace(/\.vue$/, '') : item;
    }
  }
  return null;
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
    // 非字符串（偶发脏数据）或布局组件：不做页面存在性校验
    if (
      typeof component !== 'string' ||
      !component ||
      component === 'IFrameView' ||
      component === 'BasicLayout'
    ) {
      return route;
    }
    // 仍有子路由的目录节点不校验 component
    if (route.children?.length && !isPageComponent(component)) {
      return route;
    }

    const resolved = resolvePageComponent(component, pageKeys);
    if (!resolved) {
      return {
        ...route,
        component: comingSoonComponent,
        meta: {
          ...route.meta,
          title:
            route.meta?.title ?? String(route.name ?? route.path ?? '未命名'),
          note: `invalid-component:${String(component)}`,
        },
      };
    }

    if (resolved === component) {
      return route;
    }
    return { ...route, component: resolved };
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
      const cleaned = sanitizeMenuTree(menus || []);
      const flattened = flattenPageDetailChildren(cleaned);
      const withHidden = mergeHiddenPageRoutes(flattened);
      const localized = localizeMenuTitles(withHidden);
      // 再拷贝一层：convertRoutes / mapTree 不得污染本次构建结果之外的引用
      return applyMissingComponentFallback(
        structuredClone
          ? structuredClone(localized)
          : JSON.parse(JSON.stringify(localized)),
        pageMap,
      );
    },
    forbiddenComponent,
    layoutMap,
    pageMap,
  });
}

export { generateAccess };
