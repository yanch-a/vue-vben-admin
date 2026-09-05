<script lang="ts" setup>
/**
 * SQL 卡片：插入 / 替换 / 新 Tab / 运行 / 复制
 * 运行写操作前强制二次确认（不依赖后端 writeOperation 标记）
 * @author yanch
 */
import { computed } from 'vue';
import { ElMessage } from 'element-plus';

import { isWriteOrDangerousSql } from '../../utils/sqlWriteGuard';

defineOptions({ name: 'AiSqlCard' });

const props = defineProps<{
  sql: string;
  explanation?: string;
  warnings?: string[];
  writeOperation?: boolean;
}>();

const emit = defineEmits<{
  insert: [string];
  replace: [string];
  openTab: [string];
  run: [string];
}>();

/** 统一成可执行字符串，避免对象/空值进编辑器 */
const sqlText = computed(() => {
  const s = props.sql;
  if (s == null) return '';
  if (typeof s === 'string') return s;
  if (typeof s === 'object' && (s as any).sql) return String((s as any).sql);
  return String(s);
});

const canUse = computed(() => !!sqlText.value.trim());

/** 后端标记或本地检测：任一成立即按写操作处理 */
const isWrite = computed(
  () => !!props.writeOperation || isWriteOrDangerousSql(sqlText.value),
);

function requireSql(): string | null {
  const s = sqlText.value.trim();
  if (!s) {
    ElMessage.warning('没有可操作的 SQL');
    return null;
  }
  return s;
}

async function copy() {
  const s = requireSql();
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
    ElMessage.success('已复制 SQL');
  } catch {
    ElMessage.error('复制失败');
  }
}

function onInsert() {
  const s = requireSql();
  if (s) emit('insert', s);
}

function onReplace() {
  const s = requireSql();
  if (s) emit('replace', s);
}

function onOpenTab() {
  const s = requireSql();
  if (s) emit('openTab', s);
}

async function onRun() {
  const s = requireSql();
  if (!s) return;
  // 写操作确认统一在父级 runFreeDml / runControlledDdl / onAiRunSql 中处理，避免弹两次
  emit('run', s);
}
</script>

<template>
  <div class="ai-sql-card" :class="{ write: isWrite }">
    <div v-if="isWrite" class="write-tip">写操作 / 危险语句 — 运行前需确认</div>
    <pre class="sql">{{ sqlText || '（空 SQL）' }}</pre>
    <p v-if="explanation" class="exp">{{ explanation }}</p>
    <ul v-if="warnings?.length" class="warn">
      <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
    </ul>
    <div class="btns">
      <ElButton size="small" :disabled="!canUse" @click="onInsert">插入</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="onReplace">替换</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="onOpenTab">新 Tab</ElButton>
      <ElButton size="small" type="primary" :disabled="!canUse" @click="onRun">运行</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="copy">复制</ElButton>
    </div>
  </div>
</template>

<style scoped>
.ai-sql-card {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 8px;
  background: var(--el-fill-color-lighter);
  margin: 8px 0;
}
.ai-sql-card.write {
  border-color: var(--el-color-danger);
}
.write-tip {
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-color-danger);
  margin-bottom: 6px;
  font-weight: 600;
}
.sql {
  margin: 0;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--vc-ai-font-size-sm, 12px);
  white-space: pre-wrap;
  word-break: break-all;
}
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
.btns {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}
</style>
