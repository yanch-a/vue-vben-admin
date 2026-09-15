<script lang="ts" setup>
/**
 * 图表外观配置：常用项就地修改，高级 option 在独立弹窗中验证、预览后应用。
 * 不修改 SQL，也不运行 JavaScript；图表资产和画布组件使用同一配置协议。
 * @author yanch
 */
import type {
  ChartAppearance,
  ChartSpec,
  QueryResult,
} from '#/api/visual/dashboard';

import { computed, nextTick, ref } from 'vue';
import { ElMessage } from 'element-plus';

import {
  chartSpecToOption,
  parseOptionOverrides,
} from '../../client/utils/chartSpecToOption';
import ChartRenderer from './ChartRenderer.vue';

const props = withDefaults(
  defineProps<{
    previewHeight?: number;
    previewWidth?: number;
    result?: Partial<QueryResult>;
    spec: ChartSpec;
  }>(),
  { previewHeight: 260, previewWidth: 420 },
);
const emit = defineEmits<{ 'update:spec': [spec: ChartSpec] }>();
const appearance = computed(() => props.spec.appearance || {});
const supportsOption = computed(
  () => !['kpi', 'table', 'text'].includes(props.spec.chartType),
);
const hasAxes = computed(
  () => supportsOption.value && props.spec.chartType !== 'pie',
);
const optionDialog = ref(false);
const optionText = ref('{}');
const optionEditorKey = ref(0);
const syntaxError = ref('');
const previewError = ref('');
const previewPending = ref(false);
const draftOverrides = ref<Record<string, unknown>>({});
const previewSpec = computed(() => ({
  ...props.spec,
  optionOverrides: draftOverrides.value,
}));
const margins = ['top', 'right', 'bottom', 'left'] as const;
const marginLabels = { top: '上', right: '右', bottom: '下', left: '左' };

/** 基础选项增量更新，不丢失高级 option 或字段映射。 */
function updateAppearance(key: keyof ChartAppearance, value: unknown) {
  emit('update:spec', {
    ...props.spec,
    appearance: { ...appearance.value, [key]: value ?? undefined },
  });
}

/** 留空恢复尺寸自适应；显式设置的边距在缩放后仍按逻辑像素保持比例。 */
function updateMargin(
  key: (typeof margins)[number],
  value: number | undefined,
) {
  updateAppearance('grid', { ...appearance.value.grid, [key]: value });
}

/** 颜色输入仅接受 HEX，RGB 等复杂色值可在高级 option 中配置。 */
function updateColors(value: string) {
  const colors = value
    .split(/[,，]/)
    .map((color) => color.trim())
    .filter(Boolean);
  if (
    colors.some(
      (color) =>
        !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color),
    )
  ) {
    ElMessage.warning('请输入逗号分隔的 HEX 色值，例如 #38bdf8, #34d399');
    return;
  }
  updateAppearance('colors', colors);
}

/** 去掉 series.data，避免把 SQL 数据固化进增量 option。 */
function stripSeriesData(option: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(option)) as Record<string, unknown>;
  const series = cloned.series;
  if (Array.isArray(series)) {
    cloned.series = series.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const next = { ...(item as Record<string, unknown>) };
      delete next.data;
      return next;
    });
  }
  return cloned;
}

/** 读取已保存的增量 option；没有时返回空对象。 */
function resolveSavedOverrides(): Record<string, unknown> {
  const existing = props.spec.optionOverrides;
  if (
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing) &&
    Object.keys(existing).length > 0
  ) {
    return existing;
  }
  return {};
}

/** 当前外观合成的 option（去掉 data），用于在现有样式基础上继续改。 */
function resolveSynthesizedOption(): Record<string, unknown> {
  try {
    return stripSeriesData(
      chartSpecToOption(props.spec, [], [], {
        width: props.previewWidth,
        height: props.previewHeight,
      }) as Record<string, unknown>,
    );
  } catch {
    return {};
  }
}

/** 打开时创建独立草稿，取消弹窗不会把半成品写入大屏。 */
async function openOptionEditor() {
  const draft = resolveSavedOverrides();
  optionText.value = JSON.stringify(draft, null, 2);
  draftOverrides.value = parseOptionOverrides(optionText.value);
  syntaxError.value = '';
  previewError.value = '';
  previewPending.value = true;
  optionEditorKey.value += 1;
  optionDialog.value = true;
  // 等弹窗挂载后再写一次，避免 destroy-on-close 重建时仍显示空对象。
  await nextTick();
  optionText.value = JSON.stringify(draft, null, 2);
}

