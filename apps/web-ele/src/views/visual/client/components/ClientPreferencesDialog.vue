<script lang="ts" setup>
/**
 * 客户端偏好设置
 * @author yanch
 */
import type { QueryTabsPlacement } from '../composables/useClientPreferences';
import { useClientPreferences } from '../composables/useClientPreferences';

defineOptions({ name: 'ClientPreferencesDialog' });

const visible = defineModel<boolean>({ default: false });

const props = defineProps<{
  queryTabsPlacement: QueryTabsPlacement;
}>();

const emit = defineEmits<{
  'update:queryTabsPlacement': [QueryTabsPlacement];
}>();

const { sqlEditorFontSize, SQL_FONT_MIN, SQL_FONT_MAX } = useClientPreferences();
</script>

<template>
  <ElDialog
    v-model="visible"
    title="偏好设置"
    width="480px"
    destroy-on-close
    append-to-body
  >
    <ElForm label-width="120px">
      <ElFormItem label="查询页签位置">
        <ElRadioGroup
          :model-value="props.queryTabsPlacement"
          @update:model-value="
            (v: string | number | boolean | undefined) =>
              emit(
                'update:queryTabsPlacement',
                v === 'left' ? 'left' : 'top',
              )
          "
        >
          <ElRadio value="top">上方（默认）</ElRadio>
          <ElRadio value="left">左侧竖排</ElRadio>
        </ElRadioGroup>
      </ElFormItem>
      <ElFormItem label="SQL 编辑器字号">
        <div class="font-size-row">
          <ElSlider
            v-model="sqlEditorFontSize"
            :min="SQL_FONT_MIN"
            :max="SQL_FONT_MAX"
            :step="1"
            class="font-size-slider"
          />
          <ElInputNumber
            v-model="sqlEditorFontSize"
            :min="SQL_FONT_MIN"
            :max="SQL_FONT_MAX"
            :step="1"
            controls-position="right"
            class="font-size-input"
          />
          <span class="font-size-unit">px</span>
        </div>
      </ElFormItem>
    </ElForm>
    <template #footer>
      <ElButton type="primary" @click="visible = false">确定</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.font-size-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.font-size-slider {
  flex: 1;
  margin-right: 4px;
}

.font-size-input {
  width: 110px;
}

.font-size-unit {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
