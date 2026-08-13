<script lang="ts" setup>
import { ElCol } from 'element-plus';

defineOptions({ name: 'VabQueryFormLeftPanel' });

withDefaults(defineProps<{ span?: number }>(), { span: 14 });
</script>

<template>
  <ElCol :lg="span" :md="24" :sm="24" :xl="span" :xs="24">
    <div class="left-panel">
      <slot></slot>
    </div>
  </ElCol>
</template>
