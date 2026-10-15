<script lang="ts" setup>
/**
 * 单个工具调用步骤。
 * 折叠行显示中文工具名 + 关键参数；展开后按工具类型做可读展示：
 * - explain_sql：结论 + 分级告警（含建议）+ 计划大纲
 * - profile_table：行数 + 各列统计表（空值率 / 去重数 / 唯一度 / min-max / 取值分布）
 * - 其它带 rows/columns 的结果：表格；否则 JSON
 * @author yanch
 */
import { computed, ref } from 'vue';

import type { AiToolStep } from '../../composables/useAiChat';

defineOptions({ name: 'AiToolStep' });

const props = defineProps<{ step: AiToolStep }>();
const open = ref(false);

/** 工具名 → 中文说明（未知工具回退原名） */
const TOOL_LABELS: Record<string, string> = {
  list_tables: '列出表',
  search_columns: '搜索字段',
  get_schema_docs: '读取结构文档',
  get_agent_memory: '读取记忆',
  get_table_schema: '读取表结构',
  get_table_ddl: '读取建表语句',
  get_table_relationships: '读取表关联',
  sample_rows: '查看样例行',
  profile_table: '表数据画像',
  run_sql: '执行验证',
  explain_sql: '分析执行计划',
  get_query_history: '查询历史 SQL',
  list_saved_queries: '已保存查询',
  resolve_catalog_fields: '解析目录字段',
  propose_sql: '提交 SQL',
  propose_query_config: '提交查询配置',
  propose_etl_config: '提交 ETL 配置',
  inspect_etl_source: '检查 ETL 数据源',
  inspect_etl_import: '检查 ETL 导入',
  render_chart: '渲染图表',
  save_schema_doc_note: '写入文档笔记',
};

const label = computed(() => TOOL_LABELS[props.step.name] || props.step.name);

/** 折叠行里的参数摘要：优先显示表名 / SQL 首行 / 关键字 */
const summary = computed(() => {
  const a = props.step.arguments;
  if (!a || typeof a !== 'object') return '';
  const pick = (v: unknown) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(String).join(', ');
    const s = String(v).trim();
    const firstLine = s.split(/\r?\n/)[0] || '';
    return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
  };
  const preferred = ['table', 'tables', 'sql', 'keywords', 'keyword', 'title'];
  for (const k of preferred) {
    if (a[k] != null && a[k] !== '') return pick(a[k]);
  }
  return Object.values(a).slice(0, 3).map(pick).filter(Boolean).join(', ');
});

const data = computed(() => props.step.data);
const kind = computed(() => {
  const d = data.value;
  if (!d || typeof d !== 'object') return 'raw';
  if (d.kind === 'explain') return 'explain';
  if (d.kind === 'profile') return 'profile';
  if (Array.isArray(d.rows) && Array.isArray(d.columns)) return 'table';
  return 'raw';
});

const tableRows = computed(() => {
  const d = data.value;
  if (kind.value !== 'table') return null;
  return { columns: d.columns as string[], rows: d.rows.slice(0, 20) };
});

/** explain 告警按级别着色 */
function levelType(level: string) {
  if (level === 'HIGH') return 'danger';
  if (level === 'MEDIUM') return 'warning';
  return 'info';
}

