<script lang="ts" setup>
import {
  getGroupTablesWithColumns,
  getTableGroupList,
  previewSqlBySelection,
} from '#/api/visual/vq';

import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';

defineOptions({ name: 'SmartQueryDrawer' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId: number | string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  openSql: [sql: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const groupList = ref<any[]>([]);
const groupId = ref<number | string>();
const treeData = ref<any[]>([]);
const checkedKeys = ref<(string | number)[]>([]);
const loading = ref(false);
const generating = ref(false);
const previewSql = ref('');

async function loadGroups() {
  if (!props.dbConfigId) return;
  const res: any = await getTableGroupList({ dbConfigId: props.dbConfigId });
  const list = res?.data || res?.list || res || [];
  groupList.value = Array.isArray(list) ? list : [];
}

async function loadGroupTables() {
  if (!groupId.value) {
    treeData.value = [];
    return;
  }
  loading.value = true;
  try {
    const res: any = await getGroupTablesWithColumns(groupId.value);
    const tables = res?.data || res || [];
    treeData.value = (Array.isArray(tables) ? tables : []).map((t: any) => ({
      id: `t-${t.id}`,
      label: t.displayName || t.tableName,
      tableId: t.id,
      children: (t.columns || []).map((c: any) => ({
        id: c.id,
        label: c.displayName || c.fieldName,
        fieldId: c.id,
        isLeaf: true,
      })),
    }));
  } finally {
    loading.value = false;
  }
}

async function generate() {
  const fieldIds = checkedKeys.value.filter((k) => typeof k === 'number' || /^\d+$/.test(String(k)));
  if (!props.dbConfigId) {
    ElMessage.warning('请先打开连接');
    return;
  }
  if (!fieldIds.length) {
    ElMessage.warning('请勾选字段');
    return;
  }
  generating.value = true;
  try {
    const res: any = await previewSqlBySelection({
      dbConfigId: props.dbConfigId,
      groupId: groupId.value,
      fieldIds,
    });
    const data = res?.data || res;
    previewSql.value = data?.previewSql || data?.sql || '';
    if (!previewSql.value) {
      ElMessage.warning('未生成 SQL');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '生成失败，请检查关系画布是否已配置关联');
  } finally {
    generating.value = false;
  }
}

function openInQuery() {
  if (!previewSql.value) {
    ElMessage.warning('请先生成 SQL');
    return;
  }
  emit('openSql', previewSql.value);
  visible.value = false;
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) loadGroups();
  },
);

watch(groupId, () => {
  checkedKeys.value = [];
  previewSql.value = '';
  loadGroupTables();
});
</script>

<template>
  <ElDrawer v-model="visible" title="智能生成 SQL" size="480px">
    <div class="smart-query">
      <ElForm label-width="80px">
        <ElFormItem label="表分组">
          <ElSelect v-model="groupId" clearable placeholder="选择分组" class="w-full">
            <ElOption
              v-for="g in groupList"
              :key="g.id"
              :label="g.groupName || g.name"
              :value="g.id"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <div v-loading="loading" class="tree-wrap">
        <ElTree
          v-model:checked-keys="checkedKeys"
          :data="treeData"
          node-key="id"
          show-checkbox
          default-expand-all
          :props="{ label: 'label', children: 'children' }"
        />
      </div>
      <div class="actions">
        <ElButton type="primary" :loading="generating" @click="generate">生成 SQL</ElButton>
        <ElButton type="success" :disabled="!previewSql" @click="openInQuery">
          打开查询
        </ElButton>
      </div>
      <ElInput
        v-model="previewSql"
        type="textarea"
        :rows="10"
        placeholder="生成的 SQL 将显示在这里"
      />
    </div>
  </ElDrawer>
</template>

<style scoped>
.smart-query {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}
.tree-wrap {
  flex: 1;
  min-height: 200px;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px;
}
.actions {
  display: flex;
  gap: 8px;
}
.w-full {
  width: 100%;
}
</style>
