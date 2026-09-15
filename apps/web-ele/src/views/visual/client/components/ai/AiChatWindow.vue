<script lang="ts" setup>
/**
 * AI 助手浮窗。
 * expose.open 由 index.vue 的 openAiAssistant 调用。
 * dbConfigId / instanceName 来自父组件当前连接与 Tab，结构文档「问 AI」会先改 Tab 实例再 open。
 * 发送走 useAiChat → POST /admin/aiAgent/chat/stream。
 * @author yanch
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { Document, Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import { listConversations, deleteConversation, type AgentScene } from '#/api/ai/agent';
import { listSelectableModels } from '#/api/ai/model';
import { getDesktopScopedStorageKey } from '#/desktop/runtime';

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
  /** 每次发送前取最新上下文（查询视图勾选会变） */
  getExtraContext?: () => Record<string, any>;
}>();

const emit = defineEmits<{
  insertSql: [string];
  replaceSql: [string];
  runSql: [string];
  openSqlInNewTab: [string];
  applyQueryConfig: [any];
  /** 打开当前连接的 AI 结构文档 */
  openSchemaDoc: [];
}>();

/** 读取数据库连接的默认脱敏配置，新会话会重新继承该值。 */
function defaultMaskedMode() {
  return Number(props.aiAllowSampleData) !== 1;
}

/** 当前会话的脱敏策略，允许用户独立于数据库默认配置进行覆盖。 */
const isMaskedMode = ref(defaultMaskedMode());
/** 用户是否已手动覆盖默认值，避免连接信息异步刷新时覆盖用户选择。 */
const maskCustomized = ref(false);

// 模型 ID 来自当前服务端，桌面端按服务端地址隔离。
const MODEL_KEY = getDesktopScopedStorageKey('visual-client-ai-model-id');
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
const pendingContext = ref<Record<string, any>>({});
const composerRef = ref<InstanceType<typeof AiComposer>>();

const {
  messages,
  running,
  conversationId,
  send: sendChat,
  stop,
  newConversation,
  loadConversation,
} = useAiChat(() => ({
  dbConfigId: props.dbConfigId,
  instanceName: props.instanceName || '',
  modelId: modelId.value,
  allowSampleData: !isMaskedMode.value,
}));

/** 最近一条助手消息已收尾，用来在标题栏标「已完成」 */
const lastAssistantDone = computed(() => {
  const list = messages.value || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m?.role === 'assistant') {
      return !!m.done && !running.value;
    }
  }
  return false;
});

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

/** 新建会话并重新继承当前数据库连接的脱敏默认值。 */
function startNewConversation() {
  if (running.value) return;
  newConversation();
  pendingContext.value = {};
  isMaskedMode.value = defaultMaskedMode();
  maskCustomized.value = false;
  convDrawer.value = false;
}

/** 打开历史会话时使用数据库默认值，用户仍可在继续提问前修改。 */
async function openConversation(id: number | string) {
  if (running.value) return;
  await loadConversation(id);
  isMaskedMode.value = defaultMaskedMode();
  maskCustomized.value = false;
  convDrawer.value = false;
}

/**
 * 关闭脱敏会把 run_sql/sample_rows 的真实样例行发送给模型，因此二次确认。
 * 从关闭切回开启是收紧权限，无需确认。
 */
async function beforeMaskChange() {
  if (!isMaskedMode.value) return true;
  try {
    await ElMessageBox.confirm(
      '关闭后，本对话后续请求可能把 run_sql / sample_rows 返回的真实数据发送给所选模型。是否继续？',
      '关闭本对话数据脱敏',
      {
        type: 'warning',
        confirmButtonText: '确认关闭',
        cancelButtonText: '保持脱敏',
        // AI 浮窗固定为 z-index:3000，确认框遮罩必须使用更高的独立层级。
        modalClass: 'ai-mask-confirm-overlay',
      },
    );
    return true;
  } catch {
    return false;
  }
}

// 切换数据库连接时清空旧库会话，避免上下文与脱敏策略串到新连接。
watch(
  () => props.dbConfigId,
  (next, previous) => {
    if (String(next ?? '') === String(previous ?? '')) return;
    if (running.value) stop();
    newConversation();
    pendingContext.value = {};
    isMaskedMode.value = defaultMaskedMode();
    maskCustomized.value = false;
  },
);

// 尚未开始会话时，连接配置异步加载完成后同步其默认值。
watch(
  () => props.aiAllowSampleData,
  () => {
    if (!maskCustomized.value && !conversationId.value && messages.value.length === 0) {
      isMaskedMode.value = defaultMaskedMode();
    }
  },
);

function onModelChange(v: any) {
  localStorage.setItem(MODEL_KEY, String(v));
}

