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

/** ETL 使用独立窗口显隐，不触发原客户端 Dock 或改变其已保存状态。 */
export function useAiWindowState(isolated = false) {
  const windowState = isolated
    ? reactive({ visible: false, minimized: false, maximized: false })
    : state;
  function open() {
    windowState.visible = true;
    windowState.minimized = false;
  }
  function minimize() {
    windowState.minimized = true;
  }
  function restore() {
    windowState.visible = true;
    windowState.minimized = false;
  }
  function close() {
    windowState.visible = false;
    windowState.minimized = false;
  }
  function toggleMax() {
    windowState.maximized = !windowState.maximized;
  }
  return { state: windowState, open, minimize, restore, close, toggleMax };
}
