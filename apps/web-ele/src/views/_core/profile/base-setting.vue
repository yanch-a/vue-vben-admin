<script setup lang="ts">
import type {
  FormInstance,
  FormRules,
  UploadRequestOptions,
} from 'element-plus';

import { computed, onMounted, reactive, ref } from 'vue';

import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';

import { ElMessage } from 'element-plus';

import {
  getPersonalProfileApi,
  updatePersonalProfileApi,
  uploadPersonalAvatarApi,
} from '#/api';
import { $t } from '#/locales';

const emit = defineEmits<{ updated: [] }>();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const uploading = ref(false);

const form = reactive({
  avatar: '',
  email: '',
  phoneNumber: '',
  realName: '',
  remark: '',
  sex: 2,
  userName: '',
});

const isMember = computed(
  () => (userStore.userInfo as any)?.loginUserType === 'MEMBER',
);
const avatar = computed(() => form.avatar || preferences.app.defaultAvatar);

const rules = computed<FormRules>(() => ({
  email: [
    {
      message: $t('page.profile.emailInvalid'),
      trigger: 'blur',
      type: 'email',
    },
  ],
  realName: [
    { max: 30, message: $t('page.profile.realNameMax'), trigger: 'blur' },
  ],
  userName: [
    {
      required: true,
      message: $t('page.profile.usernameRequired'),
      trigger: 'blur',
    },
    {
      max: 30,
      message: $t('page.profile.usernameLength'),
      min: 2,
      trigger: 'blur',
    },
  ],
}));

/** 获取数据库中的最新资料，并同步全局用户状态。 */
async function loadProfile() {
  const data = await getPersonalProfileApi();
  Object.assign(form, {
    avatar: data.avatar || '',
    email: data.email || '',
    phoneNumber: data.phoneNumber || data.phonenumber || '',
    realName: data.realName || data.nickName || '',
    remark: data.personalSignature || data.remark || '',
    sex: Number(data.sex ?? 2),
    userName: data.userName || '',
  });
  userStore.setUserInfo({
    ...(userStore.userInfo as any),
    avatar: form.avatar,
    email: form.email,
    personalSignature: form.remark,
    phoneNumber: form.phoneNumber,
    realName: form.realName || form.userName,
    username: form.userName,
  });
}

/** 保存当前登录用户资料。 */
async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await updatePersonalProfileApi({
      email: form.email || undefined,
      phoneNumber: form.phoneNumber || undefined,
      realName: form.realName || undefined,
      remark: form.remark || undefined,
      sex: form.sex,
      userName: form.userName.trim(),
    });
    await loadProfile();
    ElMessage.success($t('page.profile.profileUpdated'));
    emit('updated');
  } finally {
    loading.value = false;
  }
}

/** 校验并上传头像，成功后立即更新全局头像。 */
async function uploadAvatar(options: UploadRequestOptions) {
  const file = options.file;
  if (!file.type.startsWith('image/')) {
    ElMessage.warning($t('page.profile.imageOnly'));
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning($t('page.profile.avatarSizeLimit'));
    return;
  }
  uploading.value = true;
  try {
    const result = await uploadPersonalAvatarApi(file);
    // 优先使用 UploadController 返回的 Tomcat/OSS 访问 URL，savePath 仅作旧接口兼容。
    form.avatar = result?.url || result?.savePath || form.avatar;
    await loadProfile();
    ElMessage.success($t('page.profile.avatarUploaded'));
    emit('updated');
  } finally {
    uploading.value = false;
  }
}

onMounted(loadProfile);
</script>

<template>
  <div class="profile-form-wrap">
    <div class="avatar-panel">
      <el-avatar :size="96" :src="avatar" />
      <el-upload
        accept="image/*"
        :disabled="uploading"
        :http-request="uploadAvatar"
        :show-file-list="false"
      >
        <el-button :loading="uploading">{{
          $t('page.profile.uploadAvatar')
        }}</el-button>
      </el-upload>
      <span class="avatar-tip">
        {{ $t('page.profile.avatarHint') }}
      </span>
    </div>

    <el-form
      ref="formRef"
      class="profile-form"
      label-position="top"
      :model="form"
      :rules="rules"
    >
      <el-row :gutter="20">
        <el-col :md="12" :xs="24">
          <el-form-item :label="$t('page.profile.username')" prop="userName">
            <el-input v-model.trim="form.userName" maxlength="30" />
          </el-form-item>
        </el-col>
        <el-col :md="12" :xs="24">
          <el-form-item :label="$t('page.profile.realName')" prop="realName">
            <el-input v-model.trim="form.realName" maxlength="30" />
          </el-form-item>
        </el-col>
        <el-col :md="12" :xs="24">
          <el-form-item :label="$t('page.profile.email')" prop="email">
            <el-input v-model.trim="form.email" maxlength="50" />
          </el-form-item>
        </el-col>
        <el-col :md="12" :xs="24">
          <el-form-item
            :label="$t('page.profile.phoneNumber')"
            prop="phoneNumber"
          >
            <el-input
              v-model.trim="form.phoneNumber"
              :disabled="isMember"
              maxlength="11"
            />
            <div v-if="isMember" class="field-tip">
              {{ $t('page.profile.memberPhoneHint') }}
            </div>
          </el-form-item>
        </el-col>
        <el-col :md="12" :xs="24">
          <el-form-item :label="$t('page.profile.sex')">
            <el-radio-group v-model="form.sex">
              <el-radio :value="0">{{ $t('page.profile.male') }}</el-radio>
              <el-radio :value="1">{{ $t('page.profile.female') }}</el-radio>
              <el-radio :value="2">{{ $t('page.profile.unknown') }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item :label="$t('page.profile.signature')">
            <el-input
              v-model="form.remark"
              maxlength="500"
              :placeholder="$t('page.profile.signaturePlaceholder')"
              :rows="4"
              show-word-limit
              type="textarea"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-button type="primary" :loading="loading" @click="handleSubmit">
        {{ $t('page.profile.saveProfile') }}
      </el-button>
    </el-form>
  </div>
</template>

<style scoped>
.profile-form-wrap {
  display: grid;
  grid-template-columns: 150px minmax(0, 720px);
  gap: 32px;
}

.avatar-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.avatar-tip,
.field-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.avatar-tip {
  text-align: center;
}

@media (max-width: 768px) {
  .profile-form-wrap {
    grid-template-columns: 1fr;
  }
}
</style>
