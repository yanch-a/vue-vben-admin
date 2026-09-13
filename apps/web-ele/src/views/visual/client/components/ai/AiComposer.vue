<script lang="ts" setup>
/**
 * 输入框 + 场景。scene 随 send 进入 AgentChatRequest，后端 PromptBuilder 按场景加收尾规则。
 * @author yanch
 */
import { computed, ref } from 'vue';

import type { AgentScene } from '#/api/ai/agent';

defineOptions({ name: 'AiComposer' });

const props = defineProps<{
  scene: AgentScene;
  running: boolean;
  hasSelection?: boolean;
  hasError?: boolean;
}>();

const emit = defineEmits<{
  'update:scene': [AgentScene];
  send: [string];
  stop: [];
  clearSelection: [];
  clearError: [];
}>();

const text = ref('');
const scene = computed({
  get: () => props.scene,
  set: (v: AgentScene) => emit('update:scene', v),
});

const chips = [
  { label: '生成 SQL', scene: 'sql' as AgentScene, tpl: '请根据需求编写 SQL：' },
  { label: '优化这段 SQL', scene: 'sql' as AgentScene, tpl: '请优化这段 SQL，并用 explain_sql 对比改写前后的执行计划。' },
  { label: '解释这段 SQL', scene: 'sql' as AgentScene, tpl: '请解释这段 SQL 在做什么。' },
  { label: '修复报错', scene: 'sql' as AgentScene, tpl: '请根据报错修复 SQL。' },
  { label: '生成图表', scene: 'chart' as AgentScene, tpl: '请根据需求生成统计图表：' },
  { label: '写表说明文档', scene: 'schema_doc' as AgentScene, tpl: '请为相关表补充结构说明文档。' },
];

function applyChip(c: (typeof chips)[number]) {
  scene.value = c.scene;
  text.value = c.tpl;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
}
function doSend() {
  const t = text.value.trim();
  if (!t || props.running) return;
  emit('send', t);
  text.value = '';
}

function setText(t: string) {
  text.value = t || '';
}

defineExpose({ setText });
</script>

<template>
  <div class="composer">
    <div class="chips">
      <ElTag
        v-for="c in chips"
        :key="c.label"
        size="small"
        class="chip"
        effect="plain"
        @click="applyChip(c)"
      >
        {{ c.label }}
      </ElTag>
    </div>
    <div class="row">
      <ElRadioGroup v-model="scene" size="small">
        <ElRadioButton label="sql" value="sql">SQL</ElRadioButton>
        <ElRadioButton label="chart" value="chart">{{ $tr('图表') }}</ElRadioButton>
        <ElRadioButton label="free" value="free">{{ $tr('自由') }}</ElRadioButton>
        <ElRadioButton label="schema_doc" value="schema_doc">{{ $tr('文档') }}</ElRadioButton>
      </ElRadioGroup>
      <ElTag v-if="hasSelection" size="small" closable @close="emit('clearSelection')">{{ $tr('已附带选中 SQL') }}</ElTag>
      <ElTag v-if="hasError" size="small" type="danger" closable @close="emit('clearError')">{{ $tr('已附带报错') }}</ElTag>
    </div>
    <ElInput
      v-model="text"
      type="textarea"
      :rows="3"
      :placeholder="$tr('描述你的需求，Enter 发送，Shift+Enter 换行')"
      @keydown="onKey"
    />
    <div class="actions">
      <span v-if="running" class="run-hint">{{ $tr('运行中，可随时停止') }}</span>
      <ElButton v-if="running" size="small" type="danger" @click="emit('stop')">{{ $tr('停止') }}</ElButton>
      <ElButton v-else size="small" type="primary" :disabled="!text.trim()" @click="doSend">{{ $tr('发送') }}</ElButton>
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
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
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
