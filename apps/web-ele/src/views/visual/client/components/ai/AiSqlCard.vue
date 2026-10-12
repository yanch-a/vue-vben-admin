<script lang="ts" setup>
/**
 * SQL 卡片：插入 / 替换 / 新 Tab / 运行 / 复制
 * - 运行写操作前强制二次确认（不依赖后端 writeOperation 标记）
 * - 显示服务端校验状态：已预校验（run_sql / EXPLAIN）、预计影响 N 行、校验未通过、未校验
 * - 有原 SQL（用户选中后让 AI 优化/修复）时可切换「对比」视图，行级高亮增删
 * @author yanch
 */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';

import type { ProposedSqlValidation } from '#/api/ai/agent';

import { diffSqlLines, summarizeDiff } from '../../utils/sqlDiff';
import { isWriteOrDangerousSql } from '../../utils/sqlWriteGuard';

defineOptions({ name: 'AiSqlCard' });

const props = defineProps<{
  sql: string;
  explanation?: string;
  warnings?: string[];
  writeOperation?: boolean;
  validation?: ProposedSqlValidation;
  /** 发送时用户选中的 SQL；存在时提供对比视图 */
  originalSql?: string;
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

/** 校验徽标文案与类型 */
const validationBadge = computed(() => {
  const v = props.validation;
  if (!v) return null;
  const rows =
    v.estimatedRows != null ? formatRows(v.estimatedRows) : undefined;
  switch (v.status) {
    case 'passed':
      return {
        type: 'success' as const,
        text:
          v.method === 'run_sql'
            ? '已执行验证'
            : rows
              ? `已预校验 · 约 ${rows} 行`
              : '已预校验',
        title:
          v.method === 'run_sql'
            ? 'AI 已在本轮用 run_sql 真实执行过这条 SQL'
            : '服务端已用 EXPLAIN 干跑，语法与表/列引用均可通过',
      };
    case 'estimated':
      return {
        type: 'warning' as const,
        text: rows ? `预计影响约 ${rows} 行` : '已评估影响范围',
        title: '基于执行计划的优化器估算，执行前请核对 WHERE 条件',
      };
    case 'failed':
      return {
        type: 'danger' as const,
        text: '预校验未通过',
        title: v.message || '服务端 EXPLAIN 干跑失败，请人工核对',
      };
    default:
      return {
        type: 'info' as const,
        text: '未校验',
        title: v.reason || '本条 SQL 未经服务端预执行',
      };
  }
});

function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

// ───────────── 对比视图 ─────────────
const showDiff = ref(false);
const hasOriginal = computed(
  () => !!props.originalSql?.trim() && props.originalSql.trim() !== sqlText.value.trim(),
);
const diffLines = computed(() =>
  hasOriginal.value ? diffSqlLines(props.originalSql || '', sqlText.value) : [],
);
const diffSummary = computed(() => summarizeDiff(diffLines.value));

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
    <div class="head">
      <span v-if="isWrite" class="write-tip">{{ $tr('写操作 / 危险语句 — 运行前需确认') }}</span>
      <span v-else class="head-spacer" />
      <ElTag
        v-if="validationBadge"
        size="small"
        :type="validationBadge.type"
        effect="plain"
        class="badge"
        :title="validationBadge.title"
      >
        {{ $tr(validationBadge.text) }}
      </ElTag>
      <ElTag
        v-if="hasOriginal"
        size="small"
        :effect="showDiff ? 'dark' : 'plain'"
        class="badge toggle"
        :title="$tr('与发送时选中的 SQL 逐行对比')"
        @click="showDiff = !showDiff"
      >
        {{ $tr(showDiff ? '收起对比' : '对比原 SQL') }}
        <span class="diff-sum">+{{ diffSummary.added }} / -{{ diffSummary.removed }}</span>
      </ElTag>
    </div>
    <pre v-if="!showDiff" class="sql">{{ sqlText || '（空 SQL）' }}</pre>
    <pre v-else class="sql diff"><span
      v-for="(l, i) in diffLines"
      :key="i"
      class="dl"
      :class="l.type"
    >{{ l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  ' }}{{ l.text }}
</span></pre>
    <p v-if="explanation" class="exp">{{ explanation }}</p>
    <ul v-if="warnings?.length" class="warn">
      <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
    </ul>
    <div class="btns">
      <ElButton size="small" :disabled="!canUse" @click="onInsert">{{ $tr('插入') }}</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="onReplace">{{ $tr('替换') }}</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="onOpenTab">{{ $tr('新 Tab') }}</ElButton>
      <ElButton size="small" type="primary" :disabled="!canUse" @click="onRun">{{ $tr('运行') }}</ElButton>
      <ElButton size="small" :disabled="!canUse" @click="copy">{{ $tr('复制') }}</ElButton>
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
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.head-spacer {
  flex: 1;
}
.write-tip {
  flex: 1;
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-color-danger);
  font-weight: 600;
}
.badge.toggle {
  cursor: pointer;
}
.diff-sum {
  margin-left: 4px;
  opacity: 0.8;
  font-family: ui-monospace, Consolas, monospace;
}
.sql {
  margin: 0;
  font-family: ui-monospace, Consolas, monospace;
  font-size: var(--vc-ai-font-size-sm, 12px);
  white-space: pre-wrap;
  word-break: break-all;
}
.sql.diff .dl {
  display: block;
  padding: 0 4px;
  border-radius: 2px;
}
.sql.diff .dl.add {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}
.sql.diff .dl.del {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-dark-2);
  text-decoration: line-through;
  text-decoration-color: var(--el-color-danger-light-5);
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
