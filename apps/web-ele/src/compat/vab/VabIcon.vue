<script lang="ts" setup>
import { computed } from 'vue';

import { IconifyIcon } from '@vben/icons';

defineOptions({ name: 'VabIcon' });

const props = defineProps<{
  icon?: string;
}>();

/** 兼容：lucide:xxx / ep:xxx / 旧 remix 裸名 */
const iconName = computed(() => {
  if (!props.icon) return '';
  if (props.icon.includes(':')) return props.icon;
  return `ri:${props.icon}`;
});
</script>

<template>
  <IconifyIcon v-if="iconName" :icon="iconName" class="vab-icon" />
</template>

<style scoped>
.vab-icon {
  display: inline-flex;
  font-size: 16px;
  vertical-align: middle;
}
</style>
