<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus';

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import {
  ElButton,
  ElCheckbox,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
} from 'element-plus';

import {
  createWxScanQrcodeApi,
  getPolicyByTypeApi,
  loginByPhoneApi,
  pollWxScanStatusApi,
  resetPasswordBySmsApi,
  sendForgotPasswordCodeApi,
  sendLoginCodeApi,
} from '#/api';
import { useAuthStore } from '#/store';
import { branding, resolveAssetUrl } from '#/store/branding';

defineOptions({ name: 'Login' });

const WX_LOGIN_SCRIPT =
  'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js';
const WX_LOGIN_CONTAINER_ID = 'wx_login_container';
const WX_SCAN_POLL_INTERVAL = 800;
const WX_SCAN_POLL_MAX = 30;
const PRIVACY_AGREED_CACHE_KEY = 'privacy_policy_agreed';

const authStore = useAuthStore();

type LoginType = 'admin' | 'member';
type AuthMode = 'password' | 'sms' | 'wechat';

const formRef = ref<FormInstance>();
const forgotFormRef = ref<FormInstance>();
const loginType = ref<LoginType>('member');
const authMode = ref<AuthMode>('password');
const loading = ref(false);
const passwordVisible = ref(false);

const form = reactive({
  username: '',
  password: '',
  smsPhone: '',
  smsCode: '',
});

const privacyAgreed = ref(false);
const policyDialogVisible = ref(false);
const policyLoading = ref(false);
const currentPolicy = ref<any>(null);

const forgotDialogVisible = ref(false);
const forgotSubmitting = ref(false);
const forgotSendCodeLoading = ref(false);
const forgotCountdown = ref(0);
const forgotForm = reactive({
  phoneNumber: '',
  code: '',
  newPassword: '',
  confirmPassword: '',
});

const sendCodeLoading = ref(false);
const smsCountdown = ref(0);

const wxScanLoading = ref(false);
const wxScanError = ref('');
const wxScanState = ref('');
let wxScanPollTimer: null | ReturnType<typeof setInterval> = null;
let wxScanPollCount = 0;
let smsTimer: null | ReturnType<typeof setInterval> = null;
let forgotTimer: null | ReturnType<typeof setInterval> = null;

const rules = computed<FormRules>(() => ({
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码不能少于6位', trigger: 'blur' },
  ],
  smsPhone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '手机号格式不正确',
      trigger: 'blur',
    },
  ],
  smsCode: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
}));

const forgotRules: FormRules = {
  phoneNumber: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '手机号格式不正确',
      trigger: 'blur',
    },
  ],
  code: [{ required: true, message: '请输入短信验证码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, value, callback) => {
        if (value !== forgotForm.newPassword) {
          callback(new Error('两次密码不一致'));
        } else {
          callback();
        }
      },
      trigger: 'blur',
    },
  ],
};

function readPrivacyAgreedCache() {
  try {
    return localStorage.getItem(PRIVACY_AGREED_CACHE_KEY) === '1';
  } catch {
    return false;
  }
}

