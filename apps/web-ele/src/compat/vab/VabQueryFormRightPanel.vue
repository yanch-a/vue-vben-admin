<script lang="ts" setup>
import { ElCol } from 'element-plus';

defineOptions({ name: 'VabQueryFormRightPanel' });

withDefaults(defineProps<{ span?: number }>(), { span: 10 });
</script>

<template>
  <ElCol :lg="span" :md="24" :sm="24" :xl="span" :xs="24">
    <div class="right-panel">
      <slot></slot>
    </div>
  </ElCol>
</template>
