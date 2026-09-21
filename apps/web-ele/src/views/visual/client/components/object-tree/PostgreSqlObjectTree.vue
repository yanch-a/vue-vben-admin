<script lang="ts" setup>
/**
 * PostgreSQL 方言族对象树入口。
 * 显式开启 database → schema → object folder 层级，不改变默认 MySQL 树。
 *
 * @author yanch
 */
import { ref } from 'vue';

import ObjectTree from './ObjectTree.vue';

defineOptions({ name: 'PostgreSqlObjectTree', inheritAttrs: false });

const props = defineProps<{
  dbConfigId: number | string;
  dbType: string;
  filterText?: string;
  activeInstanceName?: string;
}>();

const treeRef = ref<InstanceType<typeof ObjectTree>>();

/** 向工作台透传对象树命令。 */
defineExpose({
  reload: () => treeRef.value?.reload?.(),
  reloadInstance: (instanceName: string) => treeRef.value?.reloadInstance?.(instanceName),
  reloadQueries: (instanceName: string) => treeRef.value?.reloadQueries?.(instanceName),
  reloadTables: (instanceName: string) => treeRef.value?.reloadTables?.(instanceName),
  reloadFolder: (kind: string, instanceName: string) => treeRef.value?.reloadFolder?.(kind, instanceName),
  locateTarget: (options: any) => treeRef.value?.locateTarget?.(options),
  closeContextMenu: () => treeRef.value?.closeContextMenu?.(),
  openBlankContextMenu: (event: MouseEvent) => treeRef.value?.openBlankContextMenu?.(event),
});
</script>

<template>
  <ObjectTree
    ref="treeRef"
    v-bind="$attrs"
    :db-config-id="props.dbConfigId"
    :db-type="props.dbType"
    :filter-text="props.filterText"
    :active-instance-name="props.activeInstanceName"
    schema-mode="postgresql"
  />
</template>
