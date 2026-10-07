<script lang="ts" setup>
/**
 * 可视化执行计划面板（结果区「执行计划」页签）
 * - 计划树：缩进树 + 代价 / 耗时占比条，热点节点高亮，可折叠
 * - 节点详情：选中节点的代价、行数、条件及引擎原始属性
 * - 告警：按级别列出问题与优化建议，点击定位到节点
 * - 原始输出：引擎返回的 JSON / 文本，可复制
 * - ANALYZE 开关：真实执行只读查询拿实际行数与耗时（生产连接由父级二次确认）
 *
 * @author yanch
 */
import type { ExplainPlanNode, ExplainPlanState, ExplainPlanWarning } from '../../utils/explainPlan';

import { computed, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import {
  accessTypeTagType,
  accessTypeText,
  ancestorIds,
  flattenPlan,
  formatPlanMs,
  formatPlanNumber,
  indexPlanNodes,
  planBarPercent,
  planNodeDetailFields,
  planNodeLabel,
  warningLevelText,
  warningSuggestion,
  warningTagType,
  warningTitle,
} from '../../utils/explainPlan';

defineOptions({ name: 'ExplainPlanPanel' });

const props = defineProps<{
  state: ExplainPlanState | null;
  /** 当前库是否支持 ANALYZE */
  canAnalyze?: boolean;
  /** 当前连接是否生产环境（开关旁提示） */
  prod?: boolean;
  /** AI 助手可用时显示「让 AI 优化」 */
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  /** 重新分析（可切换 ANALYZE） */
  rerun: [{ analyze: boolean }];
  /** 把 SQL + 计划交给 AI 助手 */
  askAi: [];
}>();

const view = ref<'raw' | 'tree'>('tree');
const collapsed = ref<Set<string>>(new Set());
const selectedId = ref<string | null>(null);
const analyzeToggle = ref(false);
const warningsOpen = ref(true);

const result = computed(() => props.state?.result ?? null);
const loading = computed(() => !!props.state?.loading);
const root = computed(() => result.value?.root ?? null);
const analyzed = computed(() => !!result.value?.analyzed);
const nodeIndex = computed(() => indexPlanNodes(root.value));
const rows = computed(() => flattenPlan(root.value, collapsed.value));
const warnings = computed<ExplainPlanWarning[]>(() => result.value?.warnings ?? []);
const selected = computed<ExplainPlanNode | null>(() =>
  selectedId.value ? (nodeIndex.value.get(selectedId.value) ?? null) : null,
);
const selectedFields = computed(() => (selected.value ? planNodeDetailFields(selected.value) : []));
const selectedAttributes = computed(() => {
  const attrs = selected.value?.attributes ?? {};
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));
});
const selectedWarnings = computed(() =>
  selected.value ? warnings.value.filter((w) => w.nodeId === selected.value?.id) : [],
);
const showTree = computed(() => view.value === 'tree' && !!result.value?.structured && !!root.value);
const highCount = computed(() => warnings.value.filter((w) => w.level === 'HIGH').length);

watch(
  () => props.state?.result,
  (next) => {
    collapsed.value = new Set();
    // 默认选中第一个热点，没有就选根节点
    const first = flattenPlan(next?.root).find((r) => r.node.hotspot)?.node ?? next?.root ?? null;
    selectedId.value = first?.id ?? null;
    view.value = next && !next.structured ? 'raw' : 'tree';
  },
  { immediate: true },
);

watch(
  () => props.state?.analyze,
  (v) => {
    analyzeToggle.value = !!v;
  },
  { immediate: true },
);

function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

function expandAll() {
  collapsed.value = new Set();
}

function focusNode(id?: string) {
  if (!id || !root.value) return;
  const ancestors = ancestorIds(root.value, id);
  if (ancestors.length) {
    const next = new Set(collapsed.value);
    for (const a of ancestors) next.delete(a);
    collapsed.value = next;
  }
  view.value = 'tree';
  selectedId.value = id;
}

function onRerun() {
  emit('rerun', { analyze: analyzeToggle.value && !!props.canAnalyze });
}

function rowBar(node: ExplainPlanNode) {
  return planBarPercent(node, analyzed.value);
}

function rowMetric(node: ExplainPlanNode): string {
  if (analyzed.value && node.actualTimeMs != null) return formatPlanMs(node.actualTimeMs);
  if (node.estCost != null) return formatPlanNumber(node.estCost);
  return '';
}

function rowRows(node: ExplainPlanNode): string {
  if (analyzed.value && node.actualRows != null) {
    const loops = node.loops && node.loops > 1 ? ` ×${node.loops}` : '';
    return `${formatPlanNumber(node.actualRows)}${loops}`;
  }
  return node.estRows == null ? '' : formatPlanNumber(node.estRows);
}

