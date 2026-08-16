<script lang="ts" setup>
/**
 * 关于页：展示 Lemon 系统信息（不再使用默认 Vben 文案）
 *
 * @author yanch
 */
import { About } from '@vben/common-ui';

import { branding } from '#/store/branding';

defineOptions({ name: 'About' });
</script>

<template>
  <About
    :name="branding.appTitle || 'Lemon'"
    title="关于 Lemon"
    description="Lemon 管理系统：基于 Vue 3 + Vite + Element Plus 的中后台解决方案，覆盖权限、可视化查询、业务模块等能力。"
  />
</template>
