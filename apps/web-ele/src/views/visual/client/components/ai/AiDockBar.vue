<script lang="ts" setup>
/**
 * 底部 Dock：AiChatWindow 最小化后的入口。
 * 与浮窗共用 useAiWindowState；点击 restore，右键 close。
 * @author yanch
 */
import { useAiWindowState } from '../../composables/useAiWindowState';

defineOptions({ name: 'AiDockBar' });

const { state, restore, close } = useAiWindowState();

function onCtx(e: MouseEvent) {
  e.preventDefault();
  close();
}
</script>

<template>
  <div v-if="state.visible && state.minimized" class="ai-dock">
    <button class="pill" @click="restore" @contextmenu="onCtx">
      AI 助手
    </button>
  </div>
</template>

<style scoped>
.ai-dock {
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.pill {
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  border-radius: 12px;
  padding: 0 10px;
  height: 22px;
  cursor: pointer;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
</style>
