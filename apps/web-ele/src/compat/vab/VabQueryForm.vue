<script lang="ts" setup>
import { ElRow } from 'element-plus';

defineOptions({ name: 'VabQueryForm' });
</script>

<template>
  <ElRow class="vab-query-form" :gutter="0">
    <slot></slot>
  </ElRow>
</template>

<style>
/* 对齐 admin-plus VabQueryForm：压掉 inline 表单项默认大间距 */
.vab-query-form {
  margin-bottom: 12px;
}

.vab-query-form .left-panel,
.vab-query-form .right-panel,
.vab-query-form .top-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-height: 32px;
  margin-bottom: 0;
}

.vab-query-form .right-panel {
  justify-content: flex-end;
}

.vab-query-form .el-form--inline .el-form-item {
  margin-right: 12px;
  margin-bottom: 0 !important;
}

.vab-query-form .el-form--inline .el-form-item:last-child {
  margin-right: 0;
}

.vab-query-form .el-button + .el-button {
  margin-left: 0;
}
</style>
