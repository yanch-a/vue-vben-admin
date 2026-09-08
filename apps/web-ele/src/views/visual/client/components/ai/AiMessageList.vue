<script lang="ts" setup>
/**
 * 消息流。SQL/配置/图表卡片 emit → AiChatWindow → 父页插入 SQL 或应用到界面。
 * @author yanch
 */
import { computed, nextTick, ref, watch } from 'vue';

import type { AiMsg } from '../../composables/useAiChat';
import { splitSqlBlocks } from '../../utils/markdown';
import AiChartCard from './AiChartCard.vue';
import AiQueryConfigCard from './AiQueryConfigCard.vue';
import AiSqlCard from './AiSqlCard.vue';
import AiToolStepView from './AiToolStep.vue';

defineOptions({ name: 'AiMessageList' });

const props = defineProps<{
  messages: AiMsg[];
  running: boolean;
  dbConfigId?: number | string;
  instanceName?: string;
}>();

const emit = defineEmits<{
  insertSql: [string];
  replaceSql: [string];
  runSql: [string];
  openSqlInNewTab: [string];
  applyQueryConfig: [NonNullable<AiMsg['queryConfig']>];
}>();

const box = ref<HTMLElement | null>(null);
/** 贴底才自动滚；用户上滚看思考过程时不要被增量输出拽回去 */
const stickToBottom = ref(true);
const NEAR_BOTTOM_PX = 48;

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function onListScroll() {
  const el = box.value;
  if (!el) return;
  stickToBottom.value = isNearBottom(el);
}

function scrollToBottomIfNeeded() {
  const el = box.value;
  if (!el || !stickToBottom.value) return;
  el.scrollTop = el.scrollHeight;
}

/** 把每条助手消息拆成「正文片段 + SQL 卡片」，避免重复渲染 proposedSql */
const viewMessages = computed(() =>
  (props.messages || []).map((m) => {
    if (m.role !== 'assistant') {
      return { msg: m, parts: [] as ReturnType<typeof splitSqlBlocks> };
    }
    const parts = splitSqlBlocks(m.text || '');
    // 正文里已有相同 SQL 代码块时，不再额外挂一张 proposed 卡片
    const proposed = m.sql?.sql?.trim();
    const alreadyInText =
      !!proposed &&
      parts.some((p) => p.type === 'sql' && p.sql.trim() === proposed);
    return {
      msg: m,
      parts,
      showProposed: !!proposed && !alreadyInText,
    };
  }),
);

watch(
  () =>
    props.messages.map(
      (m) =>
        m.text +
        (m.sql?.sql || '') +
        (m.queryConfig?.previewSql || '') +
        m.steps.length +
        (m.reasoning || ''),
    ),
  () => nextTick(scrollToBottomIfNeeded),
);

/** 新开一轮生成时重新贴底，方便看最新回复 */
watch(
  () => props.running,
  (now, prev) => {
    if (now && !prev) {
      stickToBottom.value = true;
      nextTick(scrollToBottomIfNeeded);
    }
  },
);

function onSqlAction(
  type: 'insert' | 'replace' | 'run' | 'openTab',
  sql: string,
) {
  const s = (sql || '').trim();
  if (!s) return;
  if (type === 'insert') emit('insertSql', s);
  else if (type === 'replace') emit('replaceSql', s);
  else if (type === 'run') emit('runSql', s);
  else emit('openSqlInNewTab', s);
}
</script>

<template>
  <div ref="box" class="msg-list" @scroll.passive="onListScroll">
    <div v-if="!messages.length" class="empty">输入需求，让 AI 帮你写 SQL 或出图表</div>
    <div v-for="item in viewMessages" :key="item.msg.id" class="msg" :class="item.msg.role">
      <template v-if="item.msg.role === 'user'">
        <div class="bubble">{{ item.msg.text }}</div>
      </template>
      <template v-else>
        <ElCollapse v-if="item.msg.reasoning" class="reason">
          <ElCollapseItem title="思考过程" name="r">
            <pre>{{ item.msg.reasoning }}</pre>
          </ElCollapseItem>
        </ElCollapse>
        <AiToolStepView v-for="s in item.msg.steps" :key="s.callId" :step="s" />
        <template v-for="(p, i) in item.parts" :key="item.msg.id + '-p-' + i">
          <div v-if="p.type === 'md'" class="md" v-html="p.html" />
          <AiSqlCard
            v-else
            :sql="p.sql"
            @insert="onSqlAction('insert', $event)"
            @replace="onSqlAction('replace', $event)"
            @run="onSqlAction('run', $event)"
            @open-tab="onSqlAction('openTab', $event)"
          />
        </template>
        <AiQueryConfigCard
          v-if="item.msg.queryConfig"
          :config="item.msg.queryConfig"
          @apply="emit('applyQueryConfig', $event)"
          @open-sql="onSqlAction('openTab', $event)"
        />
        <AiSqlCard
          v-if="item.showProposed && item.msg.sql && !item.msg.queryConfig"
          :sql="item.msg.sql.sql"
          :explanation="item.msg.sql.explanation"
          :warnings="item.msg.sql.warnings"
          :write-operation="item.msg.sql.writeOperation"
          @insert="onSqlAction('insert', $event)"
          @replace="onSqlAction('replace', $event)"
          @run="onSqlAction('run', $event)"
          @open-tab="onSqlAction('openTab', $event)"
        />
        <AiChartCard
          v-if="item.msg.chart"
          :title="item.msg.chart.title"
          :sql="item.msg.chart.sql"
          :spec="item.msg.chart.spec"
          :columns="item.msg.chart.columns"
          :rows="item.msg.chart.rows"
          :db-config-id="dbConfigId"
          :instance-name="instanceName"
          @open-sql="onSqlAction('openTab', $event)"
        />
        <div v-if="item.msg.error" class="err">{{ item.msg.error }}</div>
        <div v-if="item.msg.role === 'assistant'" class="msg-state">
          <span v-if="!item.msg.done && running" class="st running">生成中</span>
          <span v-else-if="item.msg.done && !item.msg.error" class="st done">已完成</span>
        </div>
      </template>
    </div>
    <div v-if="running" class="typing">
      <span class="dot" />
      正在生成，可上滚查看思考过程
    </div>
  </div>
</template>

<style scoped>
.msg-list {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
  min-height: 0;
  border-radius: 0;
}
.empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 32px 8px;
  font-size: var(--vc-ai-font-size, 13px);
}
.msg.user {
  display: flex;
  justify-content: flex-end;
}
.bubble {
  max-width: 80%;
  background: var(--el-color-primary-light-9);
  border-radius: 8px;
  padding: 8px 10px;
  white-space: pre-wrap;
  font-size: var(--vc-ai-font-size, 13px);
}
.md {
  font-size: var(--vc-ai-font-size, 13px);
  line-height: 1.55;
  color: var(--el-text-color-primary);
  word-break: break-word;
}
.md :deep(p) {
  margin: 6px 0;
}
.md :deep(pre) {
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.md :deep(code) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.md :deep(ul),
.md :deep(ol) {
  padding-left: 1.25em;
  margin: 6px 0;
}
.err {
  color: var(--el-color-danger);
  font-size: var(--vc-ai-font-size, 13px);
  margin-top: 6px;
}
.reason {
  margin-bottom: 6px;
}
.reason pre {
  white-space: pre-wrap;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.msg-state {
  margin-top: 6px;
}
.st {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  line-height: 18px;
}
.st.running {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-8);
}
.st.done {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.typing {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}
.typing .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-warning);
  animation: ai-pulse 1s ease-in-out infinite;
}
@keyframes ai-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
