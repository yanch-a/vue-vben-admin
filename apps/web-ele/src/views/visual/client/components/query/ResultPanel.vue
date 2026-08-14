<script lang="ts" setup>
/**
 * 查询结果面板
 * - 选中行右键：修改（弹窗）/ 删除 / 拷贝 INSERT / 拷贝 UPDATE
 * @author yanch
 */
import type { QueryResultState } from '../../composables/useQueryTabs';
import type { TableRef } from '../../utils/resultRowSql';

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';

import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
} from '../../utils/resultRowSql';

defineOptions({ name: 'ResultPanel' });

const props = defineProps<{
  visible: boolean;
  activeTab: 'result' | 'messages';
  result: QueryResultState | null;
  executing?: boolean;
  exporting?: boolean;
  /** 解析出的目标表；为空时改删仅提示，拷贝仍尽量生成 */
  tableRef?: TableRef | null;
  dbType?: string;
  /** WHERE 优先使用的主键列名 */
  primaryKeys?: string[];
}>();

const emit = defineEmits<{
  'update:visible': [boolean];
  'update:activeTab': ['result' | 'messages'];
  /** 执行 DML 后由父级刷新结果 */
  'run-dml': [sql: string];
  /** 请求后台重查并导出 xlsx */
  export: [];
}>();

const canExport = computed(
  () => !!(props.result?.sourceSql && String(props.result.sourceSql).trim()),
);

const selectedRow = ref<Record<string, any> | null>(null);
const selectedIndex = ref(-1);

const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
});

const editVisible = ref(false);
const editForm = ref<Record<string, any>>({});
const editOriginal = ref<Record<string, any> | null>(null);

const columns = computed(() => props.result?.columns || []);
const dbType = computed(() => props.dbType || 'MY_SQL');
const whereCols = computed(() => {
  const pks = (props.primaryKeys || []).filter((k) => columns.value.includes(k));
  return pks.length ? pks : columns.value;
});

const canMutate = computed(() => !!props.tableRef?.table && !!selectedRow.value);

function closeCtxMenu() {
  ctxMenu.visible = false;
}

function onRowContextMenu(row: Record<string, any>, _col: any, event: MouseEvent) {
  event.preventDefault();
  selectedRow.value = row;
  selectedIndex.value = props.result?.rows?.indexOf(row) ?? -1;
  const pad = 8;
  const menuW = 200;
  const menuH = 160;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.visible = true;
}

function onCurrentChange(row: Record<string, any> | undefined) {
  selectedRow.value = row || null;
  selectedIndex.value = row && props.result?.rows ? props.result.rows.indexOf(row) : -1;
}

async function copyText(text: string, tip: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(tip);
  } catch {
    // 降级
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    ElMessage.success(tip);
  }
}

function requireTable(): TableRef {
  if (!props.tableRef?.table) {
    throw new Error('无法识别结果对应的表，请使用单表 SELECT（如 SELECT * FROM db.table）');
  }
  return props.tableRef;
}

function onCopyInsert() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  try {
    const ref = requireTable();
    const sql = buildInsertSql(ref, selectedRow.value, columns.value, dbType.value);
    copyText(sql, '已复制 INSERT 语句');
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成失败');
  }
}

function onCopyUpdate() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  try {
    const ref = requireTable();
    const sql = buildUpdateSql(
      ref,
      selectedRow.value,
      selectedRow.value,
      columns.value,
      whereCols.value,
      dbType.value,
    );
    copyText(sql, '已复制 UPDATE 语句');
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成失败');
  }
}

function onEdit() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  if (!canMutate.value) {
    ElMessage.warning('无法识别结果对应的表，请使用单表查询后再修改');
    return;
  }
  editOriginal.value = { ...selectedRow.value };
  editForm.value = { ...selectedRow.value };
  editVisible.value = true;
}

/**
 * 编辑框输入：原值为 NULL 且输入为空 → 保持 NULL；否则按字符串写入
 */
function onEditField(col: string, v: string) {
  const original = editOriginal.value?.[col];
  if (
    (original === null || original === undefined) &&
    (v === '' || v == null)
  ) {
    editForm.value[col] = null;
    return;
  }
  editForm.value[col] = v;
}

