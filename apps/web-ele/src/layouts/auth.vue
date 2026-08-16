<script lang="ts" setup>
/**
 * 认证布局：接入品牌配置（Logo、标题、欢迎文案、登录背景）
 *
 * @author yanch
 */
import { computed } from 'vue';

import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';

import { branding, resolveAssetUrl } from '#/store/branding';

const appName = computed(
  () => branding.accountMark || preferences.app.name || 'Lemon',
);
const logo = computed(
  () => resolveAssetUrl(branding.logo) || preferences.logo.source,
);
const logoDark = computed(() => preferences.logo.sourceDark);
const pageTitle = computed(() => branding.pageTitle);
const pageDescription = computed(() => branding.pageDesc);
const loginBackground = computed(() => resolveAssetUrl(branding.loginBg));
</script>

<template>
  <AuthPageLayout
    :app-name="appName"
    :logo="logo"
    :logo-dark="logoDark"
    :page-description="pageDescription"
    :page-title="pageTitle"
    :login-background="loginBackground"
  >
    <!-- 自定义工具栏 -->
    <!-- <template #toolbar></template> -->
  </AuthPageLayout>
</template>
