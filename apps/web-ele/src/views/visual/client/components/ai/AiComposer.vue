<script lang="ts" setup>
/**
 * 输入框 + 场景 + 快捷指令 + @表名 补全。
 * - scene 随 send 进入 AgentChatRequest，后端 PromptBuilder 按场景加收尾规则。
 * - 输入 @ 弹出当前实例的表名候选，选中后以 `表名` 形式写入；发送时把显式引用的表一并上报
 *   （context.mentionedTables），后端优先注入这些表的结构文档。
 * - 快捷指令按上下文排序：有报错时「修复报错」置顶，有选中 SQL 时优化/解释/检查索引靠前。
 * - Enter 发送，Shift+Enter 换行，Ctrl/⌘+Enter 也可发送；输入框为空时 ↑/↓ 回溯本窗口发过的消息。
 * @author yanch
 */
import { computed, nextTick, ref, watch } from 'vue';

import { ArrowDown } from '@element-plus/icons-vue';

import type { AgentScene } from '#/api/ai/agent';
import { translateUiText } from '#/locales/ui-text';

import {
  applyMention,
  arrangeChips,
  ETL_CHIPS,
  extractMentionedTables,
  findMentionToken,
  matchTableMentions,
  resolveTemplate,
  SQL_CHIPS,
  type ComposerChip,
  type MentionToken,
} from '../../utils/aiComposerAssist';

defineOptions({ name: 'AiComposer' });

const props = defineProps<{
  scene: AgentScene;
  running: boolean;
  hasSelection?: boolean;
  hasError?: boolean;
  etlMode?: boolean;
  /** 当前实例的表名，用于 @ 补全；缺省或空数组时不弹候选 */
  tableNames?: string[];
}>();

const emit = defineEmits<{
  'update:scene': [AgentScene];
  /** 第二个参数为本次显式引用的表名（可能为空数组） */
  send: [string, { mentionedTables: string[] }];
  stop: [];
  clearSelection: [];
  clearError: [];
}>();

const text = ref('');
const inputRef = ref<any>();
const scene = computed({
  get: () => props.scene,
  set: (v: AgentScene) => emit('update:scene', v),
});

/** 快捷指令：按上下文排序后分成主行与「更多」 */
const chipGroups = computed(() =>
  arrangeChips(
    props.etlMode ? ETL_CHIPS : SQL_CHIPS,
    { hasError: props.hasError, hasSelection: props.hasSelection },
    props.etlMode ? ETL_CHIPS.length : 5,
  ),
);

/** 取底层 textarea 元素，用于读写光标 */
function textarea(): HTMLTextAreaElement | null {
  const el = inputRef.value?.textarea ?? inputRef.value?.$el?.querySelector?.('textarea');
  return (el as HTMLTextAreaElement) || null;
}

function setCursor(pos: number) {
  nextTick(() => {
    const el = textarea();
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
    updateMention();
  });
}

function applyChip(c: ComposerChip) {
  scene.value = c.scene;
  const { text: t, cursor } = resolveTemplate(translateUiText(c.tpl));
  text.value = t;
  setCursor(cursor);
}

// ───────────── @表名 补全 ─────────────
const mention = ref<MentionToken | null>(null);
const mentionIndex = ref(0);
const mentionItems = computed(() => {
  if (!mention.value || !props.tableNames?.length) return [] as string[];
  return matchTableMentions(props.tableNames, mention.value.query, 8);
});
const mentionOpen = computed(() => mentionItems.value.length > 0);

/** 每次输入或光标移动后重新判断是否处于 @token 中 */
function updateMention() {
  const el = textarea();
  if (!el || !props.tableNames?.length) {
    mention.value = null;
    return;
  }
  const next = findMentionToken(text.value, el.selectionStart ?? text.value.length);
  if (!next || next.query !== mention.value?.query || next.start !== mention.value?.start) {
    mentionIndex.value = 0;
  }
  mention.value = next;
}

function pickMention(name: string) {
  const el = textarea();
  if (!mention.value) return;
  const cursor = el?.selectionStart ?? text.value.length;
  const res = applyMention(text.value, mention.value, cursor, name);
  text.value = res.text;
  mention.value = null;
  setCursor(res.cursor);
}

watch(text, () => nextTick(updateMention));

// ───────────── 发送 / 历史回溯 ─────────────
/** 本窗口已发送的消息（最多 30 条），空输入时 ↑↓ 回溯 */
const sentHistory = ref<string[]>([]);
let historyCursor = -1;

function onKey(e: KeyboardEvent) {
  if (mentionOpen.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionIndex.value = (mentionIndex.value + 1) % mentionItems.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionIndex.value =
        (mentionIndex.value - 1 + mentionItems.value.length) % mentionItems.value.length;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mentionItems.value[mentionIndex.value]!);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      mention.value = null;
      return;
    }
  }
  if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doSend();
    return;
  }
  // 历史回溯：空输入按 ↑ 进入浏览；浏览中 ↑↓ 切换，↓ 越过最新一条回到空输入
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const browsing = historyCursor !== -1;
    if (!sentHistory.value.length) return;
    if (!browsing && (text.value || e.key === 'ArrowDown')) return;
    e.preventDefault();
    const len = sentHistory.value.length;
    if (e.key === 'ArrowUp') {
      historyCursor = browsing ? Math.max(0, historyCursor - 1) : len - 1;
    } else if (historyCursor + 1 >= len) {
      historyCursor = -1;
      text.value = '';
      return;
    } else {
      historyCursor += 1;
    }
    text.value = sentHistory.value[historyCursor] || '';
    setCursor(text.value.length);
  }
}

