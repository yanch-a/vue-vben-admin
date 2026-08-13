<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus';

import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
} from 'element-plus';

import { registerMemberUserApi, sendRegisterCodeApi } from '#/api';

defineOptions({ name: 'Register' });

const router = useRouter();
const formRef = ref<FormInstance>();
const loading = ref(false);
const sendCodeLoading = ref(false);
const countdown = ref(0);
let timer: null | ReturnType<typeof setInterval> = null;

const form = reactive({
  username: '',
  phone: '',
  phoneCode: '',
  inviteCode: '',
  password: '',
});

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 30, message: '用户名长度 2-30', trigger: 'blur' },
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '手机号格式不正确',
      trigger: 'blur',
    },
  ],
  phoneCode: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' },
  ],
};

async function handleSendCode() {
  if (!/^1[3-9]\d{9}$/.test(form.phone)) {
    ElMessage.warning('请输入正确手机号');
    return;
  }
  try {
    sendCodeLoading.value = true;
    await sendRegisterCodeApi(form.phone);
    ElMessage.success('验证码已发送');
    countdown.value = 60;
    timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, 1000);
  } finally {
    sendCodeLoading.value = false;
  }
}

async function handleRegister() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  try {
    loading.value = true;
    const result = await registerMemberUserApi({
      username: form.username,
      phonenumber: form.phone,
      smsCode: form.phoneCode,
      password: form.password,
      inviteCode: form.inviteCode || undefined,
      registerSource: 'WEB',
    });
    if (result?.inviteCode) {
      await ElMessageBox.confirm(
        `注册成功！您的邀请码：${result.inviteCode}`,
        '注册成功',
        { type: 'success', confirmButtonText: '去登录' },
      );
    } else {
      ElMessage.success(result?.message || '注册成功');
    }
    await router.push('/auth/login');
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="lemon-register">
    <div class="lemon-register__card">
      <h1 class="title">欢迎注册</h1>
      <p class="subtitle">请填写您的注册信息</p>

      <ElForm
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        @keyup.enter="handleRegister"
      >
        <ElFormItem prop="username">
          <ElInput
            v-model.trim="form.username"
            placeholder="请输入用户名"
            clearable
          />
        </ElFormItem>
        <ElFormItem prop="phone">
          <ElInput
            v-model.trim="form.phone"
            maxlength="11"
            placeholder="请输入手机号"
            clearable
          />
        </ElFormItem>
        <ElFormItem prop="phoneCode">
          <div class="sms-row">
            <ElInput
              v-model.trim="form.phoneCode"
              maxlength="6"
              placeholder="请输入手机验证码"
            />
            <ElButton
              :disabled="countdown > 0"
              :loading="sendCodeLoading"
              @click="handleSendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </ElButton>
          </div>
        </ElFormItem>
        <ElFormItem prop="inviteCode">
          <ElInput
            v-model.trim="form.inviteCode"
            placeholder="邀请码（可选）"
            clearable
          />
        </ElFormItem>
        <ElFormItem prop="password">
          <ElInput
            v-model.trim="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
            autocomplete="new-password"
          />
        </ElFormItem>
        <ElButton
          type="primary"
          class="submit"
          :loading="loading"
          @click="handleRegister"
        >
          注册
        </ElButton>
        <div class="login-link">
          <router-link to="/auth/login">已有账号？立即登录</router-link>
        </div>
      </ElForm>
    </div>
  </div>
</template>

<style scoped>
.lemon-register {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100%;
  padding: 24px;
}

.lemon-register__card {
  width: 100%;
  max-width: 420px;
}

.title {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  text-align: center;
}

.subtitle {
  margin: 0 0 24px;
  color: hsl(var(--muted-foreground));
  text-align: center;
}

.sms-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.submit {
  width: 100%;
  margin-top: 8px;
}

.login-link {
  margin-top: 16px;
  text-align: center;
}

.login-link a {
  color: hsl(var(--primary));
}
</style>
