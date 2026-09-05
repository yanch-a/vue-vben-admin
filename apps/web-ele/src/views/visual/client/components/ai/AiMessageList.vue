<script lang="ts" setup>
/**
 * 消息流
 * @author yanch
 */
import { nextTick, ref, watch } from 'vue';

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
watch(
  () => props.messages.map((m) => m.text + (m.sql?.sql || '') + (m.steps.length || 0)),
  () => nextTick(() => box.value && (box.value.scrollTop = box.value.scrollHeight)),
);
</script>

<template>
  <div ref="box" class="msg-list">
    <div v-if="!messages.length" class="empty">输入需求，让 AI 帮你写 SQL 或出图表</div>
    <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
      <template v-if="m.role === 'user'">
        <div class="bubble">{{ m.text }}</div>
      </template>
      <template v-else>
        <ElCollapse v-if="m.reasoning" class="reason">
          <ElCollapseItem title="思考过程" name="r">
            <pre>{{ m.reasoning }}</pre>
          </ElCollapseItem>
        </ElCollapse>
        <AiToolStepView v-for="s in m.steps" :key="s.callId" :step="s" />
        <template v-for="(p, i) in splitSqlBlocks(m.text)" :key="i">
          <div v-if="p.type === 'md'" class="md" v-html="p.html" />
          <AiSqlCard
            v-else
            :sql="p.sql"
            @insert="emit('insertSql', $event)"
            @replace="emit('replaceSql', $event)"
            @run="emit('runSql', $event)"
            @open-tab="emit('openSqlInNewTab', $event)"
          />
        </template>
        <AiSqlCard
          v-if="m.sql"
          :sql="m.sql.sql"
          :explanation="m.sql.explanation"
          :warnings="m.sql.warnings"
          :write-operation="m.sql.writeOperation"
          @insert="emit('insertSql', $event)"
          @replace="emit('replaceSql', $event)"
          @run="emit('runSql', $event)"
          @open-tab="emit('openSqlInNewTab', $event)"
        />
        <AiChartCard
          v-if="m.chart"
          :title="m.chart.title"
          :sql="m.chart.sql"
          :spec="m.chart.spec"
          :columns="m.chart.columns"
          :rows="m.chart.rows"
          :db-config-id="dbConfigId"
          :instance-name="instanceName"
          @open-sql="emit('openSqlInNewTab', $event)"
        />
        <div v-if="m.error" class="err">{{ m.error }}</div>
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
}
.empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 32px 8px;
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
}
.md :deep(p) {
  margin: 6px 0;
}
.err {
  color: var(--el-color-danger);
  font-size: 13px;
  margin-top: 6px;
}
.reason {
  margin-bottom: 6px;
}
.reason pre {
  white-space: pre-wrap;
  font-size: 12px;
}
.typing {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
