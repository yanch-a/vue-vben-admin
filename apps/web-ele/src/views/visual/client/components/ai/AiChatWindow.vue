<script lang="ts" setup>
/**
 * AI 助手浮窗：拖动 / 缩放 / 最小化
 * @author yanch
 */
import { computed, onMounted, nextTick, ref } from 'vue';

import { ElMessage } from 'element-plus';

import { listConversations, deleteConversation, type AgentScene } from '#/api/ai/agent';
import { listSelectableModels } from '#/api/ai/model';

import { useAiChat } from '../../composables/useAiChat';
import { useAiWindowState } from '../../composables/useAiWindowState';
import { useFloatingWindow } from '../../composables/useFloatingWindow';
import AiComposer from './AiComposer.vue';
import AiMessageList from './AiMessageList.vue';

defineOptions({ name: 'AiChatWindow' });

const props = defineProps<{
  dbConfigId?: number | string | null;
  instanceName?: string;
  connLabel?: string;
  /** 1=允许真实行数据发给模型；缺省/0=脱敏模式 */
  aiAllowSampleData?: number | null;
}>();

const emit = defineEmits<{
  insertSql: [string];
  replaceSql: [string];
  runSql: [string];
  openSqlInNewTab: [string];
}>();

/** 当前是否脱敏（未允许样例数据） */
const isMaskedMode = computed(
  () => Number(props.aiAllowSampleData) !== 1,
);

const MODEL_KEY = 'visual-client-ai-model-id';
const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const { rect, onDragStart, onResizeStart } = useFloatingWindow('visual-client-ai-win-rect', {
  x: 80,
  y: 80,
  w: 600,
  h: 620,
});
const { state, open, minimize, restore, close, toggleMax } = useAiWindowState();

const modelId = ref<string | number>(localStorage.getItem(MODEL_KEY) || '');
const selectable = ref<any[]>([]);
const scene = ref<AgentScene>('sql');
const convDrawer = ref(false);
const convs = ref<any[]>([]);
const pendingContext = ref<{ selectedSql?: string; editorSql?: string; lastError?: string }>({});
const composerRef = ref<InstanceType<typeof AiComposer>>();

const {
  messages,
  running,
  send: sendChat,
  stop,
  newConversation,
  loadConversation,
} = useAiChat(() => ({
  dbConfigId: props.dbConfigId,
  instanceName: props.instanceName || '',
  modelId: modelId.value,
}));

const winStyle = computed(() => {
  if (state.maximized) {
    return { left: '0px', top: '0px', width: '100vw', height: '100vh' };
  }
  return {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.w + 'px',
    height: rect.h + 'px',
  };
});

onMounted(async () => {
  try {
    const res: any = await listSelectableModels();
    selectable.value = res?.data || [];
    if (!modelId.value) {
      for (const g of selectable.value) {
        const d = (g.models || []).find((m: any) => m.isDefault === 1);
        if (d) {
          modelId.value = d.id;
          break;
        }
        if (g.models?.[0]) modelId.value = g.models[0].id;
      }
    }
  } catch {
    /* ignore */
  }
});

async function openConvList() {
  convDrawer.value = true;
  const res: any = await listConversations({ dbConfigId: props.dbConfigId as any });
  convs.value = res?.data || [];
}

function onModelChange(v: any) {
  localStorage.setItem(MODEL_KEY, String(v));
}

function send(text: string) {
  try {
    sendChat(text, scene.value, { ...pendingContext.value });
  } catch (e: any) {
    ElMessage.warning(e?.message || '无法发送，请先选择连接、实例和模型');
  }
}

function exposeOpen(payload?: { scene?: AgentScene; prefill?: string; context?: any }) {
  open();
  if (payload?.scene) scene.value = payload.scene;
  if (payload?.context) pendingContext.value = { ...pendingContext.value, ...payload.context };
  if (payload?.prefill) {
    nextTick(() => composerRef.value?.setText?.(payload.prefill || ''));
  }
}

