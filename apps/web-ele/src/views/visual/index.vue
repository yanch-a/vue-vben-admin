<script lang="ts" setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

defineOptions({ name: 'VisualIndex' });

const router = useRouter();

onMounted(() => {
  router.replace({ name: 'VisualClient' }).catch(() => {
    router.replace('/visual/client');
  });
});
</script>

<template>
  <div class="p-6 text-sm text-[var(--el-text-color-secondary)]">
    正在进入数据库客户端…
  </div>
</template>
