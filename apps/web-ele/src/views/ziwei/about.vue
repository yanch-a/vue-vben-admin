<script lang="ts" setup>
import { Fallback } from '@vben/common-ui';

defineOptions({ name: 'AboutUs' });
</script>

<template>
  <Fallback status="coming-soon" :title="$tr('关于我们')" />
</template>
