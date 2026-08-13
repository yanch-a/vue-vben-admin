<script lang="ts" setup>
/**
 * 占位页：对应旧菜单 @/views/index/dashboard
 * 后续可替换为真实看板实现
 */
import { Fallback } from '@vben/common-ui';

defineOptions({ name: 'IndexDashboard' });
</script>

<template>
  <Fallback
    description="看板页面待从 admin-plus 迁移。菜单 component 已兼容：@/views/index/dashboard"
    status="coming-soon"
    title="看板"
  />
</template>