/** 合法 JSON 实时预览；非法文本保留编辑内容，并继续显示上一次有效预览。 */
function editOption(value: string) {
  optionText.value = value;
  try {
    draftOverrides.value = parseOptionOverrides(value);
    syntaxError.value = '';
    previewPending.value = true;
  } catch (error: any) {
    syntaxError.value = error?.message || 'option JSON 无效';
  }
}

/** 示例只覆盖布局，不写入 series.data，SQL 更新仍可自动反映到图表。 */
function useCompactExample() {
  editOption(
    JSON.stringify(
      {
        legend: { show: false },
        grid: { containLabel: true, top: 6, right: 6, bottom: 6, left: 6 },
        series: [{ label: { show: false } }],
      },
      null,
      2,
    ),
  );
}

/** 优先载入已保存增量；若无则载入当前合成样式，便于在现有视觉效果上修改。 */
function reloadExistingOption() {
  const saved = resolveSavedOverrides();
  const draft =
    Object.keys(saved).length > 0 ? saved : resolveSynthesizedOption();
  editOption(JSON.stringify(draft, null, 2));
}

/** 应用时再次校验，阻止无效 JSON 被保存或发布。 */
function applyOption() {
  if (syntaxError.value || previewError.value || previewPending.value) return;
  emit('update:spec', {
    ...props.spec,
    optionOverrides: parseOptionOverrides(optionText.value),
  });
  optionDialog.value = false;
}
</script>

