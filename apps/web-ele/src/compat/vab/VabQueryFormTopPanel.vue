<script lang="ts" setup>
import { ElCol } from 'element-plus';

defineOptions({ name: 'VabQueryFormTopPanel' });

withDefaults(defineProps<{ span?: number }>(), { span: 24 });
</script>

<template>
  <ElCol :lg="span" :md="24" :sm="24" :xl="span" :xs="24">
    <div class="top-panel">
      <slot></slot>
    </div>
  </ElCol>
</template>
