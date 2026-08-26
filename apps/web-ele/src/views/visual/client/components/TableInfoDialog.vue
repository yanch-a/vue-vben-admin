<script lang="ts" setup>
/**
 * 表信息弹窗：基本信息 / 字段 / 索引 / DDL
 * 数据由 getTableInfo 按方言聚合
 *
 * @author yanch
 */
import { computed } from 'vue';

defineOptions({ name: 'TableInfoDialog' });

const props = defineProps<{
  modelValue: boolean;
  loading?: boolean;
  info?: {
    tableName?: string;
    instanceName?: string;
    schemaName?: string;
    description?: string;
    tableType?: string;
    ddl?: string;
    columns?: Array<{
      fieldName?: string;
      dataType?: string;
      isPrimary?: boolean;
      isNullable?: boolean;
      defaultValue?: string;
      description?: string;
    }>;
    indexes?: Array<{
      indexName?: string;
      unique?: boolean;
      indexType?: string;
      columns?: string;
    }>;
    properties?: Record<string, string>;
  } | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const title = computed(() => {
  const t = props.info?.tableName || '';
  const s = props.info?.schemaName || props.info?.instanceName || '';
  return s ? `表信息：${s}.${t}` : `表信息：${t}`;
});

const propertyRows = computed(() => {
  const p = props.info?.properties || {};
  return Object.entries(p).map(([k, v]) => ({ key: k, value: v }));
});
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="title"
    width="780px"
    destroy-on-close
    class="table-info-dialog"
  >
    <div v-loading="loading">
      <ElTabs v-if="info">
        <ElTabPane label="基本信息">
          <ElDescriptions :column="2" border size="small">
            <ElDescriptionsItem label="表名">
              {{ info.tableName }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="实例">
              {{ info.instanceName }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="Schema">
              {{ info.schemaName || '-' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="类型">
              {{ info.tableType || 'TABLE' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="注释" :span="2">
              {{ info.description || '-' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem
              v-for="row in propertyRows"
              :key="row.key"
              :label="row.key"
            >
              {{ row.value }}
            </ElDescriptionsItem>
          </ElDescriptions>
        </ElTabPane>

        <ElTabPane :label="`字段 (${info.columns?.length || 0})`">
          <ElTable
            :data="info.columns || []"
            size="small"
            max-height="360"
            border
            stripe
          >
            <ElTableColumn prop="fieldName" label="字段名" min-width="120" />
            <ElTableColumn prop="dataType" label="类型" min-width="120" />
            <ElTableColumn label="主键" width="60" align="center">
              <template #default="{ row }">
                {{ row.isPrimary ? '是' : '' }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="可空" width="60" align="center">
              <template #default="{ row }">
                {{ row.isNullable ? '是' : '否' }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="defaultValue" label="默认值" min-width="100" />
            <ElTableColumn prop="description" label="注释" min-width="140" />
          </ElTable>
        </ElTabPane>

        <ElTabPane :label="`索引 (${info.indexes?.length || 0})`">
          <ElEmpty
            v-if="!(info.indexes && info.indexes.length)"
            description="无索引信息"
          />
          <ElTable
            v-else
            :data="info.indexes"
            size="small"
            max-height="360"
            border
            stripe
          >
            <ElTableColumn prop="indexName" label="索引名" min-width="140" />
            <ElTableColumn label="唯一" width="60" align="center">
              <template #default="{ row }">
                {{ row.unique ? '是' : '否' }}
              </template>
            </ElTableColumn>
            <ElTableColumn prop="indexType" label="类型" min-width="90" />
            <ElTableColumn prop="columns" label="列/定义" min-width="220" />
          </ElTable>
        </ElTabPane>

        <ElTabPane label="DDL">
          <pre class="ddl-block">{{ info.ddl || '-- 无 DDL' }}</pre>
        </ElTabPane>
      </ElTabs>
      <ElEmpty v-else-if="!loading" description="暂无表信息" />
    </div>
    <template #footer>
      <ElButton @click="visible = false">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.ddl-block {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
