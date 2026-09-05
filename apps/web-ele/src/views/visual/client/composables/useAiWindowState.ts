/**
 * AI 浮窗显示 / 最小化 / 未读
 * @author yanch
 */
import { reactive, watch } from 'vue';

const KEY = 'visual-client-ai-window-v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch {
    return {};
  }
}

const saved = load();
const state = reactive({
  visible: !!saved.visible,
  minimized: !!saved.minimized,
  maximized: false,
  unread: 0,
});

watch(
  () => ({ visible: state.visible, minimized: state.minimized }),
  (v) => localStorage.setItem(KEY, JSON.stringify(v)),
  { deep: true },
);

export function useAiWindowState() {
  function open() {
    state.visible = true;
    state.minimized = false;
    state.unread = 0;
  }
  function minimize() {
    state.minimized = true;
  }
  function restore() {
    state.visible = true;
    state.minimized = false;
    state.unread = 0;
  }
  function close() {
    state.visible = false;
    state.minimized = false;
    state.unread = 0;
  }
  function toggleMax() {
    state.maximized = !state.maximized;
  }
  return { state, open, minimize, restore, close, toggleMax };
}
