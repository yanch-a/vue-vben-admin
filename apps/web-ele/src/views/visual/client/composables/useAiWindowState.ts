/**
 * AI 浮窗显隐，与 AiChatWindow / AiDockBar 共享同一份单例 state。
 * 最小化后点 Dock 还原；Dock 右键关闭。
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
  }
  function minimize() {
    state.minimized = true;
  }
  function restore() {
    state.visible = true;
    state.minimized = false;
  }
  function close() {
    state.visible = false;
    state.minimized = false;
  }
  function toggleMax() {
    state.maximized = !state.maximized;
  }
  return { state, open, minimize, restore, close, toggleMax };
}