async function copyRaw() {
  const text = result.value?.rawText || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制原始执行计划');
  } catch {
    ElMessage.error('复制失败，请手动选择文本复制');
  }
}
</script>

<template>
  <div class="explain-panel">
    <div v-if="!state" class="plan-empty">
      {{ $tr('选中 SELECT 语句后点击「执行计划」或按 Ctrl+Shift+E 查看执行计划') }}
    </div>
    <template v-else>
      <div class="plan-toolbar">
        <ElTag v-if="result?.engine || result?.dbType" size="small" effect="plain" type="info">
          {{ result?.engine || result?.dbType }}
        </ElTag>
        <ElTag v-if="result?.explainCommand" size="small" effect="plain">
          {{ result?.explainCommand }}
        </ElTag>
        <ElTag v-if="analyzed" size="small" type="warning">ANALYZE</ElTag>
        <ElTag v-if="result?.statementKind === 'DML'" size="small" type="info">
          {{ $tr('DML 仅生成计划，未执行') }}
        </ElTag>
        <span v-if="result?.structured" class="plan-meta">
          <span v-if="result?.totalCost != null">{{ $tr('总代价') }} {{ formatPlanNumber(result?.totalCost) }}</span>
          <span v-if="result?.nodeCount">{{ $tr('节点') }} {{ result?.nodeCount }}</span>
          <span v-if="result?.executionTimeMs != null">
            {{ $tr('执行耗时') }} {{ formatPlanMs(result?.executionTimeMs) }}
          </span>
          <span v-if="result?.planningTimeMs != null">
            {{ $tr('规划耗时') }} {{ formatPlanMs(result?.planningTimeMs) }}
          </span>
          <span v-if="result?.elapsedMs != null">{{ $tr('取计划耗时') }} {{ result?.elapsedMs }} ms</span>
        </span>
        <span class="plan-spacer" />
        <ElTooltip
          :content="$tr(canAnalyze ? (prod ? 'ANALYZE 会真实执行查询（生产环境需确认），仅允许只读 SELECT' : 'ANALYZE 会真实执行查询，获取实际行数与耗时，仅允许只读 SELECT') : '当前数据库不支持 ANALYZE')"
          placement="top"
        >
          <ElCheckbox v-model="analyzeToggle" size="small" :disabled="!canAnalyze || loading">
            {{ $tr('ANALYZE（实际执行）') }}
          </ElCheckbox>
        </ElTooltip>
        <ElButton size="small" :loading="loading" :disabled="!state.sql" @click="onRerun">
          {{ $tr('重新分析') }}
        </ElButton>
        <ElRadioGroup v-model="view" size="small" :disabled="!result">
          <ElRadioButton value="tree" :disabled="!result?.structured">{{ $tr('计划树') }}</ElRadioButton>
          <ElRadioButton value="raw">{{ $tr('原始输出') }}</ElRadioButton>
        </ElRadioGroup>
        <ElButton
          v-if="aiEnabled"
          size="small"
          type="primary"
          plain
          :disabled="!result || loading"
          @click="emit('askAi')"
        >
          {{ $tr('让 AI 优化') }}
        </ElButton>
      </div>

      <div v-loading="loading" class="plan-body">
        <div v-if="state.error" class="plan-error">{{ $tr(state.error) }}</div>
        <template v-else-if="result">
          <div v-if="!result.supported" class="plan-notice">
            {{ result.message ? $tr(result.message) : $tr('当前数据库类型不支持可视化执行计划') }}
          </div>
          <div v-else-if="result.message && !result.structured" class="plan-notice">
            {{ $tr(result.message) }}
          </div>
          <div v-for="(note, i) in result.notes || []" :key="i" class="plan-note">{{ $tr(note) }}</div>

          <section v-if="warnings.length && showTree" class="plan-warnings">
            <header class="plan-warnings-head" @click="warningsOpen = !warningsOpen">
              <span>{{ warningsOpen ? '▾' : '▸' }}</span>
              <span>{{ $tr('发现问题') }} {{ warnings.length }}</span>
              <ElTag v-if="highCount" size="small" type="danger" effect="dark">
                {{ $tr('高危') }} {{ highCount }}
              </ElTag>
            </header>
            <ul v-show="warningsOpen" class="plan-warning-list">
              <li
                v-for="(w, i) in warnings"
                :key="`${w.code}-${w.nodeId}-${i}`"
                class="plan-warning"
                :class="{ active: w.nodeId && w.nodeId === selectedId }"
                @click="focusNode(w.nodeId)"
              >
                <ElTag size="small" :type="warningTagType(w.level)" effect="light">
                  {{ $tr(warningLevelText(w.level)) }}
                </ElTag>
                <span class="plan-warning-title">{{ $tr(warningTitle(w)) }}</span>
                <span v-if="w.objectName" class="plan-warning-obj">{{ w.objectName }}</span>
                <span v-if="w.rows != null" class="plan-warning-obj">≈{{ formatPlanNumber(w.rows) }} {{ $tr('行') }}</span>
                <span class="plan-warning-sug">{{ $tr(warningSuggestion(w)) }}</span>
              </li>
            </ul>
          </section>

          <div v-if="showTree" class="plan-main">
            <div class="plan-tree">
              <div class="plan-tree-head">
                <span class="col-op">{{ $tr('算子') }}</span>
                <span class="col-access">{{ $tr('访问方式') }}</span>
                <span class="col-rows">{{ $tr(analyzed ? '实际行数' : '估算行数') }}</span>
                <span class="col-metric">{{ $tr(analyzed ? '耗时' : '代价') }}</span>
                <span class="col-bar">
                  {{ $tr(analyzed ? '自身耗时占比' : '自身代价占比') }}
                  <ElButton link size="small" @click="expandAll">{{ $tr('全部展开') }}</ElButton>
                </span>
              </div>
              <div
                v-for="row in rows"
                :key="row.node.id"
                class="plan-row"
                :class="{
                  selected: row.node.id === selectedId,
                  hotspot: row.node.hotspot,
                  warned: !!row.node.warningCodes?.length,
                }"
                @click="selectedId = row.node.id"
              >
                <span class="col-op" :style="{ paddingLeft: `${row.depth * 16 + 4}px` }">
                  <span
                    class="twisty"
                    :class="{ leaf: !row.hasChildren }"
                    @click.stop="row.hasChildren && toggle(row.node.id)"
                  >{{ row.hasChildren ? (row.expanded ? '▾' : '▸') : '·' }}</span>
                  <span class="op-text" :title="row.node.detail || row.node.operation">{{ planNodeLabel(row.node) }}</span>
                  <span v-if="row.node.indexName" class="op-index" :title="row.node.indexName">{{ row.node.indexName }}</span>
                  <span v-if="row.node.hotspot" class="op-flag hot">{{ $tr('热点') }}</span>
                  <span v-if="row.node.warningCodes?.length" class="op-flag warn">⚠ {{ row.node.warningCodes.length }}</span>
                </span>
                <span class="col-access">
                  <ElTag
                    v-if="row.node.accessType && row.node.accessType !== 'OTHER'"
                    size="small"
                    :type="accessTypeTagType(row.node.accessType)"
                    effect="plain"
                  >
                    {{ $tr(accessTypeText(row.node.accessType)) }}
                  </ElTag>
                </span>
                <span class="col-rows">{{ rowRows(row.node) }}</span>
                <span class="col-metric">{{ rowMetric(row.node) }}</span>
                <span class="col-bar">
                  <span v-if="rowBar(row.node) != null" class="bar-track">
                    <span
                      class="bar-fill"
                      :class="{ hot: row.node.hotspot }"
                      :style="{ width: `${rowBar(row.node)}%` }"
                    />
                  </span>
                  <span v-if="rowBar(row.node) != null" class="bar-text">{{ rowBar(row.node) }}%</span>
                </span>
              </div>
            </div>
            <aside class="plan-detail">
              <template v-if="selected">
                <div class="detail-title">{{ planNodeLabel(selected) }}</div>
                <div v-for="w in selectedWarnings" :key="w.code" class="detail-warning">
                  <ElTag size="small" :type="warningTagType(w.level)">{{ $tr(warningTitle(w)) }}</ElTag>
                  <div class="detail-warning-text">{{ $tr(warningSuggestion(w)) }}</div>
                </div>
                <dl class="detail-list">
                  <template v-for="f in selectedFields" :key="f.label">
                    <dt>{{ $tr(f.label) }}</dt>
                    <dd>{{ f.value }}</dd>
                  </template>
                </dl>
                <details v-if="selectedAttributes.length" class="detail-attrs">
                  <summary>{{ $tr('引擎原始属性') }} ({{ selectedAttributes.length }})</summary>
                  <dl class="detail-list">
                    <template v-for="a in selectedAttributes" :key="a.key">
                      <dt>{{ a.key }}</dt>
                      <dd>{{ a.value }}</dd>
                    </template>
                  </dl>
                </details>
              </template>
              <div v-else class="plan-empty">{{ $tr('点击左侧节点查看详情') }}</div>
            </aside>
          </div>

          <div v-else-if="view === 'raw' || !result.structured" class="plan-raw-wrap">
            <div class="plan-raw-actions">
              <ElButton link size="small" :disabled="!result.rawText" @click="copyRaw">
                {{ $tr('复制') }}
              </ElButton>
            </div>
            <pre class="plan-raw">{{ result.rawText || $tr('没有原始输出') }}</pre>
          </div>
        </template>
        <div v-else-if="!loading" class="plan-empty">{{ $tr('暂无执行计划') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.explain-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  font-size: var(--vc-ui-font-size-sm, 12px);
}
.plan-toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.plan-meta {
  display: inline-flex;
  gap: 10px;
  color: var(--el-text-color-secondary);
}
.plan-spacer {
  flex: 1;
}
.plan-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.plan-empty,
.plan-notice,
.plan-note,
.plan-error {
  padding: 10px 12px;
  color: var(--el-text-color-secondary);
}
.plan-error {
  color: var(--el-color-danger);
  white-space: pre-wrap;
}
.plan-notice {
  color: var(--el-color-warning);
}
.plan-note {
  padding: 2px 12px;
  font-size: 11px;
}
.plan-warnings {
  flex: none;
  margin: 6px 10px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
.plan-warnings-head {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.plan-warning-list {
  max-height: 160px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.plan-warning {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  padding: 4px 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
  cursor: pointer;
}
.plan-warning:hover,
.plan-warning.active {
  background: var(--el-fill-color-light);
}
.plan-warning-title {
  font-weight: 600;
}
.plan-warning-obj {
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family-mono, monospace);
}
.plan-warning-sug {
  flex-basis: 100%;
  padding-left: 2px;
  color: var(--el-text-color-regular);
}
.plan-main {
  display: flex;
  flex: 1;
  gap: 0;
  min-height: 0;
  margin-top: 6px;
}
.plan-tree {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.plan-tree-head,
.plan-row {
  display: flex;
  align-items: center;
  min-height: 26px;
  padding-right: 8px;
}
.plan-tree-head {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.plan-row {
  border-bottom: 1px solid var(--el-border-color-extra-light);
  cursor: pointer;
}
.plan-row:hover {
  background: var(--el-fill-color-lighter);
}
.plan-row.hotspot {
  background: color-mix(in srgb, var(--el-color-danger) 7%, transparent);
}
.plan-row.selected {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.col-op {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  min-width: 220px;
  overflow: hidden;
  white-space: nowrap;
}
.col-access {
  flex: 0 0 96px;
}
.col-rows,
.col-metric {
  flex: 0 0 76px;
  text-align: right;
  font-family: var(--el-font-family-mono, monospace);
}
.col-bar {
  display: flex;
  flex: 0 0 170px;
  gap: 6px;
  align-items: center;
  padding-left: 12px;
}
.twisty {
  display: inline-block;
  width: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.twisty.leaf {
  opacity: 0.5;
}
.op-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.op-index {
  max-width: 160px;
  overflow: hidden;
  color: var(--el-color-success);
  text-overflow: ellipsis;
  font-family: var(--el-font-family-mono, monospace);
}
.op-flag {
  flex: none;
  padding: 0 4px;
  font-size: 11px;
  border-radius: 3px;
}
.op-flag.hot {
  color: #fff;
  background: var(--el-color-danger);
}
.op-flag.warn {
  color: var(--el-color-warning);
}
.bar-track {
  position: relative;
  flex: 1;
  height: 8px;
  overflow: hidden;
  background: var(--el-fill-color);
  border-radius: 4px;
}
.bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--el-color-primary-light-3);
  border-radius: 4px;
}
.bar-fill.hot {
  background: var(--el-color-danger);
}
.bar-text {
  flex: 0 0 42px;
  text-align: right;
  color: var(--el-text-color-secondary);
}
.plan-detail {
  flex: 0 0 320px;
  min-width: 0;
  padding: 8px 10px;
  overflow: auto;
  border-left: 1px solid var(--el-border-color-lighter);
}
.detail-title {
  margin-bottom: 8px;
  font-weight: 600;
  word-break: break-all;
}
.detail-warning {
  margin-bottom: 8px;
}
.detail-warning-text {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
.detail-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 10px;
  margin: 0;
}
.detail-list dt {
  color: var(--el-text-color-secondary);
}
.detail-list dd {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--el-font-family-mono, monospace);
}
.detail-attrs {
  margin-top: 10px;
}
.detail-attrs summary {
  margin-bottom: 6px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.plan-raw-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.plan-raw-actions {
  flex: none;
  padding: 2px 10px;
  text-align: right;
}
.plan-raw {
  flex: 1;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  white-space: pre;
}
</style>
