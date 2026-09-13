<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { LockKeyhole } from '@vben/icons';
import { $t, useI18n } from '@vben/locales';
import { storeToRefs, useAccessStore } from '@vben/stores';

import { useScrollLock } from '@vben-core/composables';
import { useVbenForm, z } from '@vben-core/form-ui';
import { VbenAvatar, VbenButton } from '@vben-core/shadcn-ui';

import { useDateFormat, useNow } from '@vueuse/core';

interface Props {
  avatar?: string;
  /** 当前用户个性签名。 */
  signature?: string;
  /** 使用当前登录账号密码时，由业务应用提供服务端校验函数。 */
  verifyPassword?: (password: string) => boolean | Promise<boolean>;
}

defineOptions({
  name: 'LockScreen',
});

const props = withDefaults(defineProps<Props>(), {
  avatar: '',
  signature: '',
});

defineEmits<{ toLogin: [] }>();

const { locale } = useI18n();
const accessStore = useAccessStore();

const now = useNow();
const meridiem = useDateFormat(now, 'A');
const hour = useDateFormat(now, 'HH');
const minute = useDateFormat(now, 'mm');
const date = useDateFormat(now, 'YYYY-MM-DD dddd', { locales: locale.value });

const showUnlockForm = ref(false);
const submitting = ref(false);
const { lockScreenPassword } = storeToRefs(accessStore);

const [Form, { getFieldComponentRef, getRawValues, setFieldError, validate }] =
  useVbenForm(
    reactive({
      commonConfig: {
        hideLabel: true,
        hideRequiredMark: true,
      },
      schema: computed(() => [
        {
          component: 'VbenInputPassword' as const,
          componentProps: {
            placeholder: props.verifyPassword
              ? $t('ui.widgets.lockScreen.accountPasswordPlaceholder')
              : $t('ui.widgets.lockScreen.placeholder'),
          },
          fieldName: 'password',
          label: $t('authentication.password'),
          rules: z
            .string()
            .min(1, { message: $t('authentication.passwordTip') }),
        },
      ]),
      showDefaultActions: false,
    }),
  );

async function handleSubmit() {
  if (submitting.value) {
    return;
  }
  const { valid } = await validate();
  if (valid) {
    const { password } = await getRawValues();
    try {
      submitting.value = true;
      // 业务应用传入校验函数时使用服务端账号密码；未传时兼容原有本地锁屏。
      const passwordMatched = props.verifyPassword
        ? await props.verifyPassword(password)
        : lockScreenPassword?.value === password;
      if (passwordMatched) {
        accessStore.unlockScreen();
        return;
      }
      await setFieldError('password', $t('authentication.passwordErrorTip'));
    } catch {
      // 请求层会展示后台返回的具体错误，这里同时在密码框下保留通用提示。
      await setFieldError('password', $t('authentication.passwordErrorTip'));
    } finally {
      submitting.value = false;
    }
  }
}

function toggleUnlockForm() {
  showUnlockForm.value = !showUnlockForm.value;
  if (showUnlockForm.value) {
    requestAnimationFrame(() => {
      getFieldComponentRef('password')
        ?.$el?.querySelector('[name="password"]')
        ?.focus();
    });
  }
}

useScrollLock();
</script>

<template>
  <div class="fixed z-2000 size-full bg-background">
    <transition name="slide-left">
      <div v-show="!showUnlockForm" class="size-full">
        <div
          class="group fixed top-6 left-1/2 z-2001 flex-col-center -translate-x-1/2 cursor-pointer text-xl font-semibold text-foreground/80 hover:text-foreground"
          @click="toggleUnlockForm"
        >
          <LockKeyhole
            class="size-5 transition-all duration-300 group-hover:scale-125"
          />
          <span>{{ $t('ui.widgets.lockScreen.unlock') }}</span>
        </div>
        <div class="flex-center size-full">
          <div class="flex w-full justify-center gap-4 px-4 sm:gap-6 md:gap-8">
            <div
              class="relative flex-center h-35 w-35 rounded-xl bg-accent text-[36px] sm:h-40 sm:w-40 sm:text-[42px] md:h-50 md:w-50 md:text-[72px]"
            >
              <span
                class="absolute top-3 left-3 text-xs font-semibold sm:text-sm md:text-xl"
              >
                {{ meridiem }}
              </span>
              {{ hour }}
            </div>
            <div
              class="flex-center h-35 w-35 rounded-xl bg-accent text-[36px] sm:h-40 sm:w-40 sm:text-[42px] md:h-50 md:w-50 md:text-[72px]"
            >
              {{ minute }}
            </div>
          </div>
        </div>
      </div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showUnlockForm"
        class="flex-center size-full"
        @keydown.enter.prevent="handleSubmit"
      >
        <div class="mb-10 flex-col-center w-[90%] max-w-75 px-4">
          <VbenAvatar :src="avatar" class="enter-x mb-6 size-20" />
          <p
            v-if="signature"
            class="enter-x mb-5 max-w-full truncate text-center text-sm text-muted-foreground"
            :title="signature"
          >
            {{ signature }}
          </p>
          <div class="enter-x mb-2 w-full items-center">
            <Form />
          </div>
          <VbenButton
            :loading="submitting"
            class="enter-x w-full"
            @click="handleSubmit"
          >
            {{ $t('ui.widgets.lockScreen.entry') }}
          </VbenButton>
          <VbenButton
            class="enter-x my-2 w-full"
            variant="ghost"
            @click="$emit('toLogin')"
          >
            {{ $t('ui.widgets.lockScreen.backToLogin') }}
          </VbenButton>
          <VbenButton
            class="enter-x mr-2 w-full"
            variant="ghost"
            @click="toggleUnlockForm"
          >
            {{ $t('common.back') }}
          </VbenButton>
        </div>
      </div>
    </transition>

    <div
      class="enter-y absolute bottom-5 w-full text-center text-xl md:text-2xl xl:text-xl 2xl:text-3xl"
    >
      <div v-if="showUnlockForm" class="enter-x mb-2 text-2xl md:text-3xl">
        {{ hour }}:{{ minute }}
        <span class="text-base md:text-lg">{{ meridiem }}</span>
      </div>
      <div class="text-xl md:text-3xl">{{ date }}</div>
    </div>
  </div>
</template>