function fmtNum(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v == null ? '' : String(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtPct(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n}%` : '';
}

function fmtTop(list: unknown) {
  if (!Array.isArray(list)) return '';
  return list
    .filter((x) => x && typeof x === 'object' && !('error' in x))
    .map((x: any) => `${x.value == null ? 'NULL' : x.value}×${fmtNum(x.count)}`)
    .join('  ');
}
</script>

<template>
  <div class="step">
    <div class="line" @click="open = !open">
      🔧 {{ $tr(label) }}<span v-if="summary" class="args">（{{ summary }}）</span>
      <span v-if="step.elapsedMs != null"> · {{ step.elapsedMs }}ms</span>
      <span v-if="step.ok === true" class="ok"> ✓</span>
      <span v-else-if="step.ok === false" class="bad"> ✗</span>
      <template v-if="kind === 'explain' && data?.verdict && !open">
        <span class="verdict"> · {{ data.verdict }}</span>
      </template>
      <template v-else-if="kind === 'profile' && !open">
        <span class="verdict"> · {{ $tr('约') }} {{ fmtNum(data.totalRows) }} {{ $tr('行') }}</span>
      </template>
    </div>
    <div v-if="open" class="detail">
      <pre class="args-pre">{{ JSON.stringify(step.arguments, null, 2) }}</pre>

      <!-- 执行计划 -->
      <template v-if="kind === 'explain'">
        <div class="verdict-line">
          <strong>{{ data.verdict }}</strong>
          <span v-if="data.engine" class="muted"> · {{ data.engine }}</span>
        </div>
        <ul v-if="data.warnings?.length" class="warn-list">
          <li v-for="(w, i) in data.warnings" :key="i">
            <ElTag size="small" :type="levelType(w.level)" effect="plain">{{ w.level }}</ElTag>
            <span class="warn-msg">{{ w.message }}</span>
            <div v-if="w.suggestion" class="warn-sug">{{ w.suggestion }}</div>
          </li>
        </ul>
        <pre v-if="data.planOutline" class="outline">{{ data.planOutline }}</pre>
        <details v-if="data.rawText">
          <summary>{{ $tr('原始计划输出') }}</summary>
          <pre>{{ data.rawText }}</pre>
        </details>
      </template>

      <!-- 表数据画像 -->
      <template v-else-if="kind === 'profile'">
        <div class="verdict-line">
          <strong>{{ data.table }}</strong>
          <span class="muted">
            · {{ $tr('约') }} {{ fmtNum(data.totalRows) }} {{ $tr('行') }} ·
            {{ $tr('已画像') }} {{ data.profiledColumns }}/{{ data.totalColumns }} {{ $tr('列') }}
          </span>
        </div>
        <ElTable :data="data.columns || []" size="small" max-height="260" border>
          <ElTableColumn prop="name" :label="$tr('列')" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span :class="{ pk: row.pk }">{{ row.name }}</span>
              <span class="muted type"> {{ row.type }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="$tr('空值率')" width="80">
            <template #default="{ row }">{{ row.error ? '—' : fmtPct(row.nullRate) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="$tr('去重数')" width="80">
            <template #default="{ row }">{{ row.distinct == null ? '—' : fmtNum(row.distinct) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="$tr('唯一度')" width="72">
            <template #default="{ row }">{{ row.uniqueness == null ? '—' : row.uniqueness }}</template>
          </ElTableColumn>
          <ElTableColumn :label="$tr('范围 / 取值')" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.error" class="bad">{{ row.error }}</span>
              <span v-else-if="row.topValues?.length">{{ fmtTop(row.topValues) }}</span>
              <span v-else-if="row.topValuesMasked" class="muted">{{ $tr('低基数列（脱敏，未返回取值）') }}</span>
              <span v-else-if="row.min != null || row.max != null">{{ row.min }} ~ {{ row.max }}</span>
            </template>
          </ElTableColumn>
        </ElTable>
        <ul v-if="data.notes?.length" class="notes">
          <li v-for="(n, i) in data.notes" :key="i">{{ n }}</li>
        </ul>
      </template>

      <!-- 通用结果集 -->
      <ElTable v-else-if="tableRows" :data="tableRows.rows" size="small" max-height="220" border>
        <ElTableColumn
          v-for="c in tableRows.columns"
          :key="c"
          :prop="c"
          :label="c"
          min-width="90"
          show-overflow-tooltip
        />
      </ElTable>
      <pre v-else-if="step.data">{{ typeof step.data === 'string' ? step.data : JSON.stringify(step.data, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.line {
  cursor: pointer;
  font-size: var(--vc-ai-font-size-sm, 12px);
  color: var(--el-text-color-secondary);
  padding: 2px 0;
}
.args {
  font-family: ui-monospace, Consolas, monospace;
}
.ok {
  color: var(--el-color-success);
}
.bad {
  color: var(--el-color-danger);
}
.verdict {
  color: var(--el-text-color-regular);
}
.detail pre {
  font-size: var(--vc-ai-font-size-xs, 11px);
  white-space: pre-wrap;
  margin: 4px 0;
  max-height: 160px;
  overflow: auto;
}
.detail .args-pre {
  max-height: 90px;
  opacity: 0.8;
}
.verdict-line {
  margin: 6px 0 4px;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.muted {
  color: var(--el-text-color-secondary);
}
.type {
  font-size: 11px;
}
.pk {
  font-weight: 600;
}
.warn-list {
  margin: 4px 0;
  padding-left: 0;
  list-style: none;
  font-size: var(--vc-ai-font-size-sm, 12px);
}
.warn-list li {
  margin: 4px 0;
}
.warn-msg {
  margin-left: 6px;
}
.warn-sug {
  margin: 2px 0 0 0;
  padding-left: 6px;
  border-left: 2px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
}
.outline {
  background: var(--el-fill-color-light);
  padding: 6px;
  border-radius: 4px;
  max-height: 220px !important;
}
.notes {
  margin: 6px 0 0;
  padding-left: 16px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
</style>
