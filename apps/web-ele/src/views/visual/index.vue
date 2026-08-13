<script lang="ts" setup>
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { ElButton, ElCol, ElRow } from 'element-plus';

defineOptions({ name: 'VisualIndex' });

const router = useRouter();

const links = [
  { title: '数据源配置', desc: '管理数据库连接、表分组与关系画布', path: '/visual/dbConfig' },
  { title: '可视化查询', desc: '配置查询、预览 SQL 并执行查看结果', path: '/visual/visualQuery' },
];

function go(path: string) {
  router.push(path);
}
</script>

<template>
  <Page auto-content-height title="可视化查询">
    <ElRow :gutter="16">
      <ElCol v-for="item in links" :key="item.path" :span="12">
        <div
          class="cursor-pointer rounded border border-solid border-[var(--el-border-color)] p-5 transition hover:border-[var(--el-color-primary)]"
          @click="go(item.path)"
        >
          <div class="mb-2 text-lg font-medium">{{ item.title }}</div>
          <div class="text-sm text-[var(--el-text-color-secondary)]">
            {{ item.desc }}
          </div>
          <ElButton class="mt-4" type="primary" link @click.stop="go(item.path)">
            进入 →
          </ElButton>
        </div>
      </ElCol>
    </ElRow>
  </Page>
</template>