// 用户手动改动了回溯出来的内容后退出浏览状态，避免后续 ↑↓ 覆盖编辑
watch(text, (v) => {
  if (historyCursor !== -1 && v !== sentHistory.value[historyCursor]) {
    historyCursor = -1;
  }
});

function onKeyUp(e: KeyboardEvent) {
  // 方向键 / Home / End 移动光标后同步 @ 状态
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateMention();
}

function doSend() {
  const t = text.value.trim();
  if (!t || props.running) return;
  const mentionedTables = extractMentionedTables(t, props.tableNames || []);
  emit('send', t, { mentionedTables });
  sentHistory.value = [...sentHistory.value.filter((x) => x !== t), t].slice(-30);
  historyCursor = -1;
  text.value = '';
  mention.value = null;
}

function setText(t: string) {
  text.value = t || '';
  historyCursor = -1;
  setCursor(text.value.length);
}

defineExpose({ setText });
</script>

<template>
  <div class="composer">
    <div class="chips">
      <ElTag
        v-for="c in chipGroups.primary"
        :key="c.label"
        size="small"
        class="chip"
        :class="{ hot: (c.forError && hasError) || (c.needsSelection && hasSelection && !hasError) }"
        :type="c.forError && hasError ? 'danger' : undefined"
        effect="plain"
        @click="applyChip(c)"
      >
        {{ $tr(c.label) }}
      </ElTag>
      <ElDropdown
        v-if="chipGroups.more.length"
        trigger="click"
        size="small"
        popper-class="ai-model-select-popper"
        @command="applyChip"
      >
        <ElTag size="small" class="chip" effect="plain">
          {{ $tr('更多') }}
          <ElIcon class="chip-arrow"><ArrowDown /></ElIcon>
        </ElTag>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="c in chipGroups.more" :key="c.label" :command="c">
              {{ $tr(c.label) }}
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
    <div class="row">
      <ElTag v-if="etlMode">{{ $tr('ETL 配置与问答') }}</ElTag>
      <ElRadioGroup v-else v-model="scene" size="small">
        <ElRadioButton label="sql" value="sql">SQL</ElRadioButton>
        <ElRadioButton label="chart" value="chart">{{
          $tr('图表')
        }}</ElRadioButton>
        <ElRadioButton label="free" value="free">{{
          $tr('自由')
        }}</ElRadioButton>
        <ElRadioButton label="schema_doc" value="schema_doc">{{
          $tr('文档')
        }}</ElRadioButton>
      </ElRadioGroup>
      <ElTag
        v-if="hasSelection"
        size="small"
        closable
        @close="emit('clearSelection')"
        >{{ $tr('已附带选中 SQL') }}</ElTag
      >
      <ElTag
        v-if="hasError"
        size="small"
        type="danger"
        closable
        @close="emit('clearError')"
        >{{ $tr('已附带报错') }}</ElTag
      >
    </div>
    <div class="input-wrap">
      <!-- @ 候选：贴在输入框上方，不遮挡正在输入的行 -->
      <div v-if="mentionOpen" class="mention-pop" @mousedown.prevent>
        <div class="mention-title">{{ $tr('引用表（Enter / Tab 选择）') }}</div>
        <div
          v-for="(name, i) in mentionItems"
          :key="name"
          class="mention-item"
          :class="{ active: i === mentionIndex }"
          @mouseenter="mentionIndex = i"
          @click="pickMention(name)"
        >
          {{ name }}
        </div>
      </div>
      <ElInput
        ref="inputRef"
        v-model="text"
        type="textarea"
        :rows="3"
        :placeholder="
          $tr(
            tableNames?.length
              ? '描述你的需求，输入 @ 引用表名；Enter 发送，Shift+Enter 换行'
              : '描述你的需求，Enter 发送，Shift+Enter 换行',
          )
        "
        @keydown="onKey"
        @keyup="onKeyUp"
        @click="updateMention"
        @blur="mention = null"
      />
    </div>
    <div class="actions">
      <span v-if="running" class="run-hint">{{
        $tr('运行中，可随时停止')
      }}</span>
      <ElButton
        v-if="running"
        size="small"
        type="danger"
        @click="emit('stop')"
        >{{ $tr('停止') }}</ElButton
      >
      <ElButton
        v-else
        size="small"
        type="primary"
        :disabled="!text.trim()"
        @click="doSend"
        >{{ $tr('发送') }}</ElButton
      >
    </div>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid var(--el-border-color);
  padding: 8px;
  font-size: var(--vc-ai-font-size, 13px);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.chip {
  cursor: pointer;
}
.chip.hot {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: 600;
}
.chip-arrow {
  margin-left: 2px;
  vertical-align: -1px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.input-wrap {
  position: relative;
}
.mention-pop {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 4px;
  max-height: 220px;
  overflow: auto;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  z-index: 10;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.mention-title {
  padding: 4px 8px;
  color: var(--el-text-color-secondary);
  font-family: inherit;
  font-size: 11px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.mention-item {
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mention-item.active,
.mention-item:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.run-hint {
  margin-right: auto;
  font-size: 12px;
  color: var(--el-color-warning);
  font-weight: 600;
}
</style>
