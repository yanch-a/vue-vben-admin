<script setup lang="ts">
import { parseEtlJson } from './etlSafeJson';
/** 通用算子表单，普通配置可视化编辑，复杂表达式用带示例和校验的 JSON 弹窗。@author yanch */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { EtlNode } from '#/api/visual/etl';
import { translateUiText as tr } from '#/locales/ui-text';
import { ETL_OPERATORS, parseEtlCsv } from './etlOperators';
import EtlConditionEditor from './EtlConditionEditor.vue';

const props = defineProps<{ node: EtlNode; upstream: EtlNode[]; columns: Record<string, string[]> }>();
const emit = defineEmits<{ dependencyChange: [] }>();
const config = computed(() => props.node.config);
const operator = computed(() => ETL_OPERATORS.find((item) => item.type === props.node.type));
const sourceColumns = computed(() => props.columns[config.value.inputStepId] || []);
const rightColumns = computed(() => props.columns[config.value.rightStepId] || []);
const stateful = computed(() => ['transform.join', 'transform.distinct', 'transform.sort', 'transform.aggregate'].includes(props.node.type));
const jsonVisible = ref(false), jsonTitle = ref(''), jsonText = ref(''), jsonError = ref('');
let applyJson: ((value: any) => void) | undefined;
let disposed = false;
onBeforeUnmount(() => { disposed = true; applyJson = undefined; });

/** 弹窗使用独立副本，解析失败保留原配置与输入文本，关闭取消也不影响任务。 */
function editJson(title: string, value: unknown, apply: (value: any) => void) {
  jsonTitle.value = title; jsonText.value = JSON.stringify(value, null, 2); jsonError.value = ''; applyJson = apply; jsonVisible.value = true;
}
/** 拒绝 JS 已无法精确表示的整数；金额和大整数用文本配合显式 cast。 */
function parseJson(text: string) {
  if (text.length > 1024 * 1024) throw new Error('单次 JSON 编辑最多 1MB');
  return parseEtlJson(text, 1024 * 1024);
}
/** 完整验证成功才应用一次，不让半截 JSON 混入可执行草稿。 */
function confirmJson() {
  try { const value = parseJson(jsonText.value); applyJson?.(value); jsonVisible.value = false; }
  catch (error) { jsonError.value = error instanceof Error ? error.message : 'JSON 无效'; }
}
/** 普通常量、字段、条件、计算、空值和显式类型转换示例。 */
const examples = [
  { name: '字段', value: { field: 'amount' } },
  { name: '条件组合', value: { op: 'and', args: [{ op: 'ge', args: [{ field: 'amount' }, { value: 0 }] }, { op: 'not', args: [{ op: 'isNull', args: [{ field: 'id' }] }] }] } },
  { name: '计算金额', value: { op: 'multiply', args: [{ op: 'cast', type: 'decimal', args: [{ field: 'amount' }] }, { op: 'cast', type: 'decimal', args: [{ value: '1.13' }] }] } },
  { name: '默认值', value: { op: 'coalesce', args: [{ field: 'name' }, { value: '未知' }] } },
  { name: '条件赋值', value: { op: 'if', args: [{ op: 'gt', args: [{ field: 'amount' }, { value: 100 }] }, { value: '高' }, { value: '普通' }] } },
];
/** 引用编辑必须立即重建生成边，保留手工连线。 */
function dependencies() { emit('dependencyChange'); }
/** JSON 数据只接受对象数组；推断列保持顺序，缺失值在执行时作为 NULL。 */
function applyRows(rows: unknown) {
  if (!Array.isArray(rows) || rows.length > 10000 || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('数据必须为对象数组，最多 10000 行');
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (new Set(columns.map((name) => name.toLowerCase())).size !== columns.length || columns.some((name) => !name.trim())) throw new Error('字段名称不能为空或大小写重名');
  config.value.rows = rows; if (columns.length) config.value.columns = columns;
}
const fileError = ref('');
/** 文件仅读入浏览器后生成内嵌数据，不将任意服务器文件路径交给执行器。 */
async function importCsv(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0], node = props.node, snapshot = JSON.stringify(props.node.config);
  fileError.value = ''; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('CSV 最多 1MB');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); if (disposed || props.node !== node) return;
    if (JSON.stringify(node.config) !== snapshot) throw new Error('数据配置已修改，请重新选择文件');
    const data = parseEtlCsv(text); Object.assign(node.config, data);
  } catch (error) { if (!disposed && props.node === node) fileError.value = error instanceof Error ? error.message : 'CSV 导入失败'; }
  finally { input.value = ''; }
}
</script>

