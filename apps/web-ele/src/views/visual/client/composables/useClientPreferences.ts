/**
 * 数据库客户端 UI 偏好（localStorage）
 * - 查询 Tabs 位置：上方 / 左侧
 * - 左侧 Tabs 条宽度（竖排时）
 * - SQL 编辑器字号
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
  /** SQL 编辑器字号（px） */
  sqlEditorFontSize: number;
  /**
   * 连接栏浏览对象背景色（按 dbConfigId）。
   * 空字符串表示使用默认样式。
   */
  connectionColors: Record<string, string>;
}

const defaults: ClientPreferences = {
  queryTabsPlacement: 'top',
  queryTabsLeftWidth: 148,
  sqlEditorFontSize: 13,
  connectionColors: {},
};

const TABS_LEFT_MIN = 80;
const TABS_LEFT_MAX = 420;
const SQL_FONT_MIN = 11;
const SQL_FONT_MAX = 28;

function clampTabsLeftWidth(n: number) {
  if (!Number.isFinite(n)) return defaults.queryTabsLeftWidth;
  return Math.min(TABS_LEFT_MAX, Math.max(TABS_LEFT_MIN, Math.round(n)));
}

function clampSqlFontSize(n: number) {
  if (!Number.isFinite(n)) return defaults.sqlEditorFontSize;
  return Math.min(SQL_FONT_MAX, Math.max(SQL_FONT_MIN, Math.round(n)));
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
      sqlEditorFontSize: clampSqlFontSize(
        typeof parsed?.sqlEditorFontSize === 'number'
          ? parsed.sqlEditorFontSize
          : defaults.sqlEditorFontSize,
      ),
      connectionColors: normalizeConnectionColors(parsed?.connectionColors),
    };
  } catch {
    return { ...defaults };
  }
}

function normalizeConnectionColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || typeof v !== 'string') continue;
    const color = v.trim();
    if (
      color &&
      (/^#([0-9a-fA-F]{3,8})$/.test(color) ||
        /^rgba?\([\d\s.,%]+\)$/i.test(color) ||
        /^hsla?\([\d\s.,%]+\)$/i.test(color))
    ) {
      out[String(k)] = color;
    }
  }
  return out;
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
          sqlEditorFontSize: state.sqlEditorFontSize,
          connectionColors: state.connectionColors,
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

  const sqlEditorFontSize = computed({
    get: () => state.sqlEditorFontSize,
    set: (v: number) => {
      state.sqlEditorFontSize = clampSqlFontSize(v);
    },
  });

  function setQueryTabsPlacement(v: QueryTabsPlacement) {
    queryTabsPlacement.value = v;
  }

  function getConnectionColor(dbConfigId: number | string): string {
    return state.connectionColors[String(dbConfigId)] || '';
  }

  function setConnectionColor(dbConfigId: number | string, color: string) {
    const key = String(dbConfigId);
    const next = { ...state.connectionColors };
    const trimmed = String(color || '').trim();
    if (!trimmed) {
      delete next[key];
    } else {
      next[key] = trimmed;
    }
    state.connectionColors = next;
  }

  return {
    preferences: state,
    queryTabsPlacement,
    queryTabsLeftWidth,
    sqlEditorFontSize,
    setQueryTabsPlacement,
    getConnectionColor,
    setConnectionColor,
    TABS_LEFT_MIN,
    TABS_LEFT_MAX,
    SQL_FONT_MIN,
    SQL_FONT_MAX,
  };
}
