<script lang="ts" setup>
import { ElCard } from 'element-plus';

defineOptions({ name: 'VabCard' });

defineProps<{
  shadow?: 'always' | 'hover' | 'never';
}>();
</script>

<template>
  <ElCard :shadow="shadow || 'hover'" class="vab-card">
    <template v-if="$slots.header" #header>
      <slot name="header"></slot>
    </template>
    <slot></slot>
    <template v-if="$slots.footer" #footer>
      <slot name="footer"></slot>
    </template>
  </ElCard>
</template>