defineExpose({
  open: exposeOpen,
  minimize,
  restore,
  close,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-show="state.visible && !state.minimized"
      class="ai-win"
      :style="winStyle"
    >
      <div class="ai-win-header" @mousedown="onDragStart">
        <span class="title">AI 助手 · {{ connLabel || '未连接' }}</span>
        <ElSelect
          v-model="modelId"
          size="small"
          filterable
          teleported
          :popper-options="{ strategy: 'fixed' }"
          popper-class="ai-model-select-popper"
          style="width: 200px"
          @mousedown.stop
          @change="onModelChange"
        >
          <ElOptionGroup v-for="g in selectable" :key="g.providerName" :label="g.providerName">
            <ElOption v-for="m in g.models" :key="m.id" :label="m.displayName" :value="m.id" />
          </ElOptionGroup>
        </ElSelect>
        <div class="actions" @mousedown.stop>
          <button title="会话列表" @click="openConvList">☰</button>
          <button title="最小化到任务栏" @click="minimize">—</button>
          <button title="最大化/还原" @click="toggleMax">☐</button>
          <button title="关闭" @click="close">×</button>
        </div>
      </div>
      <!-- 与 SQL 编辑器联动的上下文：实例 + 脱敏状态 -->
      <div class="ai-win-ctx" @mousedown.stop>
        <span class="ctx-item" :title="connLabel || ''">
          连接
          <strong>{{ connLabel || '未连接' }}</strong>
        </span>
        <span class="ctx-sep">|</span>
        <span class="ctx-item" :class="{ warn: !instanceName }">
          实例
          <strong>{{ instanceName || '未选择' }}</strong>
        </span>
        <span class="ctx-sep">|</span>
        <ElTag
          size="small"
          :type="isMaskedMode ? 'warning' : 'success'"
          effect="plain"
          :title="
            isMaskedMode
              ? 'run_sql 结果会脱敏后发给模型；sample_rows 不可用。可在连接设置中开启「允许样例数据」'
              : '允许把真实行数据发给模型（含 run_sql / sample_rows）'
          "
        >
          {{ isMaskedMode ? '脱敏模式' : '真实样例' }}
        </ElTag>
      </div>
      <AiMessageList
        :messages="messages"
        :running="running"
        :db-config-id="dbConfigId || undefined"
        :instance-name="instanceName"
        @insert-sql="emit('insertSql', $event)"
        @replace-sql="emit('replaceSql', $event)"
        @run-sql="emit('runSql', $event)"
        @open-sql-in-new-tab="emit('openSqlInNewTab', $event)"
      />
      <AiComposer
        ref="composerRef"
        v-model:scene="scene"
        :running="running"
        :has-selection="!!pendingContext.selectedSql"
        :has-error="!!pendingContext.lastError"
        @send="send"
        @stop="stop"
        @clear-selection="pendingContext.selectedSql = ''"
        @clear-error="pendingContext.lastError = ''"
      />
      <div
        v-for="d in dirs"
        :key="d"
        :class="['rs', 'rs-' + d]"
        @mousedown="onResizeStart(d, $event)"
      />
      <ElDrawer v-model="convDrawer" title="会话" size="280px" append-to-body>
        <ElButton size="small" type="primary" @click="newConversation(); convDrawer = false">
          新建会话
        </ElButton>
        <div v-for="c in convs" :key="c.id" class="conv-item">
          <span class="conv-title" @click="loadConversation(c.id); convDrawer = false">
            {{ c.title || '未命名' }}
          </span>
          <ElButton
            link
            type="danger"
            size="small"
            @click="deleteConversation(c.id).then(openConvList)"
          >
            删
          </ElButton>
        </div>
      </ElDrawer>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-win {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--el-box-shadow);
  border-radius: 8px;
  overflow: hidden;
}
.ai-win-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: move;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}
.ai-win-ctx {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-blank);
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: default;
}
.ctx-item strong {
  margin-left: 4px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.ctx-item.warn strong {
  color: var(--el-color-warning);
}
.ctx-sep {
  opacity: 0.45;
}
.title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions button {
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 24px;
  height: 24px;
  color: var(--el-text-color-regular);
}
.rs {
  position: absolute;
}
.rs-n, .rs-s { left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.rs-n { top: 0; }
.rs-s { bottom: 0; }
.rs-e, .rs-w { top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.rs-e { right: 0; }
.rs-w { left: 0; }
.rs-ne, .rs-nw, .rs-se, .rs-sw { width: 10px; height: 10px; }
.rs-ne { top: 0; right: 0; cursor: nesw-resize; }
.rs-nw { top: 0; left: 0; cursor: nwse-resize; }
.rs-se { bottom: 0; right: 0; cursor: nwse-resize; }
.rs-sw { bottom: 0; left: 0; cursor: nesw-resize; }
.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.conv-title {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<!-- 下拉挂到 body，必须高于浮窗 z-index:3000 -->
<style>
.ai-model-select-popper {
  z-index: 4000 !important;
}
</style>
