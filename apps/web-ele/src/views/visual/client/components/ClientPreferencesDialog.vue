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

const {
  sqlEditorFontSize,
  uiFontSize,
  aiChatFontSize,
  SQL_FONT_MIN,
  SQL_FONT_MAX,
  UI_FONT_MIN,
  UI_FONT_MAX,
  AI_FONT_MIN,
  AI_FONT_MAX,
} = useClientPreferences();
</script>

<template>
  <ElDialog
    v-model="visible"
    title="偏好设置"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <ElForm label-width="130px">
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
        <div class="font-size-hint">仅作用于查询区 Monaco SQL 编辑器</div>
      </ElFormItem>
      <ElFormItem label="界面字号">
        <div class="font-size-row">
          <ElSlider
            v-model="uiFontSize"
            :min="UI_FONT_MIN"
            :max="UI_FONT_MAX"
            :step="1"
            class="font-size-slider"
          />
          <ElInputNumber
            v-model="uiFontSize"
            :min="UI_FONT_MIN"
            :max="UI_FONT_MAX"
            :step="1"
            controls-position="right"
            class="font-size-input"
          />
          <span class="font-size-unit">px</span>
        </div>
        <div class="font-size-hint">
          工具栏、对象树、页签、结果区、弹窗等；不含右上角框架「全局字号」
        </div>
      </ElFormItem>
      <ElFormItem label="AI 对话字号">
        <div class="font-size-row">
          <ElSlider
            v-model="aiChatFontSize"
            :min="AI_FONT_MIN"
            :max="AI_FONT_MAX"
            :step="1"
            class="font-size-slider"
          />
          <ElInputNumber
            v-model="aiChatFontSize"
            :min="AI_FONT_MIN"
            :max="AI_FONT_MAX"
            :step="1"
            controls-position="right"
            class="font-size-input"
          />
          <span class="font-size-unit">px</span>
        </div>
        <div class="font-size-hint">AI 助手浮窗消息、输入区、SQL 卡片与任务栏</div>
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
  font-size: var(--vc-ui-font-size, 13px);
}

.font-size-hint {
  margin-top: 4px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  font-size: var(--vc-ui-font-size-sm, 12px);
}
</style>
