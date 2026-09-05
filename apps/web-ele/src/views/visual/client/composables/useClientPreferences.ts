/**
 * 数据库客户端 UI 偏好（localStorage）
 * - 查询 Tabs 位置：上方 / 左侧
 * - 左侧 Tabs 条宽度（竖排时）
 * - SQL 编辑器字号（仅 Monaco）
 * - 界面字号（工具栏 / 对象树 / 页签 / 结果区 / 弹窗，不含框架全局字号）
 * - AI 对话字号（助手浮窗消息、输入区、SQL 卡片）
 * @author yanch
 */
import { computed, reactive, watch } from 'vue';

import '../styles/client-fonts.css';

const STORAGE_KEY = 'visual-client-preferences-v1';
const SCOPE_CLASS = 'visual-client-active';

export type QueryTabsPlacement = 'top' | 'left';

export interface ClientPreferences {
  /** 查询编辑器 Tabs 条位置，默认上方 */
  queryTabsPlacement: QueryTabsPlacement;
  /** Tabs 竖排时的条宽 */
  queryTabsLeftWidth: number;
  /** SQL 编辑器字号（px） */
  sqlEditorFontSize: number;
  /** 客户端界面字号（px），与框架 theme.fontSize 独立 */
  uiFontSize: number;
  /** AI 对话界面字号（px） */
  aiChatFontSize: number;
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
  uiFontSize: 13,
  aiChatFontSize: 13,
  connectionColors: {},
};

const TABS_LEFT_MIN = 80;
const TABS_LEFT_MAX = 420;
const SQL_FONT_MIN = 11;
const SQL_FONT_MAX = 28;
const UI_FONT_MIN = 11;
const UI_FONT_MAX = 20;
const AI_FONT_MIN = 11;
const AI_FONT_MAX = 22;

function clampTabsLeftWidth(n: number) {
  if (!Number.isFinite(n)) return defaults.queryTabsLeftWidth;
  return Math.min(TABS_LEFT_MAX, Math.max(TABS_LEFT_MIN, Math.round(n)));
}

function clampSqlFontSize(n: number) {
  if (!Number.isFinite(n)) return defaults.sqlEditorFontSize;
  return Math.min(SQL_FONT_MAX, Math.max(SQL_FONT_MIN, Math.round(n)));
}

function clampUiFontSize(n: number) {
  if (!Number.isFinite(n)) return defaults.uiFontSize;
  return Math.min(UI_FONT_MAX, Math.max(UI_FONT_MIN, Math.round(n)));
}

function clampAiFontSize(n: number) {
  if (!Number.isFinite(n)) return defaults.aiChatFontSize;
  return Math.min(AI_FONT_MAX, Math.max(AI_FONT_MIN, Math.round(n)));
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
      uiFontSize: clampUiFontSize(
        typeof parsed?.uiFontSize === 'number'
          ? parsed.uiFontSize
          : defaults.uiFontSize,
      ),
      aiChatFontSize: clampAiFontSize(
        typeof parsed?.aiChatFontSize === 'number'
          ? parsed.aiChatFontSize
          : defaults.aiChatFontSize,
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

/** 把字号写到 :root，传送弹层 / AI 浮窗也能读到 */
function applyFontCssVars(prefs: ClientPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const ui = prefs.uiFontSize;
  const ai = prefs.aiChatFontSize;
  root.style.setProperty('--vc-ui-font-size', `${ui}px`);
  root.style.setProperty('--vc-ui-font-size-sm', `${Math.max(10, ui - 1)}px`);
  root.style.setProperty('--vc-ai-font-size', `${ai}px`);
  root.style.setProperty('--vc-ai-font-size-sm', `${Math.max(10, ai - 1)}px`);
  root.style.setProperty('--vc-ai-font-size-xs', `${Math.max(10, ai - 2)}px`);
}

const state = reactive<ClientPreferences>(load());
applyFontCssVars(state);

watch(
  state,
  () => {
    applyFontCssVars(state);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          queryTabsPlacement: state.queryTabsPlacement,
          queryTabsLeftWidth: state.queryTabsLeftWidth,
          sqlEditorFontSize: state.sqlEditorFontSize,
          uiFontSize: state.uiFontSize,
          aiChatFontSize: state.aiChatFontSize,
          connectionColors: state.connectionColors,
        }),
      );
    } catch {
      // ignore quota / private mode
    }
  },
  { deep: true },
);

/** 多页面共用时用计数，避免一个页卸载把另一个页的作用域卸掉 */
let fontScopeCount = 0;

/** 进入客户端相关页时挂上 body 类，离开时摘掉 */
export function bindVisualClientFontScope() {
  if (typeof document === 'undefined') return () => {};
  fontScopeCount += 1;
  document.body.classList.add(SCOPE_CLASS);
  applyFontCssVars(state);
  return () => {
    fontScopeCount = Math.max(0, fontScopeCount - 1);
    if (fontScopeCount === 0) {
      document.body.classList.remove(SCOPE_CLASS);
    }
  };
}

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

  const uiFontSize = computed({
    get: () => state.uiFontSize,
    set: (v: number) => {
      state.uiFontSize = clampUiFontSize(v);
    },
  });

  const aiChatFontSize = computed({
    get: () => state.aiChatFontSize,
    set: (v: number) => {
      state.aiChatFontSize = clampAiFontSize(v);
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
    uiFontSize,
    aiChatFontSize,
    setQueryTabsPlacement,
    getConnectionColor,
    setConnectionColor,
    TABS_LEFT_MIN,
    TABS_LEFT_MAX,
    SQL_FONT_MIN,
    SQL_FONT_MAX,
    UI_FONT_MIN,
    UI_FONT_MAX,
    AI_FONT_MIN,
    AI_FONT_MAX,
  };
}