function send(text: string) {
  try {
    const extra = typeof props.getExtraContext === 'function' ? props.getExtraContext() : {};
    sendChat(text, scene.value, { ...pendingContext.value, ...extra });
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
        <span class="title">{{ $tr('AI 助手 ·') }} {{ $tr(connLabel || '未连接') }}</span>
        <ElTag
          v-if="running"
          size="small"
          type="warning"
          effect="dark"
          class="run-tag"
        >
          <span class="run-dot" />
          {{ $tr('运行中') }}
        </ElTag>
        <ElTag
          v-else-if="lastAssistantDone"
          size="small"
          type="success"
          effect="dark"
        >
          {{ $tr('已完成') }}
        </ElTag>
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
          <button
            class="new-conversation"
            :disabled="running"
            :title="$tr('新建会话（脱敏设置将重新跟随数据库配置）')"
            @click="startNewConversation"
          >
            <ElIcon><Plus /></ElIcon>
            <span>{{ $tr('新建会话') }}</span>
          </button>
          <button :title="$tr('会话列表')" @click="openConvList">☰</button>
          <button :title="$tr('最小化到任务栏')" @click="minimize">—</button>
          <button :title="$tr('最大化/还原')" @click="toggleMax">☐</button>
          <button :title="$tr('关闭')" @click="close">×</button>
        </div>
      </div>
      <!-- 与 SQL 编辑器联动的上下文：实例 + 脱敏状态 -->
      <div class="ai-win-ctx" @mousedown.stop>
        <span class="ctx-item" :title="connLabel || ''">
          {{ $tr('连接') }}
          <strong>{{ $tr(connLabel || '未连接') }}</strong>
        </span>
        <span class="ctx-sep">|</span>
        <span class="ctx-item" :class="{ warn: !instanceName }">
          {{ $tr('实例') }}
          <strong>{{ $tr(instanceName || '未选择') }}</strong>
        </span>
        <span class="ctx-sep">|</span>
        <span class="mask-control">
          <span>{{ $tr('本对话数据脱敏') }}</span>
          <ElSwitch
            v-model="isMaskedMode"
            size="small"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :disabled="running"
            :before-change="beforeMaskChange"
            @change="maskCustomized = true"
          />
          <ElTag
            size="small"
            :type="isMaskedMode ? 'warning' : 'danger'"
            effect="plain"
            :title="
              isMaskedMode
                ? 'run_sql 结果会脱敏后发给模型，sample_rows 不可用'
                : '本对话允许把真实行数据发给模型（含 run_sql / sample_rows）'
            "
          >
            {{ $tr(isMaskedMode ? '已脱敏' : '真实数据') }}
          </ElTag>
        </span>
      </div>
      <div class="schema-doc-tip" @mousedown.stop>
        <ElIcon><Document /></ElIcon>
        <span>
          {{ $tr('AI 会优先依赖结构文档理解表含义、字段和关联；文档越完整，回答越准确。') }}
        </span>
        <ElButton size="small" type="primary" plain @click="emit('openSchemaDoc')">
          {{ $tr('打开 AI 结构文档') }}
        </ElButton>
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
        @apply-query-config="emit('applyQueryConfig', $event)"
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
      <ElDrawer
        v-model="convDrawer"
        :title="$tr('会话')"
        size="280px"
        append-to-body
        class="ai-chat-drawer"
      >
        <ElButton size="small" type="primary" :disabled="running" @click="startNewConversation">
          {{ $tr('新建会话') }}
        </ElButton>
        <div v-for="c in convs" :key="c.id" class="conv-item">
          <span class="conv-title" @click="openConversation(c.id)">
            {{ $tr(c.title || '未命名') }}
          </span>
          <ElButton
            link
            type="danger"
            size="small"
            @click="deleteConversation(c.id).then(openConvList)"
          >
            {{ $tr('删') }}
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
  font-size: var(--vc-ai-font-size-sm, 12px);
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
.mask-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.schema-doc-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-regular);
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.schema-doc-tip > span {
  flex: 1;
}
.title {
  flex: 1;
  font-size: var(--vc-ai-font-size, 13px);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.run-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #fff;
  animation: ai-run-pulse 1s ease-in-out infinite;
}
@keyframes ai-run-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.actions button {
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 24px;
  height: 24px;
  color: var(--el-text-color-regular);
}
.actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.actions .new-conversation {
  width: auto;
  min-width: 24px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--el-color-primary);
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
/* MessageBox 的 z-index 由 Element Plus 写在行内，使用专属遮罩类提升到 AI 浮窗之上。 */
.ai-mask-confirm-overlay {
  z-index: 4200 !important;
}
</style>
