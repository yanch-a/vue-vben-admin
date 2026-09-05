<script lang="ts" setup>
/**
 * 消息流
 * @author yanch
 */
import { computed, nextTick, ref, watch } from 'vue';

import type { AiMsg } from '../../composables/useAiChat';
import { splitSqlBlocks } from '../../utils/markdown';
import AiChartCard from './AiChartCard.vue';
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
}>();

const box = ref<HTMLElement | null>(null);

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
      (m) => m.text + (m.sql?.sql || '') + m.steps.length + (m.reasoning || ''),
    ),
  () => nextTick(() => box.value && (box.value.scrollTop = box.value.scrollHeight)),
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
  <div ref="box" class="msg-list">
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
        <AiSqlCard
          v-if="item.showProposed && item.msg.sql"
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
      </template>
    </div>
    <div v-if="running" class="typing">正在思考…</div>
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
.typing {
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
</style>
