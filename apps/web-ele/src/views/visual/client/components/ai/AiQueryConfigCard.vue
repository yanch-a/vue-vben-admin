<script lang="ts" setup>
/**
 * 配置查询卡片：把 AI 勾选应用到视图界面，也可把预览 SQL 打开编辑器。
 * @author yanch
 */
import { computed } from 'vue';
import { ElMessage } from 'element-plus';

import type { AiMsg } from '../../composables/useAiChat';

defineOptions({ name: 'AiQueryConfigCard' });

const props = defineProps<{
  config: NonNullable<AiMsg['queryConfig']>;
}>();

const emit = defineEmits<{
  apply: [NonNullable<AiMsg['queryConfig']>];
  openSql: [string];
}>();

const previewSql = computed(() => (props.config.previewSql || '').trim());

const summary = computed(() => {
  const c = props.config;
  const parts = [
    `${(c.columnItems || []).length} 个字段`,
    (c.whereItems || []).length ? `${c.whereItems!.length} 个条件` : '',
    (c.havingItems || []).length ? `${c.havingItems!.length} 个 HAVING` : '',
    (c.groupItems || []).length ? `${c.groupItems!.length} 个分组` : '',
    (c.orderItems || []).length ? `${c.orderItems!.length} 个排序` : '',
  ];
  return parts.filter(Boolean).join(' · ');
});

function onApply() {
  emit('apply', props.config);
}

function onOpenSql() {
  if (!previewSql.value) {
    ElMessage.warning('没有可打开的预览 SQL');
    return;
  }
  emit('openSql', previewSql.value);
}

async function copySql() {
  if (!previewSql.value) {
    ElMessage.warning('没有可复制的 SQL');
    return;
  }
  try {
    await navigator.clipboard.writeText(previewSql.value);
    ElMessage.success('已复制预览 SQL');
  } catch {
    ElMessage.error('复制失败');
  }
}
</script>

<template>
  <div class="ai-cfg-card">
    <div class="title">{{ $tr('查询视图配置') }}</div>
    <p v-if="summary" class="sum">{{ summary }}</p>
    <p v-if="config.explanation" class="exp">{{ config.explanation }}</p>
    <ul v-if="config.warnings?.length" class="warn">
      <li v-for="(w, i) in config.warnings" :key="i">{{ w }}</li>
    </ul>
    <pre v-if="previewSql" class="sql">{{ previewSql }}</pre>
    <div class="btns">
      <ElButton size="small" type="primary" @click="onApply">{{ $tr('应用到界面') }}</ElButton>
      <ElButton size="small" :disabled="!previewSql" @click="onOpenSql">{{ $tr('用 SQL 打开编辑器') }}</ElButton>
      <ElButton size="small" :disabled="!previewSql" @click="copySql">{{ $tr('复制 SQL') }}</ElButton>
    </div>
  </div>
</template>

<style scoped>
.ai-cfg-card {
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 6px;
  padding: 8px;
  background: var(--el-fill-color-lighter);
  margin: 8px 0;
}
.title {
  font-size: var(--vc-ai-font-size, 13px);
  font-weight: 600;
}
.sum,
.exp {
  margin: 6px 0 0;
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
}
.warn {
  margin: 4px 0 0;
  padding-left: 18px;
  color: var(--el-color-warning);
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.sql {
  margin: 8px 0 0;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--vc-ai-font-size-sm, 12px);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
}
.btns {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}
</style>
