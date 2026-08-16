<script lang="ts" setup>
/**
 * 系统展示配置（品牌/登录页文案与图片）
 * 数据来源：sys_setting type=1，编码 ui.brand.*
 *
 * @author yanch
 */
import { onMounted, reactive, ref } from 'vue';

import {
  ElButton,
  ElCol,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElRow,
  ElTabPane,
  ElTabs,
} from 'element-plus';

import {
  fetchSystemConfigApi,
  type SystemSettingItem,
  updateSystemConfigApi,
} from '#/api/system/systemSetting';
import LemonUpload from '#/components/lemon-upload/index.vue';
import { loadRemoteBrandConfig } from '#/store/branding';

defineOptions({ name: 'SystemSetting' });

const activeName = ref('brand');
const saving = ref(false);
const loading = ref(false);
const configs = reactive<SystemSettingItem[]>([]);

const BRAND_PREFIX = 'ui.brand.';

function isBrandItem(item: SystemSettingItem) {
  return (item.configCode || '').startsWith(BRAND_PREFIX);
}

const brandConfigs = () => configs.filter(isBrandItem);
const otherConfigs = () => configs.filter((item) => !isBrandItem(item));

async function initData() {
  loading.value = true;
  try {
    const data = await fetchSystemConfigApi();
    configs.splice(0, configs.length, ...(data || []));
  } catch (error) {
    console.error(error);
    ElMessage.error('加载系统配置失败');
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!configs.length) {
    ElMessage.warning('没有可保存的配置');
    return;
  }
  saving.value = true;
  try {
    await updateSystemConfigApi([...configs]);
    // 保存后立刻刷新前端展示，无需重新登录
    await loadRemoteBrandConfig();
    ElMessage.success('更新成功');
  } catch (error) {
    console.error(error);
    ElMessage.error('更新失败');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  initData();
});
</script>

<template>
  <div v-loading="loading" class="system-setting-page p-4">
    <div class="mb-4 flex items-center gap-2">
      <ElButton type="primary" :loading="saving" @click="handleSave">
        保存
      </ElButton>
      <ElButton @click="initData">刷新</ElButton>
      <span class="text-muted text-sm text-gray-500">
        图片类请上传后保存；文本留空表示前端保持本地默认。
      </span>
    </div>

    <ElTabs v-model="activeName">
      <ElTabPane label="品牌与登录展示" name="brand">
        <ElRow :gutter="16">
          <ElCol
            v-for="item in brandConfigs()"
            :key="item.configCode"
            :xs="24"
            :sm="24"
            :md="16"
            :lg="12"
            :xl="12"
          >
            <ElFormItem :label="item.configName" :title="item.configDes">
              <LemonUpload
                v-if="item.inputType === 'img'"
                v-model="item.configValue"
                attach-code="SystemConfig"
                :image-url="item.configValue"
              />
              <ElInput
                v-else-if="item.inputType === 'textarea'"
                v-model="item.configValue"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                :placeholder="item.configDes || ''"
              />
              <ElInput
                v-else
                v-model="item.configValue"
                maxlength="200"
                clearable
                :placeholder="item.configDes || ''"
              />
            </ElFormItem>
            <div
              v-if="item.configDes"
              class="mb-3 ml-0 text-xs text-gray-400"
            >
              {{ item.configDes }}
            </div>
          </ElCol>
        </ElRow>
        <ElEmpty
          v-if="!brandConfigs().length"
          description="暂无品牌配置，请先执行 doc/database/ui_brand_sys_setting.sql"
        />
      </ElTabPane>

      <ElTabPane label="其他系统配置" name="other">
        <ElForm label-width="140px">
          <ElFormItem
            v-for="item in otherConfigs()"
            :key="item.configCode"
            :label="item.configName"
          >
            <LemonUpload
              v-if="item.inputType === 'img'"
              v-model="item.configValue"
              attach-code="SystemConfig"
              :image-url="item.configValue"
            />
            <ElInput
              v-else
              v-model="item.configValue"
              maxlength="200"
              clearable
            />
          </ElFormItem>
        </ElForm>
        <div
          v-if="!otherConfigs().length"
          class="py-8 text-center text-gray-400"
        >
          暂无其他 type=1 配置
        </div>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<style scoped>
.system-setting-page {
  min-height: 100%;
  background: var(--el-bg-color);
}

.text-muted {
  color: var(--el-text-color-secondary);
}
</style>
