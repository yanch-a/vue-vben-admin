/**
 * 数据库客户端 UI 偏好（localStorage）
 * - 查询 Tabs 位置：上方 / 左侧
 * - 左侧 Tabs 条宽度（竖排时）
 * @author yanch
 */
import { computed, reactive, watch } from 'vue';

const STORAGE_KEY = 'visual-client-preferences-v1';

export type QueryTabsPlacement = 'top' | 'left';

export interface ClientPreferences {
  /** 查询编辑器 Tabs 条位置，默认上方 */
  queryTabsPlacement: QueryTabsPlacement;
  /** Tabs 竖排时的条宽 */
  queryTabsLeftWidth: number;
}

const defaults: ClientPreferences = {
  queryTabsPlacement: 'top',
  queryTabsLeftWidth: 148,
};

const TABS_LEFT_MIN = 80;
const TABS_LEFT_MAX = 420;

function clampTabsLeftWidth(n: number) {
  if (!Number.isFinite(n)) return defaults.queryTabsLeftWidth;
  return Math.min(TABS_LEFT_MAX, Math.max(TABS_LEFT_MIN, Math.round(n)));
}

function load(): ClientPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    const placement = parsed?.queryTabsPlacement;
    return {
      queryTabsPlacement:
        placement === 'left' || placement === 'top'
          ? placement
          : defaults.queryTabsPlacement,
      queryTabsLeftWidth: clampTabsLeftWidth(
        typeof parsed?.queryTabsLeftWidth === 'number'
          ? parsed.queryTabsLeftWidth
          : defaults.queryTabsLeftWidth,
      ),
    };
  } catch {
    return { ...defaults };
  }
}

const state = reactive<ClientPreferences>(load());

watch(
  state,
  () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          queryTabsPlacement: state.queryTabsPlacement,
          queryTabsLeftWidth: state.queryTabsLeftWidth,
        }),
      );
    } catch {
      // ignore quota / private mode
    }
  },
  { deep: true },
);

export function useClientPreferences() {
  const queryTabsPlacement = computed({
    get: () => state.queryTabsPlacement,
    set: (v: QueryTabsPlacement) => {
      state.queryTabsPlacement = v === 'left' ? 'left' : 'top';
    },
  });

  const queryTabsLeftWidth = computed({
    get: () => state.queryTabsLeftWidth,
    set: (v: number) => {
      state.queryTabsLeftWidth = clampTabsLeftWidth(v);
    },
  });

  function setQueryTabsPlacement(v: QueryTabsPlacement) {
    queryTabsPlacement.value = v;
  }

  return {
    preferences: state,
    queryTabsPlacement,
    queryTabsLeftWidth,
    setQueryTabsPlacement,
    TABS_LEFT_MIN,
    TABS_LEFT_MAX,
  };
}
