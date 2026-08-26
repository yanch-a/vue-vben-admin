<script lang="ts" setup>
/**
 * 对象树右键菜单（SQLyog 风格）
 * - instance(库)：创建库 / 删除库 / 导入(预留) / 复制到不同主机 / 执行 SQL 脚本
 * - tables 文件夹：创建表 / 将表复制到不同主机
 * - table：打开表 / 删除表 / 改变表 / 复制 DDL / 复制到不同主机
 * - savedQuery：打开 / 重命名 / 删除 / 复制 SQL
 * @author yanch
 */
defineOptions({ name: 'ObjectTreeContextMenu' });

export type TreeCtxAction =
  | 'createDatabase'
  | 'dropDatabase'
  | 'importData'
  | 'runSqlScript'
  | 'createTable'
  | 'copyDbToHost'
  | 'openTable'
  | 'viewTableInfo'
  | 'dropTable'
  | 'alterTable'
  | 'copyDdl'
  | 'exportTableExcel'
  | 'exportTableSql'
  | 'openSavedQuery'
  | 'renameSavedQuery'
  | 'deleteSavedQuery'
  | 'copySavedQuerySql';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    x: number;
    y: number;
    /** instance | folder | table | savedQuery */
    targetType: string;
    /** folder 时的 objectKind，如 tables / queries */
    objectKind?: string;
    /** 一级节点称呼：数据库 / 模式（Oracle 族） */
    instanceLabel?: string;
    /** 是否允许建删一级节点；Oracle/达梦由 DBA 操作，SQLite 由文件系统决定 */
    canManageInstance?: boolean;
  }>(),
  { instanceLabel: '数据库', canManageInstance: true },
);

const emit = defineEmits<{
  close: [];
  action: [action: TreeCtxAction];
}>();

const isDb = () => props.targetType === 'instance';
const isTablesFolder = () =>
  props.targetType === 'folder' && props.objectKind === 'tables';
const isTable = () => props.targetType === 'table';
const isSavedQuery = () => props.targetType === 'savedQuery';

function onAction(action: TreeCtxAction) {
  emit('action', action);
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="obj-ctx-menu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <template v-if="isDb()">
        <template v-if="canManageInstance">
          <div class="item" @click="onAction('createDatabase')">
            创建{{ instanceLabel }}
          </div>
          <div class="item danger" @click="onAction('dropDatabase')">
            删除{{ instanceLabel }}
          </div>
          <div class="divider" />
        </template>
        <div class="item muted" @click="onAction('importData')">导入数据（预留）</div>
        <div class="item" @click="onAction('copyDbToHost')">
          将{{ instanceLabel }}复制到不同主机
        </div>
        <div class="item" @click="onAction('runSqlScript')">执行 SQL 脚本（预览）</div>
      </template>
      <template v-else-if="isTablesFolder()">
        <div class="item" @click="onAction('createTable')">创建表</div>
        <div class="item" @click="onAction('copyDbToHost')">将表复制到不同主机</div>
      </template>
      <template v-else-if="isTable()">
        <div class="item" @click="onAction('openTable')">打开表 (F11)</div>
        <div class="item" @click="onAction('viewTableInfo')">查看表信息</div>
        <div class="item danger" @click="onAction('dropTable')">删除表</div>
        <div class="item" @click="onAction('alterTable')">改变表</div>
        <div class="item" @click="onAction('copyDdl')">复制 DDL</div>
        <div class="item" @click="onAction('copyDbToHost')">将表复制到不同主机</div>
        <div class="divider" />
        <div class="item" @click="onAction('exportTableExcel')">导出为 Excel</div>
        <div class="item" @click="onAction('exportTableSql')">导出为 SQL</div>
      </template>
      <template v-else-if="isSavedQuery()">
        <div class="item" @click="onAction('openSavedQuery')">打开</div>
        <div class="item" @click="onAction('renameSavedQuery')">重命名</div>
        <div class="item" @click="onAction('copySavedQuerySql')">复制 SQL</div>
        <div class="item danger" @click="onAction('deleteSavedQuery')">删除</div>
      </template>
      <div v-else class="item muted">暂无可用操作</div>
    </div>
  </Teleport>
</template>

<style scoped>
.obj-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 200px;
  padding: 4px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.item {
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.item.danger:hover {
  color: var(--el-color-danger);
}
.item.muted {
  color: var(--el-text-color-secondary);
}
.divider {
  height: 1px;
  margin: 4px 0;
  background: var(--el-border-color-lighter);
}
</style>
