<script lang="ts" setup>
import type { RouteLocationNormalizedLoadedGeneric } from 'vue-router';

import { unref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';

import { preferences, usePreferences } from '@vben/preferences';
import { getTabKey, storeToRefs, useTabbarStore } from '@vben/stores';

import { transformComponent, useLayoutHook } from '../../hooks';
import { IFrameRouterView } from '../../iframe';
import { RouteCachedPage, RouteCachedView } from '../../route-cached';

defineOptions({ name: 'LayoutContent' });

/** 最多保留的页面实例数，超出按最近最少使用淘汰，防止开很多标签后内存膨胀 */
const KEEP_ALIVE_MAX = 20;

const tabbarStore = useTabbarStore();
const route = useRoute();
const { keepAlive } = usePreferences();

/**
 * 标签栏可以隐藏，但菜单「页面缓存」仍要登记当前路由。
 * KeepAlive 的 include 只收录已打开且 meta.keepAlive 为真的路由名；
 * 标签栏未挂载时由这里写入，切走再回来才会复用原来的页面实例。
 */
watch(
  () => route.fullPath,
  () => {
    if (preferences.tabbar.enable) {
      return;
    }
    const meta = route.matched?.[route.matched.length - 1]?.meta;
    tabbarStore.addTab({
      ...route,
      meta: meta || route.meta,
    });
  },
  { immediate: true },
);

const { getCachedTabs, getExcludeCachedTabs, renderRouteView } =
  storeToRefs(tabbarStore);

const { getEnabledTransition, getTransitionName } = useLayoutHook();

/**
 * 是否显示component
 * @param route
 */
const showComponent = (route: RouteLocationNormalizedLoadedGeneric) => {
  return !route.meta.domCached && unref(renderRouteView);
};
</script>

<template>
  <div class="page-route-container relative h-full">
    <IFrameRouterView />
    <RouteCachedView />
    <RouterView v-slot="{ Component, route }">
      <RouteCachedPage
        :component="Component"
        :route="route"
        v-if="route.meta.domCached"
      />
      <Transition
        v-if="getEnabledTransition"
        :name="getTransitionName(route)"
        appear
        :leave-active-class="`${getTransitionName(route)}-leave-active page-route-leave-active`"
      >
        <KeepAlive
          v-if="keepAlive"
          :exclude="getExcludeCachedTabs"
          :include="getCachedTabs"
          :max="KEEP_ALIVE_MAX"
        >
          <component
            :is="transformComponent(Component, route)"
            v-if="showComponent(route)"
            v-show="!route.meta.iframeSrc"
            :key="getTabKey(route)"
          />
        </KeepAlive>
        <component
          :is="Component"
          v-else-if="showComponent(route)"
          :key="getTabKey(route)"
        />
      </Transition>
      <template v-else>
        <KeepAlive
          v-if="keepAlive"
          :exclude="getExcludeCachedTabs"
          :include="getCachedTabs"
          :max="KEEP_ALIVE_MAX"
        >
          <component
            :is="transformComponent(Component, route)"
            v-if="showComponent(route)"
            v-show="!route.meta.iframeSrc"
            :key="getTabKey(route)"
          />
        </KeepAlive>
        <component
          :is="Component"
          v-else-if="showComponent(route)"
          :key="getTabKey(route)"
        />
      </template>
    </RouterView>
  </div>
</template>

<style>
/* 优化router动画切换切换重叠问题 */
.page-route-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

/* 移除动画切换的横向滚动条 translateX(-30px) */
.page-route-container:has(> .fade-slide-enter-active),
.page-route-container:has(> .fade-slide-leave-active) {
  overflow-x: hidden;
}

/* 移除动画切换的纵向滚动条 */
.page-route-container:has(> .fade-up-enter-active),
.page-route-container:has(> .fade-up-leave-active),
.page-route-container:has(> .fade-down-enter-active),
.page-route-container:has(> .fade-down-leave-active) {
  overflow-y: hidden;
}
</style>