function savePrivacyAgreedCache(agreed: boolean) {
  try {
    if (agreed) {
      localStorage.setItem(PRIVACY_AGREED_CACHE_KEY, '1');
    } else {
      localStorage.removeItem(PRIVACY_AGREED_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

function switchLoginType(type: LoginType) {
  loginType.value = type;
  if (type === 'admin') {
    authMode.value = 'password';
    stopWxScanPoll();
  }
}

function switchAuthMode(mode: AuthMode) {
  authMode.value = mode;
  if (mode === 'wechat') {
    void initWxScanLogin();
  } else {
    stopWxScanPoll();
  }
}

async function handleLogin() {
  if (!privacyAgreed.value) {
    ElMessage.warning('请先阅读并同意隐私政策');
    return;
  }

  if (loginType.value === 'member' && authMode.value === 'sms') {
    try {
      await formRef.value?.validateField(['smsPhone', 'smsCode']);
    } catch {
      return;
    }
    try {
      loading.value = true;
      const { accessToken } = await loginByPhoneApi({
        phoneNumber: form.smsPhone,
        code: form.smsCode,
      });
      savePrivacyAgreedCache(true);
      await authStore.loginWithToken(accessToken, 'MEMBER');
    } finally {
      loading.value = false;
    }
    return;
  }

  try {
    await formRef.value?.validateField(['username', 'password']);
  } catch {
    return;
  }

  try {
    loading.value = true;
    savePrivacyAgreedCache(true);
    if (loginType.value === 'admin') {
      await authStore.authLogin({
        username: form.username,
        password: form.password,
      });
    } else {
      await authStore.memberLogin({
        username: form.username,
        password: form.password,
      });
    }
  } finally {
    loading.value = false;
  }
}

async function handleSendSmsCode() {
  if (!/^1[3-9]\d{9}$/.test(form.smsPhone)) {
    ElMessage.warning('请输入正确手机号');
    return;
  }
  try {
    sendCodeLoading.value = true;
    await sendLoginCodeApi(form.smsPhone);
    ElMessage.success('验证码已发送');
    smsCountdown.value = 60;
    smsTimer = setInterval(() => {
      smsCountdown.value -= 1;
      if (smsCountdown.value <= 0 && smsTimer) {
        clearInterval(smsTimer);
        smsTimer = null;
      }
    }, 1000);
  } finally {
    sendCodeLoading.value = false;
  }
}

async function showPolicyDialog(policyType: string) {
  try {
    policyLoading.value = true;
    policyDialogVisible.value = true;
    currentPolicy.value = await getPolicyByTypeApi(policyType);
  } catch {
    policyDialogVisible.value = false;
  } finally {
    policyLoading.value = false;
  }
}

async function handleSendForgotCode() {
  if (!/^1[3-9]\d{9}$/.test(forgotForm.phoneNumber)) {
    ElMessage.warning('请输入正确手机号');
    return;
  }
  try {
    forgotSendCodeLoading.value = true;
    await sendForgotPasswordCodeApi(forgotForm.phoneNumber);
    ElMessage.success('验证码已发送');
    forgotCountdown.value = 60;
    forgotTimer = setInterval(() => {
      forgotCountdown.value -= 1;
      if (forgotCountdown.value <= 0 && forgotTimer) {
        clearInterval(forgotTimer);
        forgotTimer = null;
      }
    }, 1000);
  } finally {
    forgotSendCodeLoading.value = false;
  }
}

async function handleForgotSubmit() {
  try {
    await forgotFormRef.value?.validate();
  } catch {
    return;
  }
  try {
    forgotSubmitting.value = true;
    await resetPasswordBySmsApi({
      phoneNumber: forgotForm.phoneNumber,
      code: forgotForm.code,
      newPassword: forgotForm.newPassword,
    });
    ElMessage.success('密码重置成功，请登录');
    forgotDialogVisible.value = false;
  } finally {
    forgotSubmitting.value = false;
  }
}

function loadWxLoginScript() {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).WxLogin) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = WX_LOGIN_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('加载微信登录脚本失败'));
    document.body.appendChild(script);
  });
}

function stopWxScanPoll() {
  if (wxScanPollTimer) {
    clearInterval(wxScanPollTimer);
    wxScanPollTimer = null;
  }
  wxScanPollCount = 0;
}

async function initWxScanLogin() {
  stopWxScanPoll();
  wxScanError.value = '';
  wxScanLoading.value = true;
  try {
    const data = await createWxScanQrcodeApi();
    wxScanState.value = data.state;
    await nextTick();
    const container = document.getElementById(WX_LOGIN_CONTAINER_ID);
    if (container) container.innerHTML = '';
    await loadWxLoginScript();
     
    new (window as any).WxLogin({
      self_redirect: true,
      id: WX_LOGIN_CONTAINER_ID,
      appid: data.appId,
      scope: 'snsapi_login',
      redirect_uri: encodeURIComponent(data.redirectUri),
      state: data.state,
      style: 'black',
      href: '',
    });
    startWxScanPoll();
  } catch (error: any) {
    wxScanError.value = error?.message || '获取微信二维码失败';
  } finally {
    wxScanLoading.value = false;
  }
}

function startWxScanPoll() {
  stopWxScanPoll();
  wxScanPollTimer = setInterval(async () => {
    wxScanPollCount += 1;
    if (wxScanPollCount > WX_SCAN_POLL_MAX) {
      stopWxScanPoll();
      wxScanError.value = '二维码已过期，请刷新';
      return;
    }
    try {
      const res = await pollWxScanStatusApi(wxScanState.value);
      if (res.status === 'success' && res.token) {
        stopWxScanPoll();
        if (!privacyAgreed.value) {
          ElMessage.warning('请先阅读并同意隐私政策');
          return;
        }
        savePrivacyAgreedCache(true);
        await authStore.loginWithToken(res.token, 'MEMBER');
      } else if (res.status === 'expired' || res.status === 'error') {
        stopWxScanPoll();
        wxScanError.value = res.message || '扫码失败，请刷新二维码';
      }
    } catch {
      // 轮询失败不打断
    }
  }, WX_SCAN_POLL_INTERVAL);
}