<template>
  <div class="operator-editor">
    <el-alert :title="tr(operator?.help || '')" type="info" :closable="false" />
    <el-form-item v-if="!['source.inline', 'transform.union'].includes(node.type)" :label="tr('输入步骤')">
      <el-select v-model="config.inputStepId" @change="dependencies"><el-option v-for="step in upstream" :key="step.id" :value="step.id" :label="step.name || step.id" /></el-select>
    </el-form-item>
    <p v-if="!['source.inline', 'transform.union'].includes(node.type) && !sourceColumns.length" class="hint">{{ tr('字段下拉为空时，请先在当前或上游步骤点「预览/加载字段」；也可手工输入字段名。') }}</p>
    <template v-if="node.type === 'source.inline'">
      <el-form-item :label="tr('输出字段（留空从非空数据自动推断）')"><el-select v-model="config.columns" multiple filterable allow-create default-first-option /></el-form-item>
      <p>{{ tr('已配置行数') }}: {{ config.rows?.length || 0 }}</p>
      <el-button @click="editJson('编辑数据对象数组', config.rows || [], applyRows)">{{ tr('编辑 JSON 数据') }}</el-button>
      <label class="csv-upload">{{ tr('导入 CSV') }}<input type="file" accept=".csv,text/csv" :aria-label="tr('导入 CSV')" @change="importCsv" /></label>
      <p class="hint">{{ tr('CSV 使用 UTF-8，首行为表头，数据保留文本。数字、日期请在字段处理或计算步骤显式转换。内嵌数据随工作区保存。') }}</p>
      <el-alert v-if="fileError" :title="tr(fileError)" type="error" :closable="false" />
    </template>
    <template v-else-if="['transform.filter', 'transform.assert'].includes(node.type)">
      <EtlConditionEditor v-model="config.condition" :columns="sourceColumns" />
      <el-form-item :label="tr('条件表达式')"><el-button @click="editJson('条件表达式', config.condition, (value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('条件必须为表达式对象'); config.condition = value; })">{{ tr('编辑条件') }}</el-button></el-form-item>
      <pre class="expression-summary">{{ JSON.stringify(config.condition, null, 2) }}</pre>
      <el-checkbox v-if="node.type === 'transform.filter'" v-model="config.invert">{{ tr('反选：输出不符合条件的行') }}</el-checkbox>
      <el-input v-else v-model="config.message" :aria-label="tr('断言失败提示')" :placeholder="tr('断言失败提示')" />
    </template>
    <template v-else-if="node.type === 'transform.derive'">
      <el-checkbox v-model="config.replaceExisting">{{ tr('允许覆盖已有同名字段') }}</el-checkbox>
      <div v-for="(field, index) in config.fields" :key="index" class="rule-row">
        <el-input v-model="field.target" :placeholder="tr('输出字段')" :aria-label="tr('输出字段')" />
        <el-button @click="editJson('计算表达式', field.expression, (value) => field.expression = value)">{{ tr('表达式') }}</el-button>
        <el-button link type="danger" @click="config.fields.splice(index, 1)">{{ tr('删除') }}</el-button>
        <code>{{ JSON.stringify(field.expression) }}</code>
      </div>
      <el-button @click="config.fields.push({ target: '', expression: { field: sourceColumns[0] || '' } })">{{ tr('添加计算字段') }}</el-button>
    </template>
    <template v-else-if="node.type === 'transform.union'">
      <el-form-item :label="tr('输入步骤（按选择顺序合并）')"><el-select v-model="config.inputStepIds" multiple @change="dependencies"><el-option v-for="step in upstream" :key="step.id" :value="step.id" :label="step.name || step.id" /></el-select></el-form-item>
      <el-radio-group v-model="config.schemaMode"><el-radio value="strict">{{ tr('字段完全一致') }}</el-radio><el-radio value="byName">{{ tr('按名称合并，缺失填 NULL') }}</el-radio></el-radio-group>
    </template>
    <template v-else-if="node.type === 'transform.join'">
      <el-form-item :label="tr('右侧输入步骤')"><el-select v-model="config.rightStepId" @change="dependencies"><el-option v-for="step in upstream" :key="step.id" :value="step.id" :label="step.name || step.id" /></el-select></el-form-item>
      <el-form-item :label="tr('关联方式')"><el-select v-model="config.joinType"><el-option v-for="option in [{value:'left',label:'左关联'},{value:'inner',label:'内关联'},{value:'semi',label:'只保留匹配的左行'},{value:'anti',label:'只保留未匹配的左行'}]" :key="option.value" :value="option.value" :label="tr(option.label)" /></el-select></el-form-item>
      <div v-for="(key, index) in config.keys" :key="index" class="rule-row"><el-select v-model="key.left" filterable allow-create default-first-option :placeholder="tr('左侧键字段')" :aria-label="tr('左侧键字段')"><el-option v-for="column in sourceColumns" :key="'l-' + column" :value="column" :label="column" /></el-select><span>=</span><el-select v-model="key.right" filterable allow-create default-first-option :placeholder="tr('右侧键字段')" :aria-label="tr('右侧键字段')"><el-option v-for="column in rightColumns" :key="'r-' + column" :value="column" :label="column" /></el-select><el-button link type="danger" @click="config.keys.splice(index,1)">{{ tr('删除') }}</el-button></div>
      <el-button @click="config.keys.push({ left: sourceColumns[0] || '', right: rightColumns[0] || '' })">{{ tr('添加关联键') }}</el-button>
      <el-form-item :label="tr('右侧字段前缀')"><el-input v-model="config.rightPrefix" /></el-form-item>
      <el-checkbox v-model="config.nullEquals">{{ tr('允许 NULL 键匹配') }}</el-checkbox><el-checkbox v-model="config.requireUniqueRight">{{ tr('要求右侧键唯一') }}</el-checkbox>
      <el-button link @click="editJson('右侧字段映射 [{source,target}]', config.rightFields || [], (value) => { if (!Array.isArray(value)) throw new Error('映射必须为数组'); config.rightFields = value; })">{{ tr('自定义右侧输出字段') }}</el-button>
      <el-button v-if="config.rightFields !== undefined" link @click="delete config.rightFields">{{ tr('恢复右侧全部字段') }}</el-button>
    </template>
    <template v-else-if="node.type === 'transform.distinct' || node.type === 'transform.aggregate'">
      <el-form-item :label="tr(node.type === 'transform.distinct' ? '去重键字段' : '分组字段（留空表示全局聚合）')"><el-select v-model="config[node.type === 'transform.distinct' ? 'keys' : 'groupBy']" multiple filterable allow-create default-first-option><el-option v-for="column in sourceColumns" :key="column" :value="column" :label="column" /></el-select></el-form-item>
      <template v-if="node.type === 'transform.aggregate'">
        <div v-for="(metric,index) in config.metrics" :key="index" class="rule-row"><el-select v-model="metric.op"><el-option v-for="op in ['count','sum','avg','min','max']" :key="op" :label="op" :value="op" /></el-select><el-select v-model="metric.field" filterable allow-create clearable default-first-option :placeholder="tr('字段；count 留空计所有行')" :aria-label="tr('聚合输入字段')"><el-option v-for="column in sourceColumns" :key="column" :value="column" :label="column" /></el-select><el-input v-model="metric.target" :placeholder="tr('输出字段')" :aria-label="tr('聚合输出字段')" /><el-button link type="danger" @click="config.metrics.splice(index,1)">{{ tr('删除') }}</el-button></div>
        <el-button @click="config.metrics.push({ op:'count',field:'',target:'row_count' })">{{ tr('添加聚合指标') }}</el-button>
      </template>
    </template>
    <template v-else-if="node.type === 'transform.sort'">
      <div v-for="(order,index) in config.orderBy" :key="index" class="rule-row"><el-select v-model="order.field" filterable allow-create default-first-option :placeholder="tr('排序字段')" :aria-label="tr('排序字段')"><el-option v-for="column in sourceColumns" :key="column" :value="column" :label="column" /></el-select><el-select v-model="order.direction"><el-option value="asc" :label="tr('升序')" /><el-option value="desc" :label="tr('降序')" /></el-select><el-select v-model="order.nulls"><el-option value="first" :label="tr('NULL 最前')" /><el-option value="last" :label="tr('NULL 最后')" /></el-select><el-button link type="danger" @click="config.orderBy.splice(index,1)">{{ tr('删除') }}</el-button></div>
      <el-button @click="config.orderBy.push({ field:sourceColumns[0] || '', direction:'asc', nulls:'last' })">{{ tr('添加排序字段') }}</el-button>
    </template>
    <div v-if="stateful" class="state-limits">
      <el-button link @click="delete config.maxStateRows; delete config.maxStateBytes">{{ tr('恢复默认状态限额') }}</el-button>
      <el-form-item :label="tr('最大状态行数 / 分组数')"><el-input-number v-model="config.maxStateRows" :min="1" :max="1000000" :placeholder="tr('默认 100000')" /></el-form-item>
      <el-form-item :label="tr('状态估算字节上限')"><el-input-number v-model="config.maxStateBytes" :min="1024" :max="536870912" :step="1048576" :placeholder="tr('默认 67108864（64 MiB）')" /></el-form-item>
      <p class="hint">{{ tr('默认最多 100000 个状态行 / 分组，估算内存上限 64 MiB；超限停止，不丢弃数据。') }}</p>
    </div>
    <el-dialog v-model="jsonVisible" :title="tr(jsonTitle)" width="min(800px, 94vw)" :close-on-click-modal="false" append-to-body>
      <div class="examples"><el-button v-for="example in examples" :key="example.name" size="small" @click="jsonText = JSON.stringify(example.value,null,2)">{{ tr(example.name) }}</el-button></div>
      <p class="hint">{{ tr('表达式支持 field/value，op+args；函数包括比较、and/or/not、if、coalesce、文本清洗、四则运算和 cast。大整数及精确金额请使用字符串配合 cast。') }}</p>
      <el-input v-model="jsonText" type="textarea" :rows="14" :aria-label="tr(jsonTitle)" @input="jsonError = ''" />
      <el-alert v-if="jsonError" :title="tr(jsonError)" type="error" :closable="false" />
      <template #footer><el-button @click="jsonVisible=false">{{ tr('取消') }}</el-button><el-button type="primary" @click="confirmJson">{{ tr('应用') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.operator-editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.rule-row, .state-limits, .examples { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rule-row :deep(.el-input), .rule-row :deep(.el-select) { flex: 1 1 140px; width: 140px; }
.rule-row code { width: 100%; overflow-wrap: anywhere; color: var(--el-text-color-secondary); }
.expression-summary { max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 10px; background: var(--el-fill-color-light); border-radius: 6px; }
.hint { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.csv-upload { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.state-limits { padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); }
</style>
