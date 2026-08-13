import type { RouteRecordNormalized } from 'vue-router';

import { nextTick } from 'vue';
import { useRouter } from 'vue-router';

import { useTabbarStore } from '@vben/stores';
import { isHttpUrl, openRouteInNewWindow, openWindow } from '@vben/utils';

/** 模块级锁：所有菜单共用同一队列，避免连点打断半挂载页面 */
let navLocked = false;
let pendingNav: null | { path: string; query: Record<string, any> } = null;

function useNavigation() {
  const router = useRouter();
  const routeMetaMap = new Map<string, RouteRecordNormalized>();

  const initRouteMetaMap = () => {
    routeMetaMap.clear();
    router.getRoutes().forEach((route) => {
      routeMetaMap.set(route.path, route);
    });
  };

  initRouteMetaMap();

  router.afterEach(() => {
    initRouteMetaMap();
  });

  const shouldOpenInNewWindow = (path: string): boolean => {
    if (isHttpUrl(path)) {
      return true;
    }
    const route = routeMetaMap.get(path);
    return !!(route?.meta?.link || route?.meta?.openInNewWindow);
  };

  const resolveHref = (path: string): string => {
    return router.resolve(path).href;
  };

  /**
   * 强制重挂载右侧内容区。
   * 连点导致半挂载失败时，常见现象是「地址变了但内容不刷新」——必须靠这步恢复。
   */
  async function remountContent() {
    const tabbarStore = useTabbarStore();
    try {
      // 确保不会卡在 renderRouteView=false
      tabbarStore.renderRouteView = true;
      await tabbarStore.refresh(router);
    } catch {
      tabbarStore.renderRouteView = false;
      await nextTick();
      tabbarStore.renderRouteView = true;
    }
  }

  async function pushAndSettle(path: string, query: Record<string, any>) {
    // 已在当前菜单：不再 push / remount，避免无意义重挂载把子组件搞挂
    if (router.currentRoute.value.path === path) {
      return;
    }

    try {
      await router.push({ path, query });
      await nextTick();
      // 队列里已有更新目标时，跳过中间页重挂载，直接去最终页
      if (!pendingNav) {
        await remountContent();
      }
    } catch (error: any) {
      const msg = String(error?.message || error || '');
      if (
        error?.name === 'NavigationDuplicated' ||
        msg.includes('Avoided redundant navigation') ||
        error?.name === 'NavigationCancelled' ||
        msg.includes('Navigation cancelled')
      ) {
        if (!pendingNav) {
          await remountContent();
        }
        return;
      }
      console.error('Navigation failed:', error);
      await remountContent();
    }
  }

  /**
   * 串行消费；连点只保留最后一次目标，等当前切换+重挂载完成后再跳。
   */
  async function flushNavQueue() {
    if (navLocked) {
      return;
    }
    navLocked = true;
    try {
      while (pendingNav) {
        const next = pendingNav;
        pendingNav = null;
        await pushAndSettle(next.path, next.query);
      }
    } finally {
      navLocked = false;
      if (pendingNav) {
        await flushNavQueue();
      }
    }
  }

  const navigation = async (path: string) => {
    const route = routeMetaMap.get(path);
    const { openInNewWindow = false, query = {}, link } = route?.meta ?? {};

    if (link && typeof link === 'string') {
      openWindow(link, { target: '_blank' });
      return;
    }

    if (isHttpUrl(path)) {
      openWindow(path, { target: '_blank' });
      return;
    }

    if (openInNewWindow) {
      openRouteInNewWindow(resolveHref(path));
      return;
    }

    pendingNav = {
      path,
      query: (query || {}) as Record<string, any>,
    };
    await flushNavQueue();
  };

  const willOpenedByWindow = (path: string) => {
    return shouldOpenInNewWindow(path);
  };

  return { navigation, willOpenedByWindow };
}

export { useNavigation };
