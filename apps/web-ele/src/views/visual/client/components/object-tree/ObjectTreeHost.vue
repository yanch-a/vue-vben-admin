<script lang="ts" setup>
/**
 * 按数据库类型选择对象树组件（MySQL 完整；其它库走 Generic 骨架）
 * 统一转发 selectInstance / openSavedQuery，并对外暴露 reload / reloadQueries。
 *
 * @author yanch
 */
import { computed, ref } from 'vue';

import type { TreeCtxAction } from './ObjectTreeContextMenu.vue';

import GenericObjectTree from './GenericObjectTree.vue';
import MysqlObjectTree from './MysqlObjectTree.vue';
import { useMysqlStyleObjectTree } from '../../dialect/sqlDialect';

defineOptions({ name: 'ObjectTreeHost' });

const props = defineProps<{
  dbConfigId: number | string;
  dbType: string;
  filterText?: string;
}>();

const emit = defineEmits<{
  openTable: [payload: { instanceName: string; tableName: string }];
  insertName: [name: string];
  /** 单击库节点：同步编辑器当前库 */
  selectInstance: [instanceName: string];
  openSavedQuery: [
    payload: {
      id: number | string;
      queryName: string;
      sqlText: string;
      instanceName: string;
    },
  ];
  contextAction: [
    payload: {
      action: TreeCtxAction;
      node: any;
    },
  ];
}>();

/** 当前激活的树组件（MySQL 族或 Generic），用于转发 reloadQueries */
const treeInnerRef = ref<{
  reload?: () => void;
  reloadQueries?: (instanceName: string) => void;
} | null>(null);

/**
 * MySQL 族（含 OceanBase/TDSQL/PolarDB-MySQL）用完整树；
 * 其它族先 Generic。达梦/金仓等元数据差异大时再加专用树即可，不必动编辑器。
 */
const kind = computed(() =>
  useMysqlStyleObjectTree(props.dbType) ? 'mysql' : 'generic',
);

function reload() {
  treeInnerRef.value?.reload?.();
}

/** 刷新某库下 Queries 文件夹（保存/删除后由父级调用） */
function reloadQueries(instanceName: string) {
  treeInnerRef.value?.reloadQueries?.(instanceName);
}

defineExpose({ reload, reloadQueries });
</script>

<template>
  <MysqlObjectTree
    v-if="kind === 'mysql'"
    ref="treeInnerRef"
    :db-config-id="dbConfigId"
    :filter-text="filterText"
    @open-table="emit('openTable', $event)"
    @insert-name="emit('insertName', $event)"
    @select-instance="emit('selectInstance', $event)"
    @open-saved-query="emit('openSavedQuery', $event)"
    @context-action="emit('contextAction', $event)"
  />
  <GenericObjectTree
    v-else
    ref="treeInnerRef"
    :db-config-id="dbConfigId"
    :filter-text="filterText"
    :db-type-label="dbType"
    @open-table="emit('openTable', $event)"
    @insert-name="emit('insertName', $event)"
    @select-instance="emit('selectInstance', $event)"
    @open-saved-query="emit('openSavedQuery', $event)"
    @context-action="emit('contextAction', $event)"
  />
</template>
