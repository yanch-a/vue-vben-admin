import type { EChartsOption } from 'echarts';

import type { ComponentPublicInstance, Ref } from 'vue';

import type { Nullable } from '@vben/types';

import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  unref,
  watch,
} from 'vue';

import { usePreferences } from '@vben/preferences';

import {
  tryOnUnmounted,
  useDebounceFn,
  useResizeObserver,
  useTimeoutFn,
  useWindowSize,
} from '@vueuse/core';

import echarts from './echarts';

type EchartsUIType = ComponentPublicInstance | undefined;

type EchartsThemeType = 'dark' | 'light' | null;

function useEcharts(chartRef: Ref<EchartsUIType>) {
  let chartInstance: echarts.ECharts | null = null;
  let cacheOptions: EChartsOption = {};
  // echarts是否处于激活状态
  const isActiveRef = ref(false);

  const { isDark } = usePreferences();
  const { height, width } = useWindowSize();
  const resizeHandler: () => void = useDebounceFn(resize, 200);

  const getChartEl = (): HTMLElement | null => {
    const refValue = chartRef?.value as unknown;
    if (!refValue) return null;
    if (refValue instanceof HTMLElement) {
      return refValue;
    }
    const maybeComponent = refValue as { $el?: HTMLElement };
    return maybeComponent.$el ?? null;
  };

  onMounted(() => (isActiveRef.value = true));
  onActivated(() => (isActiveRef.value = true));
  onDeactivated(() => (isActiveRef.value = false));
  onBeforeUnmount(() => (isActiveRef.value = false));

  const isElHidden = (el: HTMLElement | null): boolean => {
    if (!el) return true;
    return el.offsetHeight === 0 || el.offsetWidth === 0;
  };

  const getOptions = computed((): EChartsOption => {
    if (!isDark.value) {
      return {};
    }

    return {
      backgroundColor: 'transparent',
    };
  });

  const initCharts = (t?: EchartsThemeType) => {
    const el = chartRef?.value?.$el;
    if (!el) {
      return undefined;
    }
    // 求值顺序与上游一致：t || isDark.value 先于三元（即 t='light' 时
    // 仍会落到 'dark'，为上游既有行为，本工具链 PR 不改动）。
    chartInstance = echarts.init(el, t || isDark.value ? 'dark' : null);

    return chartInstance;
  };

  const renderEcharts = (
    options: EChartsOption,
    clear = true,
  ): Promise<Nullable<echarts.ECharts>> => {
    if (!unref(isActiveRef)) {
      return Promise.resolve(null);
    }
    const currentOptions = {
      // 主题提供默认值，用户显式设置的 option（例如 backgroundColor）优先。@author yanch
      ...getOptions.value,
      ...options,
    };
    return new Promise((resolve, reject) => {
      if (getChartEl()?.offsetHeight === 0) {
        useTimeoutFn(async () => {
          renderEcharts(options).then(resolve, reject);
        }, 30);
        return;
      }
      void nextTick(() => {
        const el = getChartEl();
        if (isElHidden(el)) {
          useTimeoutFn(async () => {
            renderEcharts(options).then(resolve, reject);
          }, 30);
          return;
        }
        useTimeoutFn(() => {
          // 自定义 option 可能语义无效，将渲染异常交给调用页展示，而不是抛出未捕获异常。@author yanch
          try {
            if (!chartInstance || chartInstance?.getDom() !== el) {
              chartInstance?.dispose();
              const instance = initCharts();
              // 等待窗口内组件卸载（ref 已空）时拿不到实例：按 Nullable
              // 语义 resolve(null)，不能裸 return——那会让返回的 Promise
              // 永久 pending，挂起下游 await renderEcharts/updateData 的
              // 调用方。
              if (!instance) {
                resolve(null);
                return;
              }
              chartInstance = instance;
            }
            clear && chartInstance?.clear();
            chartInstance?.setOption(currentOptions);
            // 只缓存成功渲染的配置，非法编辑草稿不能污染主题切换后的重绘。@author yanch
            cacheOptions = options;
            resolve(chartInstance);
          } catch (error) {
            reject(error);
          }
        }, 30);
      });
    });
  };

  const updateData = (
    option: EChartsOption,
    notMerge = false, // false = 合并（保留动画），true = 完全替换
    lazyUpdate = false, // true 时不立即重绘，适合短时间内多次调用
  ): Promise<echarts.ECharts | null> => {
    return new Promise((resolve) => {
      void nextTick(() => {
        if (!chartInstance) {
          // 还没初始化 → 当作首次渲染
          // renderEcharts 的不变式是只 resolve 不 reject；catch 为防御性
          // 兜底——不变式被打破时降级为 null，而非产生 unhandled rejection
          void renderEcharts(option)
            .then(resolve)
            .catch(() => resolve(null));
          return;
        }

        // 合并你原有的全局配置（比如 backgroundColor）
        const finalOption = {
          ...getOptions.value,
          ...option,
        };

        chartInstance.setOption(finalOption, {
          notMerge,
          lazyUpdate,
          // silent: true,     // 如果追求极致性能可开启（关闭所有事件）
        });

        resolve(chartInstance);
      });
    });
  };

  function resize() {
    const el = getChartEl();
    if (isElHidden(el)) {
      return;
    }
    chartInstance?.resize({
      animation: {
        duration: 300,
        easing: 'quadraticIn',
      },
    });
  }

  watch([width, height], () => {
    resizeHandler?.();
  });

  useResizeObserver(getChartEl, resizeHandler);

  watch([isDark, isActiveRef], () => {
    if (chartInstance && unref(isActiveRef)) {
      chartInstance.dispose();
      initCharts();
      void renderEcharts(cacheOptions);
      resize();
    }
  });

  tryOnUnmounted(() => {
    // 销毁实例，释放资源
    chartInstance?.dispose();
  });
  return {
    isActive: isActiveRef,
    renderEcharts,
    resize,
    updateData,
    getChartInstance: () => chartInstance,
  };
}

export { useEcharts };

export type { EchartsUIType };
