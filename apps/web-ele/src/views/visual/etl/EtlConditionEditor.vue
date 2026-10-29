<script setup lang="ts">
/** 常用筛选条件的可视化编辑器，复杂嵌套表达式完整保留给高级编辑器。@author yanch */
import { ref, watch } from 'vue';
import { translateUiText as tr } from '#/locales/ui-text';
const props = defineProps<{ modelValue: any; columns: string[] }>();
const emit = defineEmits<{ 'update:modelValue': (value: any) => void;}>();
type Rule = { field: string; op: string; kind: string; value: string };
const rules=ref<Rule[]>([]), mode=ref('and'), editable=ref(false);
const castKinds=['decimal','date','time','timestamp','offsetTimestamp'];
const ops=[{value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'gt',label:'大于'},{value:'ge',label:'大于等于'},{value:'lt',label:'小于'},{value:'le',label:'小于等于'},{value:'contains',label:'包含文本'},{value:'startsWith',label:'文本开头'},{value:'endsWith',label:'文本结尾'},{value:'isNull',label:'是 NULL'}];
let emitted='';
/** 识别可无损编辑的简单条件；无法识别时禁止自动降级或删除嵌套函数。 */
function decode(expression: any): Rule | undefined {
  if (!expression || !ops.some((op)=>op.value===expression.op) || !expression.args?.[0]?.field) return;
  const left=expression.args[0], right=expression.args[1];
  if (Object.keys(left).length!==1 || (expression.op==='isNull' ? expression.args.length!==1 : expression.args.length!==2)) return;
  if (expression.op==='isNull') return {field:left.field,op:expression.op,kind:'null',value:''};
  if (right?.op==='cast' && castKinds.includes(right.type) && right.args?.length===1 && typeof right.args[0]?.value==='string') return {field:left.field,op:expression.op,kind:right.type,value:right.args[0].value};
  if (!right || !Object.hasOwn(right,'value') || Object.keys(right).length!==1 || (right.value!==null && !['string','number','boolean'].includes(typeof right.value))) return;
  return {field:left.field,op:expression.op,kind:right.value===null?'null':typeof right.value==='number'?'decimal':typeof right.value==='boolean'?'boolean':'string',value:right.value===null?'':String(right.value)};
}
watch(()=>props.modelValue,(value)=>{
  const snapshot=JSON.stringify(value);if(snapshot===emitted)return;
  const grouped=['and','or'].includes(value?.op) && Array.isArray(value.args);
  const expressions=grouped?value.args:[value];const decoded=expressions.map(decode);
  editable.value=decoded.length>0 && decoded.every(Boolean);
  rules.value=editable.value?decoded as Rule[]:[];mode.value=grouped?value.op:'and';
},{immediate:true,deep:true});
/** 数字常量保留为文本并显式转换，避免编辑金额和大整数时发生浮点精度损失。 */
function update() {
  const args=rules.value.map((rule)=>{
    const left={field:rule.field};if(rule.op==='isNull')return {op:rule.op,args:[left]};
    const right=castKinds.includes(rule.kind)?{op:'cast',type:rule.kind,args:[{value:rule.value}]}:{value:rule.kind==='null'?null:rule.kind==='boolean'?rule.value==='true':rule.value};
    return {op:rule.op,args:[left,right]};
  });
  const value=args.length===1?args[0]:{op:mode.value,args};emitted=JSON.stringify(value);emit('update:modelValue',value);
}
/** 明确添加规则才修改表达式；加载页面不重写已有配置。 */
function add() { rules.value.push({field:props.columns[0]||'',op:'eq',kind:'string',value:''});update(); }
/** 切换为布尔类型时给出可见的有效选项，不把任意旧文本悄悄表示成 false。 */
function changeKind(rule: Rule) { if (rule.kind==='boolean' && !['true','false'].includes(rule.value)) rule.value='true'; update(); }
</script>
<template>
  <div v-if="editable" class="condition-editor">
    <el-radio-group v-if="rules.length>1" v-model="mode" @change="update"><el-radio value="and">{{ tr('满足全部条件') }}</el-radio><el-radio value="or">{{ tr('满足任一条件') }}</el-radio></el-radio-group>
    <div v-for="(rule,index) in rules" :key="index" class="condition-row">
      <el-select v-model="rule.field" filterable allow-create default-first-option :placeholder="tr('输入字段')" :aria-label="tr('条件字段')" @change="update"><el-option v-for="column in columns" :key="column" :value="column" :label="column" /></el-select>
      <el-select v-model="rule.op" :aria-label="tr('比较方式')" @change="update"><el-option v-for="op in ops" :key="op.value" :value="op.value" :label="tr(op.label)" /></el-select>
      <template v-if="rule.op!=='isNull'"><el-select v-model="rule.kind" :aria-label="tr('比较值类型')" @change="changeKind(rule)"><el-option value="string" :label="tr('文本')" /><el-option value="decimal" :label="tr('精确数字')" /><el-option value="date" :label="tr('日期')" /><el-option value="time" :label="tr('时间')" /><el-option value="timestamp" :label="tr('日期时间')" /><el-option value="offsetTimestamp" :label="tr('带时区时间')" /><el-option value="boolean" :label="tr('布尔')" /><el-option value="null" label="NULL" /></el-select><el-select v-if="rule.kind==='boolean'" v-model="rule.value" :aria-label="tr('布尔比较值')" @change="update"><el-option value="true" label="true" /><el-option value="false" label="false" /></el-select><el-input v-else-if="rule.kind!=='null'" v-model="rule.value" :aria-label="tr('比较值')" @input="update" /></template>
      <el-button v-if="rules.length>1" link type="danger" @click="rules.splice(index,1);update()">{{ tr('删除') }}</el-button>
    </div>
    <el-button @click="add">{{ tr('添加条件') }}</el-button>
  </div>
  <small v-else>{{ tr('当前使用复合表达式，请通过高级条件编辑器修改。') }}</small>
</template>
<style scoped>
.condition-editor { display:flex;flex-direction:column;gap:8px; }
.condition-row { display:flex;flex-wrap:wrap;gap:8px;align-items:center; }
.condition-row :deep(.el-input), .condition-row :deep(.el-select) { flex:1 1 130px;width:130px; }
</style>
