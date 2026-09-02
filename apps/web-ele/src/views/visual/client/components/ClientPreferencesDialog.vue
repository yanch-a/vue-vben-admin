<script lang="ts" setup>
/**
 * 客户端偏好设置
 * @author yanch
 */
import type { QueryTabsPlacement } from '../composables/useClientPreferences';

defineOptions({ name: 'ClientPreferencesDialog' });

const visible = defineModel<boolean>({ default: false });

const props = defineProps<{
  queryTabsPlacement: QueryTabsPlacement;
}>();

const emit = defineEmits<{
  'update:queryTabsPlacement': [QueryTabsPlacement];
}>();
</script>

<template>
  <ElDialog
    v-model="visible"
    title="偏好设置"
    width="440px"
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
    </ElForm>
    <template #footer>
      <ElButton type="primary" @click="visible = false">确定</ElButton>
    </template>
  </ElDialog>
</template>
