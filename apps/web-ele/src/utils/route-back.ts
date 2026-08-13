import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

import { useTabbarStore } from '@vben/stores';

function isBadListTarget(target: string, detailPath: string) {
  if (!target || target === '/') return true;
  if (target === detailPath) return true;
  // activePath 误配成详情自身
  if (/(^|\/)detail\/?$/i.test(target)) return true;
  return false;
}

function isMissingRoute(router: Router, target: string) {
  const resolved = router.resolve(target);
  if (!resolved.matched.length) return true;
  const last = resolved.matched[resolved.matched.length - 1];
  if (last?.name === 'FallbackNotFound') return true;
  // resolve 到了当前详情页
  if (resolved.path === router.currentRoute.value.path) return true;
  return false;
}

export type BackToListOptions = {
  fallbackPath: string;
  /** 优先按路由 name 回列表（最稳） */
  listRouteName?: string;
};

/**
 * 详情页返回列表：先进入列表，再移除详情 Tab（避免 closeTab 当前页跳到相邻 Tab）。
 */
export async function backToListPage(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  fallbackPathOrOptions: BackToListOptions | string,
) {
  const options: BackToListOptions =
    typeof fallbackPathOrOptions === 'string'
      ? { fallbackPath: fallbackPathOrOptions }
      : fallbackPathOrOptions;

  const detailFullPath = route.fullPath;
  const detailPath = route.path;
  const tabbarStore = useTabbarStore();

  let navigated = false;

  // 1) 优先按列表路由 name
  if (options.listRouteName && router.hasRoute(options.listRouteName)) {
    try {
      await router.push({ name: options.listRouteName });
      navigated = router.currentRoute.value.path !== detailPath;
    } catch {
      navigated = false;
    }
  }

  // 2) activePath（需校验，防止误配成详情 path）
  if (!navigated) {
    let target = String(route.meta?.activePath || '');
    if (isBadListTarget(target, detailPath) || isMissingRoute(router, target)) {
      target = options.fallbackPath;
    }
    if (isBadListTarget(target, detailPath)) {
      target = options.fallbackPath;
    }
    try {
      await router.push(target);
      navigated = router.currentRoute.value.path !== detailPath;
    } catch {
      navigated = false;
    }
  }

  // 3) 仍失败则强制 fallback
  if (!navigated) {
    await router.replace(options.fallbackPath);
  }

  // 关掉详情 Tab（用 _close，绝不触发跳邻页）
  const detailTab = tabbarStore.getTabs.find(
    (tab) => tab.fullPath === detailFullPath || tab.path === detailPath,
  );
  if (detailTab) {
    tabbarStore._close(detailTab);
    await tabbarStore.updateCacheTabs();
  }
}
