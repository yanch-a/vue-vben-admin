<script lang="ts" setup>
import GenericObjectTree from './GenericObjectTree.vue';

defineOptions({ name: 'PostgresObjectTree' });

defineProps<{
  dbConfigId: number | string;
  filterText?: string;
}>();

const emit = defineEmits<{
  openTable: [payload: { instanceName: string; tableName: string }];
  insertName: [name: string];
}>();
</script>

<template>
  <GenericObjectTree
    :db-config-id="dbConfigId"
    :filter-text="filterText"
    db-type-label="PostgreSQL"
    @open-table="emit('openTable', $event)"
    @insert-name="emit('insertName', $event)"
  />
</template>
