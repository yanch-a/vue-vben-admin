<script>
  import { defineAsyncComponent, defineComponent, ref } from 'vue'

  export default defineComponent({
    name: 'SystemLog',
    components: {
      OperLog: defineAsyncComponent(() => import('./operLog.vue')),
      LoginLog: defineAsyncComponent(() => import('./loginLog.vue')),
    },
    setup() {
      const activeTab = ref('oper')
      return { activeTab }
    },
  })
</script>

<template>
  <div class="system-log-management-container system-log-tabs">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="操作日志" name="oper" lazy>
        <OperLog />
      </el-tab-pane>
      <el-tab-pane label="登录日志" name="login" lazy>
        <LoginLog />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
  /* 子页作为 Tab 内容时去掉外层容器样式，避免双重 padding */
  .system-log-tabs :deep(.system-log-management-container) {
    min-height: auto;
    padding: 0;
    background: transparent;
  }
</style>