<template>
  <div class="appearance-editor">
    <div class="appearance-row">
      <ElFormItem label="组件标题">
        <ElSwitch
          :model-value="appearance.showTitle !== false"
          @change="updateAppearance('showTitle', $event)"
        />
      </ElFormItem>
      <ElFormItem v-if="supportsOption" label="图例">
        <ElSelect
          :model-value="appearance.legend || 'auto'"
          @change="updateAppearance('legend', $event)"
        >
          <ElOption label="自适应" value="auto" /><ElOption
            label="隐藏"
            value="hidden"
          />
          <ElOption label="顶部" value="top" /><ElOption
            label="底部"
            value="bottom"
          />
        </ElSelect>
      </ElFormItem>
    </div>
    <template v-if="supportsOption">
      <div class="appearance-row">
        <ElFormItem label="字号（空为自动）">
          <ElInputNumber
            :model-value="appearance.fontSize"
            :min="8"
            :max="32"
            controls-position="right"
            @change="updateAppearance('fontSize', $event)"
          />
        </ElFormItem>
        <ElFormItem label="数据标签">
          <ElSelect
            :model-value="
              appearance.showLabels == null
                ? 'auto'
                : appearance.showLabels
                  ? 'show'
                  : 'hide'
            "
            @change="
              updateAppearance(
                'showLabels',
                $event === 'auto' ? undefined : $event === 'show',
              )
            "
          >
            <ElOption label="自适应" value="auto" /><ElOption
              label="显示"
              value="show"
            /><ElOption label="隐藏" value="hide" />
          </ElSelect>
        </ElFormItem>
      </div>
      <ElFormItem v-if="spec.chartType === 'pie'" label="饼图尺寸（%）">
        <ElSlider
          :model-value="appearance.pieRadius ?? 78"
          :min="30"
          :max="95"
          @input="updateAppearance('pieRadius', $event)"
        />
      </ElFormItem>
      <ElFormItem
        v-if="['line', 'area'].includes(spec.chartType)"
        label="平滑曲线"
      >
        <ElSwitch
          :model-value="appearance.smooth ?? false"
          @change="updateAppearance('smooth', $event)"
        />
      </ElFormItem>
      <ElFormItem label="系列颜色（HEX，逗号分隔）">
        <ElInput
          :model-value="appearance.colors?.join(', ') || ''"
          placeholder="#38bdf8, #34d399，空为默认"
          @change="updateColors(String($event))"
        />
      </ElFormItem>
      <ElFormItem v-if="hasAxes" label="绘图区边距（px，留空自动）">
        <div class="margin-fields">
          <label v-for="key in margins" :key="key"
            >{{ marginLabels[key] }}
            <ElInputNumber
              :model-value="appearance.grid?.[key]"
              :min="0"
              :max="200"
              controls-position="right"
              @change="updateMargin(key, $event)"
            />
          </label>
        </div>
      </ElFormItem>
      <ElButton class="option-button" @click="openOptionEditor"
        >编辑 ECharts option</ElButton
      >
      <p class="hint">
        高级 option 优先于常用设置；默认保留 SQL 数据，只有显式设置 data
        时才覆盖。
      </p>
    </template>
    <template v-else-if="spec.chartType === 'text'">
      <ElFormItem label="文本字号">
        <ElInputNumber
          :model-value="appearance.fontSize ?? 24"
          :min="12"
          :max="120"
          controls-position="right"
          @change="updateAppearance('fontSize', $event)"
        />
      </ElFormItem>
      <ElFormItem label="文字颜色（HEX）">
        <ElInput
          :model-value="appearance.colors?.[0] || ''"
          placeholder="#e2e8f0"
          @change="updateColors(String($event || '#e2e8f0'))"
        />
      </ElFormItem>
      <p class="hint">文本内容请在「数据与字段」中编辑；不使用 ECharts option。</p>
    </template>
    <p v-else class="hint">
      指标卡和表格不使用 ECharts option，请通过字段映射及数值格式配置。
    </p>

    <ElDialog
      v-model="optionDialog"
      title="ECharts option 配置"
      width="min(1100px, 94vw)"
      append-to-body
      destroy-on-close
    >
      <ElAlert
        type="info"
        :closable="false"
        title="填写 JSON 对象即可覆盖图例、坐标轴、绘图区、配色和系列样式。series 按索引合并；不支持 JavaScript 函数。若已保存过 option，打开时会自动载入；也可点「载入现有」带入当前样式。"
      />
      <div class="option-layout">
        <section class="option-source">
          <div class="option-toolbar">
            <span>增量 option JSON</span
            ><ElButton size="small" @click="reloadExistingOption"
              >载入现有</ElButton
            ><ElButton size="small" @click="useCompactExample"
              >填入紧凑示例</ElButton
            ><ElButton size="small" @click="editOption('{}')">清空</ElButton>
          </div>
          <ElInput
            :key="optionEditorKey"
            :model-value="optionText"
            type="textarea"
            :rows="19"
            spellcheck="false"
            @input="editOption(String($event))"
          />
          <p v-if="syntaxError || previewError" class="option-error">
            {{ syntaxError || previewError }}
          </p>
        </section>
        <section class="option-preview">
          <p>实时预览 · {{ previewWidth }} × {{ previewHeight }}</p>
          <div
            class="preview-widget"
            :style="{
              width: `min(100%, ${previewWidth}px)`,
              aspectRatio: `${previewWidth} / ${previewHeight}`,
            }"
          >
            <header v-if="appearance.showTitle !== false">图表预览</header>
            <div class="preview-body">
              <ChartRenderer
                :spec="previewSpec"
                :result="result"
                @error="previewError = $event"
                @rendering="previewPending = $event"
              />
            </div>
          </div>
          <p class="hint">
            {{
              result?.rows?.length
                ? '使用当前 SQL 预览结果，不额外查询数据库。'
                : '尚无数据。先运行图表或刷新画布预览，再检查数据呈现。'
            }}
          </p>
        </section>
      </div>
      <template #footer
        ><ElButton @click="optionDialog = false">取消</ElButton
        ><ElButton
          type="primary"
          :disabled="!!syntaxError || !!previewError || previewPending"
          @click="applyOption"
          >应用到图表</ElButton
        ></template
      >
    </ElDialog>
  </div>
</template>

<style scoped>
.appearance-row {
  display: flex;
  gap: 10px;
}
.appearance-row > * {
  flex: 1;
  min-width: 0;
}
.appearance-editor :deep(.el-input-number),
.appearance-editor :deep(.el-select) {
  width: 100%;
}
.margin-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
}
.margin-fields label {
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.option-button {
  width: 100%;
}
.hint {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.option-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 20px;
  margin-top: 14px;
}
.option-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}
.option-toolbar span {
  flex: 1;
}
.option-source :deep(textarea) {
  font-family: Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
}
.option-error {
  color: var(--el-color-danger);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.option-preview {
  min-width: 0;
  max-height: 480px;
  overflow: auto;
}
.option-preview > p {
  margin: 0 0 10px;
}
.preview-widget {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #dbeafe;
  background: #101b2d;
  border: 1px solid #30435f;
  border-radius: 5px;
}
.preview-widget header {
  flex: 0 0 30px;
  padding: 6px 9px;
  box-sizing: border-box;
  background: #16243a;
  font-size: 12px;
}
.preview-body {
  flex: 1;
  min-height: 0;
  padding: 4px;
}
@media (max-width: 760px) {
  .option-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
