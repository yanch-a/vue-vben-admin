<script lang="ts" setup>
import { Fallback } from '@vben/common-ui';

defineOptions({ name: 'OpsWorkbench' });
</script>

<template>
  <Fallback status="coming-soon" :title="$tr('运维看板')" />
</template>
