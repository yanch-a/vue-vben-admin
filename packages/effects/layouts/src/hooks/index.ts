import type { VNode } from 'vue';
import type {
  RouteLocationNormalizedLoaded,
  RouteLocationNormalizedLoadedGeneric,
} from 'vue-router';

import { computed, defineComponent } from 'vue';

import { preferences, usePreferences } from '@vben/preferences';

const MissingView = defineComponent({
  name: 'MissingView',
  render: () => null,
});

/**
 * 转换组件，自动添加 name（供 KeepAlive include 匹配）
 * 注意：禁止在每次渲染时新建组件定义，否则会导致右侧内容空白/无法切换。
 */
export function transformComponent(
  component: VNode,
  route: RouteLocationNormalizedLoadedGeneric,
) {
  if (!component) {
    console.error(
      'Component view not found，please check the route configuration',
    );
    return MissingView;
  }

  const routeName = route.name as string;
  if (!routeName) {
    return component;
  }

  const type = component.type as any;
  const componentName = type?.name || type?.__name;
  if (componentName) {
    return component;
  }

  // 仅补 name，不替换组件类型（保持引用稳定）
  if (type && (typeof type === 'object' || typeof type === 'function')) {
    type.name = routeName;
  }

  return component;
}

/**
 * Layout相关hook
 */
export function useLayoutHook() {
  const { keepAlive } = usePreferences();
  /**
   * 是否使用动画
   */
  const getEnabledTransition = computed(() => {
    const { transition } = preferences;
    const transitionName = transition.name;
    return transitionName && transition.enable;
  });

  /**
   * 获取路由过渡动画
   * @param _route
   */
  function getTransitionName(_route: RouteLocationNormalizedLoaded) {
    // 如果偏好设置未设置，则不使用动画
    const { tabbar, transition } = preferences;
    const transitionName = transition.name;
    if (!transitionName || !transition.enable) {
      return;
    }

    // 标签页未启用或者未开启缓存，则使用全局配置动画
    if (!tabbar.enable || !keepAlive) {
      return transitionName;
    }

    return transitionName;
  }

  return {
    getEnabledTransition,
    getTransitionName,
  };
}