function onWxScanMessage(event: MessageEvent) {
  if (event?.data?.type === 'wxScanLogin' && event.data.token) {
    stopWxScanPoll();
    if (!privacyAgreed.value) {
      ElMessage.warning('请先阅读并同意隐私政策');
      return;
    }
    savePrivacyAgreedCache(true);
    void authStore.loginWithToken(event.data.token, 'MEMBER');
  }
}

onMounted(() => {
  privacyAgreed.value = readPrivacyAgreedCache();
  window.addEventListener('message', onWxScanMessage);
});

onBeforeUnmount(() => {
  stopWxScanPoll();
  if (smsTimer) clearInterval(smsTimer);
  if (forgotTimer) clearInterval(forgotTimer);
  window.removeEventListener('message', onWxScanMessage);
});
</script>

<template>
  <div class="lemon-login">
    <div class="lemon-login__card">
      <div class="lemon-login__mobile-brand">
        <img
          v-if="branding.logo"
          alt="logo"
          class="lemon-login__mobile-logo"
          :src="resolveAssetUrl(branding.logo)"
        />
        <strong>{{ branding.accountMark || 'lemonDbClient' }}</strong>
      </div>
      <p class="lemon-login__hello">{{ branding.welcome || '欢迎回来' }}</p>
      <h1 class="lemon-login__title">登录数据工作台</h1>
      <p class="lemon-login__hint">
        {{ loginType === 'admin' ? '管理员账号进入系统配置' : '会员账号进入查询与智能体' }}
      </p>

      <div class="lemon-login__tabs" role="tablist">
        <button
          type="button"
          :class="{ active: loginType === 'member' }"
          @click="switchLoginType('member')"
        >
          会员
        </button>
        <button
          type="button"
          :class="{ active: loginType === 'admin' }"
          @click="switchLoginType('admin')"
        >
          管理员
        </button>
      </div>

      <div v-if="loginType === 'member'" class="lemon-login__modes">
        <button
          type="button"
          :class="{ active: authMode === 'password' }"
          @click="switchAuthMode('password')"
        >
          密码
        </button>
        <button
          type="button"
          :class="{ active: authMode === 'sms' }"
          @click="switchAuthMode('sms')"
        >
          验证码
        </button>
        <button
          type="button"
          :class="{ active: authMode === 'wechat' }"
          @click="switchAuthMode('wechat')"
        >
          微信
        </button>
      </div>

      <div
        v-if="loginType === 'member' && authMode === 'wechat'"
        class="lemon-login__wechat"
      >
        <div v-if="wxScanError" class="error">
          <p>{{ wxScanError }}</p>
          <ElButton type="primary" link @click="initWxScanLogin">
            重新获取
          </ElButton>
        </div>
        <template v-else>
          <div class="qrcode-wrap">
            <div v-if="wxScanLoading" class="loading">二维码加载中...</div>
            <div :id="WX_LOGIN_CONTAINER_ID" class="qrcode-box"></div>
          </div>
          <ElButton type="primary" link @click="initWxScanLogin">
            刷新二维码
          </ElButton>
        </template>
      </div>

      <ElForm
        v-show="!(loginType === 'member' && authMode === 'wechat')"
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        @keyup.enter="handleLogin"
      >
        <template v-if="authMode === 'password' || loginType === 'admin'">
          <ElFormItem prop="username">
            <ElInput
              v-model.trim="form.username"
              placeholder="请输入用户名"
              clearable
            />
          </ElFormItem>
          <ElFormItem prop="password">
            <ElInput
              v-model.trim="form.password"
              :type="passwordVisible ? 'text' : 'password'"
              placeholder="请输入密码"
              clearable
              show-password
            />
          </ElFormItem>
        </template>

        <template v-if="loginType === 'member' && authMode === 'sms'">
          <ElFormItem prop="smsPhone">
            <ElInput
              v-model.trim="form.smsPhone"
              maxlength="11"
              placeholder="请输入手机号"
              clearable
            />
          </ElFormItem>
          <ElFormItem prop="smsCode">
            <div class="sms-row">
              <ElInput
                v-model.trim="form.smsCode"
                maxlength="6"
                placeholder="请输入验证码"
              />
              <ElButton
                :disabled="smsCountdown > 0"
                :loading="sendCodeLoading"
                @click="handleSendSmsCode"
              >
                {{ smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码' }}
              </ElButton>
            </div>
          </ElFormItem>
        </template>

        <div
          v-if="loginType === 'member' && authMode === 'password'"
          class="lemon-login__extra"
        >
          <ElButton type="primary" link @click="forgotDialogVisible = true">
            忘记密码？
          </ElButton>
        </div>

        <div class="privacy">
          <ElCheckbox v-model="privacyAgreed">
            我已阅读并同意
            <a @click.prevent="showPolicyDialog('privacy_policy')">隐私政策</a>
            与
            <a @click.prevent="showPolicyDialog('user_agreement')">用户协议</a>
          </ElCheckbox>
        </div>

        <ElButton
          type="primary"
          class="submit"
          :loading="loading || authStore.loginLoading"
          @click="handleLogin"
        >
          进入工作台
        </ElButton>
      </ElForm>
    </div>

    <ElDialog
      v-model="policyDialogVisible"
      :title="currentPolicy?.title || '政策'"
      width="640px"
    >
      <div v-loading="policyLoading" class="policy-content" v-html="currentPolicy?.content || ''"></div>
    </ElDialog>

    <ElDialog
      v-model="forgotDialogVisible"
      title="找回密码"
      width="420px"
      destroy-on-close
    >
      <ElForm
        ref="forgotFormRef"
        :model="forgotForm"
        :rules="forgotRules"
        label-position="top"
      >
        <ElFormItem label="手机号" prop="phoneNumber">
          <ElInput v-model.trim="forgotForm.phoneNumber" maxlength="11" />
        </ElFormItem>
        <ElFormItem label="验证码" prop="code">
          <div class="sms-row">
            <ElInput v-model.trim="forgotForm.code" maxlength="6" />
            <ElButton
              :disabled="forgotCountdown > 0"
              :loading="forgotSendCodeLoading"
              @click="handleSendForgotCode"
            >
              {{ forgotCountdown > 0 ? `${forgotCountdown}s` : '获取验证码' }}
            </ElButton>
          </div>
        </ElFormItem>
        <ElFormItem label="新密码" prop="newPassword">
          <ElInput
            v-model.trim="forgotForm.newPassword"
            type="password"
            show-password
          />
        </ElFormItem>
        <ElFormItem label="确认密码" prop="confirmPassword">
          <ElInput
            v-model.trim="forgotForm.confirmPassword"
            type="password"
            show-password
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="forgotDialogVisible = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="forgotSubmitting"
          @click="handleForgotSubmit"
        >
          重置密码
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.lemon-login {
  width: 100%;
  max-width: 400px;
}

.lemon-login__mobile-brand {
  display: none;
  gap: 8px;
  align-items: center;
  margin-bottom: 18px;
  font-size: 16px;
}

.lemon-login__mobile-logo {
  width: 28px;
  height: 28px;
}

@media (max-width: 959px) {
  .lemon-login__mobile-brand {
    display: flex;
  }
}

.lemon-login__hello {
  margin: 0 0 6px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}

.lemon-login__title {
  margin: 0;
  font-size: 26px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.lemon-login__hint {
  margin: 8px 0 22px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
}

.lemon-login__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  margin-bottom: 14px;
  background: hsl(var(--muted));
  border-radius: 12px;
}

.lemon-login__tabs button {
  height: 36px;
  font-size: 14px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
}

.lemon-login__tabs button.active {
  font-weight: 650;
  color: #1a1400;
  background: #f2c14e;
  box-shadow: 0 4px 12px rgb(242 193 78 / 28%);
}

.lemon-login__modes {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}

.lemon-login__modes button {
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
}

.lemon-login__modes button.active {
  color: #1a1400;
  background: #f2c14e;
  border-color: #f2c14e;
}

.lemon-login__wechat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  min-height: 280px;
}

.qrcode-wrap {
  position: relative;
  width: 300px;
  min-height: 300px;
}

.qrcode-box {
  width: 300px;
  min-height: 300px;
}

.sms-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.lemon-login__extra {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}

.privacy {
  margin: 4px 0 16px;
  font-size: 13px;
}

.privacy a {
  color: hsl(var(--primary));
  cursor: pointer;
}

.submit {
  width: 100%;
  height: 42px;
  font-weight: 650;
}

.policy-content {
  max-height: 60vh;
  overflow: auto;
  line-height: 1.7;
}
</style>
