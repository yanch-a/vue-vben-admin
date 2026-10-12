<script setup lang="ts">
/** 字段转换规则编辑器，沿用操作台表单控件并允许明确撤销 NULL 默认值。@author yanch */
import { translateUiText } from '#/locales/ui-text';

const props = defineProps<{ field: Record<string, any> }>();
const types = [
  { value: 'keep', label: '保留类型' },
  { value: 'string', label: '文本' },
  { value: 'int32', label: '32位整数' },
  { value: 'int64', label: '64位整数' },
  { value: 'decimal', label: '精确小数' },
  { value: 'boolean', label: '布尔' },
  { value: 'date', label: '日期' },
  { value: 'time', label: '时间' },
  { value: 'timestamp', label: '日期时间' },
  { value: 'offsetTimestamp', label: '带时区日期时间' },
];

/** 不启用默认值时删除配置键，不能以空文本假装“没有默认值”。 */
function toggleDefault(enabled: boolean | number | string) {
  if (enabled) props.field.defaultValue = '';
  else delete props.field.defaultValue;
}
</script>

<template>
  <div class="field-rules">
    <el-select v-model="field.type" :placeholder="translateUiText('保留类型')" :aria-label="translateUiText('转换类型')">
      <el-option v-for="option in types" :key="option.value" :value="option.value" :label="translateUiText(option.label)" />
    </el-select>
    <el-checkbox v-model="field.trim">{{ translateUiText('去除首尾空格') }}</el-checkbox>
    <el-checkbox v-model="field.emptyToNull">{{ translateUiText('空文本转NULL') }}</el-checkbox>
    <el-checkbox :model-value="field.defaultValue !== undefined" @change="toggleDefault">{{ translateUiText('设置NULL默认值') }}</el-checkbox>
    <el-input v-if="field.defaultValue !== undefined" :model-value="typeof field.defaultValue === 'boolean' ? String(field.defaultValue) : field.defaultValue" :aria-label="translateUiText('NULL默认值')" :placeholder="translateUiText('默认值（按转换类型解析）')" @update:model-value="field.defaultValue = $event" />
  </div>
</template>

<style scoped>
.field-rules {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  flex-basis: 100%;
}
.field-rules > .el-select { width: 170px; }
.field-rules > .el-input { flex: 1 1 180px; }
</style>