async function onDelete() {
  closeCtxMenu();
  if (!selectedRow.value) return;
  if (!canMutate.value) {
    ElMessage.warning('无法识别结果对应的表，请使用单表查询后再删除');
    return;
  }
  try {
    await ElMessageBox.confirm(
      '确认删除选中行？删除后不可恢复。',
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const ref = requireTable();
    const sql = buildDeleteSql(
      ref,
      selectedRow.value,
      columns.value,
      whereCols.value,
      dbType.value,
    );
    emit('run-dml', sql);
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成 DELETE 失败');
  }
}

function onSaveEdit() {
  if (!editOriginal.value) return;
  try {
    const ref = requireTable();
    const sql = buildUpdateSql(
      ref,
      editOriginal.value,
      editForm.value,
      columns.value,
      whereCols.value,
      dbType.value,
    );
    editVisible.value = false;
    emit('run-dml', sql);
  } catch (e: any) {
    ElMessage.warning(e?.message || '生成 UPDATE 失败');
  }
}

function onGlobalClick() {
  if (ctxMenu.visible) closeCtxMenu();
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('scroll', onGlobalClick, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick);
  document.removeEventListener('scroll', onGlobalClick, true);
});

watch(
  () => props.result,
  () => {
    selectedRow.value = null;
    selectedIndex.value = -1;
    closeCtxMenu();
  },
);
</script>

<template>
  <div v-show="visible" class="result-panel">
    <div class="result-header">
      <ElTabs
        :model-value="activeTab"
        class="tabs"
        @update:model-value="(v: any) => emit('update:activeTab', v)"
      >
        <ElTabPane label="Result" name="result" />
        <ElTabPane label="Messages" name="messages" />
      </ElTabs>
      <div class="header-right">
        <span v-if="tableRef?.table" class="table-hint">
          表：{{ tableRef.schema ? `${tableRef.schema}.` : '' }}{{ tableRef.table }}
        </span>
        <ElButton
          link
          type="primary"
          :loading="exporting"
          :disabled="!canExport || executing"
          @click="emit('export')"
        >
          导出 Excel
        </ElButton>
        <ElButton link type="primary" @click="emit('update:visible', false)">隐藏</ElButton>
      </div>
    </div>
    <div v-loading="executing" class="result-body">
      <template v-if="activeTab === 'result'">
        <ElTable
          v-if="result?.columns?.length"
          :data="result.rows"
          border
          stripe
          height="100%"
          size="small"
          highlight-current-row
          @current-change="onCurrentChange"
          @row-contextmenu="onRowContextMenu"
        >
          <ElTableColumn
            v-for="col in result.columns"
            :key="col"
            :prop="col"
            :label="col"
            min-width="120"
            show-overflow-tooltip
          />
        </ElTable>
        <div v-else class="empty">暂无结果</div>
      </template>
      <template v-else>
        <pre class="messages">{{
          result?.error ||
          result?.message ||
          (result
            ? `OK, ${result.rowCount} row(s)${result.elapsedMs != null ? `, ${result.elapsedMs} ms` : ''}`
            : 'Ready')
        }}</pre>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-show="ctxMenu.visible"
        class="result-ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onEdit()">
          修改…
        </div>
        <div class="item danger" :class="{ disabled: !canMutate }" @click="canMutate && onDelete()">
          删除
        </div>
        <div class="divider" />
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onCopyInsert()">
          拷贝 INSERT 语句
        </div>
        <div class="item" :class="{ disabled: !canMutate }" @click="canMutate && onCopyUpdate()">
          拷贝 UPDATE 语句
        </div>
      </div>
    </Teleport>

    <ElDialog
      v-model="editVisible"
      title="修改行"
      width="640px"
      destroy-on-close
      append-to-body
    >
      <ElForm label-width="140px" class="edit-form">
        <ElFormItem v-for="col in columns" :key="col" :label="col">
          <ElInput
            :model-value="
              editForm[col] === null || editForm[col] === undefined
                ? ''
                : String(editForm[col])
            "
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            :placeholder="
              editOriginal &&
              (editOriginal[col] === null || editOriginal[col] === undefined)
                ? 'NULL（清空仍为 NULL）'
                : '留空表示空字符串'
            "
            @update:model-value="(v: string) => onEditField(col, v)"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="editVisible = false">取消</ElButton>
        <ElButton type="primary" @click="onSaveEdit">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.result-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}
.table-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.tabs {
  flex: 1;
}
.tabs :deep(.el-tabs__header) {
  margin: 0;
}
.result-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.empty {
  padding: 16px;
  color: var(--el-text-color-secondary);
}
.messages {
  margin: 0;
  padding: 12px;
  font-size: 13px;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.edit-form {
  max-height: 55vh;
  overflow: auto;
  padding-right: 8px;
}
</style>

<style>
.result-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 180px;
  padding: 4px 0;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.result-ctx-menu .item {
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.result-ctx-menu .item:hover:not(.disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.result-ctx-menu .item.danger:hover:not(.disabled) {
  color: var(--el-color-danger);
}
.result-ctx-menu .item.disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}
.result-ctx-menu .divider {
  height: 1px;
  margin: 4px 0;
  background: var(--el-border-color-lighter);
}
</style>
