<script setup lang="ts">
import type { VbenFormSchema } from '#/adapter/form';

import { computed, ref } from 'vue';

import { ProfilePasswordSetting, z } from '@vben/common-ui';

import { ElMessage } from 'element-plus';

import { changePersonalPasswordApi } from '#/api';
import { $t } from '#/locales';

const passwordSettingRef = ref();

const formSchema = computed((): VbenFormSchema[] => [
  {
    fieldName: 'oldPassword',
    label: $t('page.profile.oldPassword'),
    component: 'VbenInputPassword',
    componentProps: { placeholder: $t('page.profile.oldPasswordPlaceholder') },
    rules: z
      .string()
      .min(1, { message: $t('page.profile.oldPasswordPlaceholder') }),
  },
  {
    fieldName: 'newPassword',
    label: $t('page.profile.newPassword'),
    component: 'VbenInputPassword',
    componentProps: {
      passwordStrength: true,
      placeholder: $t('page.profile.newPasswordPlaceholder'),
    },
    rules: z
      .string()
      .min(6, { message: $t('page.profile.passwordMin') })
      .max(50),
  },
  {
    fieldName: 'confirmPassword',
    label: $t('page.profile.confirmPassword'),
    component: 'VbenInputPassword',
    componentProps: {
      passwordStrength: true,
      placeholder: $t('page.profile.confirmPasswordPlaceholder'),
    },
    dependencies: {
      rules(values) {
        return z
          .string({ error: $t('page.profile.confirmPasswordPlaceholder') })
          .min(1, { message: $t('page.profile.confirmPasswordPlaceholder') })
          .refine((value) => value === values.newPassword, {
            message: $t('page.profile.passwordMismatch'),
          });
      },
      triggerFields: ['newPassword'],
    },
  },
]);

/** 验证旧密码后更新当前账号密码。 */
async function handleSubmit(values: Record<string, any>) {
  await changePersonalPasswordApi({
    newPassword: values.newPassword,
    password: values.oldPassword,
  });
  await passwordSettingRef.value?.getFormApi().resetForm();
  ElMessage.success($t('page.profile.passwordUpdated'));
}
</script>

<template>
  <ProfilePasswordSetting
    ref="passwordSettingRef"
    class="max-w-xl"
    :form-schema="formSchema"
    @submit="handleSubmit"
  />
</template>
