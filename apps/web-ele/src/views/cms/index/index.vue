<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  ElButton,
  ElCol,
  ElMessage,
  ElOption,
  ElRow,
  ElSelect,
  ElSpace,
  ElTable,
  ElTableColumn,
} from 'element-plus';

import { getList } from '#/api/cms/siteApi';

defineOptions({ name: 'CmsIndex' });

const router = useRouter();
const loading = ref(false);
const sites = ref<any[]>([]);
const siteId = ref<number | string | undefined>(
  localStorage.getItem('defaultSiteId')
    ? Number(localStorage.getItem('defaultSiteId'))
    : undefined,
);

const links = [
  { title: '站点管理', path: '/cms/siteManage' },
  { title: '栏目管理', path: '/cms/cmsChannel' },
  { title: '内容管理', path: '/cms/cmsContent' },
  { title: '模型管理', path: '/cms/cmsModel' },
  { title: '全局配置', path: '/cms/cmsGlobalConfig' },
  { title: '认证码管理', path: '/cms/authCursor' },
];

async function loadSites() {
  loading.value = true;
  try {
    const res = await getList({});
    const data = res?.data ?? res;
    sites.value = Array.isArray(data) ? data : data?.list || [];
    if (!siteId.value && sites.value.length) {
      siteId.value = sites.value[0].id;
      localStorage.setItem('defaultSiteId', String(siteId.value));
    }
  } finally {
    loading.value = false;
  }
}

function changeSite(val: number | string) {
  localStorage.setItem('defaultSiteId', String(val));
  ElMessage.success('已切换默认站点');
}

function go(path: string) {
  router.push(path);
}

onMounted(loadSites);
</script>

<template>
  <Page auto-content-height title="CMS 入口">
    <ElRow :gutter="16">
      <ElCol :span="10">
        <div class="mb-4 text-base font-medium">当前站点</div>
        <ElSelect
          v-model="siteId"
          v-loading="loading"
          class="w-full"
          placeholder="请选择站点"
          @change="changeSite"
        >
          <ElOption
            v-for="item in sites"
            :key="item.id"
            :label="item.siteName"
            :value="item.id"
          />
        </ElSelect>

        <div class="mt-6 mb-3 text-base font-medium">站点列表</div>
        <ElTable :data="sites" border size="small">
          <ElTableColumn prop="id" label="ID" width="70" align="center" />
          <ElTableColumn prop="siteName" label="站点名称" min-width="140" />
          <ElTableColumn prop="siteKey" label="标识" min-width="100" />
          <ElTableColumn label="操作" width="100" align="center">
            <template #default="{ row }">
              <ElButton
                link
                type="primary"
                @click="
                  () => {
                    siteId = row.id;
                    changeSite(row.id);
                  }
                "
              >
                设为当前
              </ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </ElCol>

      <ElCol :span="14">
        <div class="mb-4 text-base font-medium">功能入口</div>
        <ElSpace wrap :size="12">
          <ElButton
            v-for="item in links"
            :key="item.path"
            type="primary"
            plain
            @click="go(item.path)"
          >
            {{ item.title }}
          </ElButton>
        </ElSpace>
      </ElCol>
    </ElRow>
  </Page>
</template>
