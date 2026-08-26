<script lang="ts" setup>
/**
 * 已保存查询文件管理
 * - 树状展示分组 + 查询
 * - 新建/重命名/删除分组；查询改分组、删除
 * - 关键字搜索名称/描述/SQL，结果可直接打开编辑器
 * - 打开时：已有连接则复用，否则新开连接后再打开 SQL Tab
 *
 * @author yanch
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { getDbConfigById } from '#/api/visual/vq';
import {
  addSavedQueryGroup,
  deleteSavedQuery,
  deleteSavedQueryGroup,
  editSavedQuery,
  editSavedQueryGroup,
  searchSavedQueries,
  treeSavedQueries,
} from '#/api/visual/savedQuery';
import { Page } from '@vben/common-ui';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  useConnectionStore,
} from '../client/composables/useConnectionStore';
import { setPendingSavedQueryOpen } from '../client/composables/usePendingSavedQuery';
import { visualClientConfig } from '../client/config';

defineOptions({ name: 'SavedQueryManage' });

const router = useRouter();
const { openConnections, openConnection, setActiveConnection } =
  useConnectionStore();

interface TreeNode {
  id: string;
  label: string;
  nodeType: 'group' | 'query';
  rawId: number | string;
  parentId?: number | string | null;
  groupId?: number | string | null;
  dbConfigId?: number | string;
  dbName?: string;
  instanceName?: string;
  sqlText?: string;
  description?: string;
  children?: TreeNode[];
}

const loading = ref(false);
const treeData = ref<TreeNode[]>([]);
const filterKeyword = ref('');
const searching = ref(false);
const searchResults = ref<any[]>([]);
const searchMode = computed(() => !!filterKeyword.value.trim());

const groupDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'rename',
  groupName: '',
  parentId: null as number | string | null,
  editId: null as number | string | null,
  saving: false,
});

const moveDialog = reactive({
  visible: false,
  queryId: null as number | string | null,
  queryName: '',
  groupId: 0 as number | string,
  groupOptions: [] as { id: number | string; label: string }[],
  saving: false,
});

function mapTree(nodes: any[]): TreeNode[] {
  return (nodes || []).map((n) => ({
    id: `${n.nodeType}-${n.id}`,
    label: n.label,
    nodeType: n.nodeType,
    rawId: n.id,
    parentId: n.parentId,
    groupId: n.groupId,
    dbConfigId: n.dbConfigId,
    dbName: n.dbName,
    instanceName: n.instanceName,
    sqlText: n.sqlText,
    description: n.description,
    children: n.children?.length ? mapTree(n.children) : undefined,
  }));
}

/** 扁平收集真实分组（排除虚拟「未分组」id=-1）供移动下拉 */
function collectGroupOptions(
  nodes: TreeNode[],
  prefix = '',
): { id: number | string; label: string }[] {
  const list: { id: number | string; label: string }[] = [];
  for (const n of nodes) {
    if (n.nodeType !== 'group') continue;
    if (String(n.rawId) === '-1') {
      if (n.children?.length) {
        list.push(...collectGroupOptions(n.children, prefix));
      }
      continue;
    }
    const label = prefix ? `${prefix} / ${n.label}` : n.label;
    list.push({ id: n.rawId, label });
    if (n.children?.length) {
      list.push(...collectGroupOptions(n.children, label));
    }
  }
  return list;
}

async function loadTree() {
  loading.value = true;
  try {
    const res: any = await treeSavedQueries();
    treeData.value = mapTree(res?.data || res || []);
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '加载失败');
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

async function onSearch() {
  const kw = filterKeyword.value.trim();
  if (!kw) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    const res: any = await searchSavedQueries({ keyword: kw });
    searchResults.value = res?.data || res || [];
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '搜索失败');
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
}

function clearSearch() {
  filterKeyword.value = '';
  searchResults.value = [];
}

function openCreateGroup(parentId: number | string | null = null) {
  // 虚拟未分组下不允许建子组
  if (parentId != null && String(parentId) === '-1') {
    parentId = null;
  }
  groupDialog.mode = 'create';
  groupDialog.groupName = '';
  groupDialog.parentId = parentId;
  groupDialog.editId = null;
  groupDialog.visible = true;
}

function openRenameGroup(node: TreeNode) {
  if (String(node.rawId) === '-1') {
    ElMessage.warning('系统节点不可重命名');
    return;
  }
  groupDialog.mode = 'rename';
  groupDialog.groupName = node.label;
  groupDialog.editId = node.rawId;
  groupDialog.parentId = node.parentId ?? null;
  groupDialog.visible = true;
}

async function confirmGroupDialog() {
  const name = groupDialog.groupName.trim();
  if (!name) {
    ElMessage.warning('请输入分组名称');
    return;
  }
  groupDialog.saving = true;
  try {
    if (groupDialog.mode === 'create') {
      await addSavedQueryGroup({
        groupName: name,
        parentId: groupDialog.parentId || undefined,
      });
      ElMessage.success('分组已创建');
    } else if (groupDialog.editId != null) {
      await editSavedQueryGroup({
        id: groupDialog.editId,
        groupName: name,
      });
      ElMessage.success('已重命名');
    }
    groupDialog.visible = false;
    await loadTree();
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '操作失败');
  } finally {
    groupDialog.saving = false;
  }
}

async function onDeleteGroup(node: TreeNode) {
  if (String(node.rawId) === '-1') {
    ElMessage.warning('系统节点不可删除');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除分组「${node.label}」？子分组一并删除，组内查询将变为未分组（不会删除查询）。`,
      '删除分组',
      { type: 'warning' },
    );
    await deleteSavedQueryGroup(node.rawId);
    ElMessage.success('已删除');
    await loadTree();
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') {
      ElMessage.error(e?.msg || e?.message || '删除失败');
    }
  }
}

function openMoveQuery(node: TreeNode) {
  moveDialog.queryId = node.rawId;
  moveDialog.queryName = node.label;
  moveDialog.groupId = node.groupId != null ? node.groupId : 0;
  moveDialog.groupOptions = [
    { id: 0, label: '未分组' },
    ...collectGroupOptions(treeData.value),
  ];
  moveDialog.visible = true;
}

async function confirmMoveQuery() {
  if (moveDialog.queryId == null) return;
  moveDialog.saving = true;
  try {
    await editSavedQuery({
      id: moveDialog.queryId,
      groupId: moveDialog.groupId,
    });
    ElMessage.success('已调整分组');
    moveDialog.visible = false;
    await loadTree();
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '调整失败');
  } finally {
    moveDialog.saving = false;
  }
}

async function onDeleteQuery(id: number | string, name: string) {
  try {
    await ElMessageBox.confirm(`确认删除查询「${name}」？`, '删除查询', {
      type: 'warning',
    });
    await deleteSavedQuery(id);
    ElMessage.success('已删除');
    if (searchMode.value) {
      await onSearch();
    }
    await loadTree();
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') {
      ElMessage.error(e?.msg || e?.message || '删除失败');
    }
  }
}

/**
 * 打开 SQL 编辑器：已有连接则复用，否则拉取配置新开连接
 */
async function openInEditor(payload: {
  id: number | string;
  queryName: string;
  sqlText: string;
  instanceName: string;
  dbConfigId: number | string;
}) {
  if (payload.dbConfigId == null) {
    ElMessage.warning('该查询缺少连接信息，无法打开');
    return;
  }
  const existed = openConnections.value.find(
    (c) => String(c.id) === String(payload.dbConfigId),
  );
  if (existed) {
    setActiveConnection(existed.sessionId);
  } else {
    try {
      const res: any = await getDbConfigById({ id: payload.dbConfigId });
      const cfg = res?.data || res;
      if (!cfg?.id) {
        ElMessage.error('连接配置不存在或无权访问');
        return;
      }
      if (cfg.connectionStatus === 0) {
        ElMessage.warning('该连接已禁用，无法打开');
        return;
      }
      const result = openConnection({
        id: cfg.id,
        dbName: cfg.dbName,
        schemaName: cfg.schemaName,
        dbType: cfg.dbType,
        dbHost: cfg.dbHost,
        dbPort: cfg.dbPort,
        username: cfg.username,
        description: cfg.description,
        connectionStatus: cfg.connectionStatus,
      });
      if (!result.ok) {
        if (result.reason === 'max') {
          ElMessage.warning(
            `最多同时打开 ${visualClientConfig.maxOpenConnections} 个数据库连接，请先关闭其它连接`,
          );
        }
        return;
      }
    } catch (e: any) {
      ElMessage.error(e?.msg || e?.message || '打开连接失败');
      return;
    }
  }

  setPendingSavedQueryOpen({
    id: payload.id,
    queryName: payload.queryName,
    sqlText: payload.sqlText || '',
    instanceName: payload.instanceName,
    dbConfigId: payload.dbConfigId,
  });
  router.push({ name: 'VisualClient' });
}

function onNodeDblClick(data: TreeNode) {
  if (data.nodeType !== 'query') return;
  void openInEditor({
    id: data.rawId,
    queryName: data.label,
    sqlText: data.sqlText || '',
    instanceName: data.instanceName || '',
    dbConfigId: data.dbConfigId!,
  });
}

function backToClient() {
  router.push({ name: 'VisualClient' });
}

onMounted(() => {
  void loadTree();
});
</script>

<template>
  <Page auto-content-height content-class="!p-0">
    <div class="sq-manage">
      <div class="toolbar">
        <ElButton size="small" @click="backToClient">返回客户端</ElButton>
        <ElButton type="primary" size="small" @click="openCreateGroup(null)">
          新建分组
        </ElButton>
        <ElButton size="small" :loading="loading" @click="loadTree">
          刷新
        </ElButton>
        <div class="search-box">
          <ElInput
            v-model="filterKeyword"
            clearable
            size="small"
            placeholder="搜索查询名称 / 描述 / SQL 内容"
            @keyup.enter="onSearch"
            @clear="clearSearch"
          />
          <ElButton
            type="primary"
            size="small"
            :loading="searching"
            @click="onSearch"
          >
            搜索
          </ElButton>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchMode" class="search-panel" v-loading="searching">
        <div class="panel-title">
          搜索结果（{{ searchResults.length }}）
          <ElButton link type="primary" size="small" @click="clearSearch">
            返回树状管理
          </ElButton>
        </div>
        <ElEmpty
          v-if="!searchResults.length && !searching"
          description="无匹配查询"
        />
        <div
          v-for="row in searchResults"
          :key="row.id"
          class="search-row"
          @dblclick="
            openInEditor({
              id: row.id,
              queryName: row.queryName,
              sqlText: row.sqlText,
              instanceName: row.instanceName,
              dbConfigId: row.dbConfigId,
            })
          "
        >
          <div class="row-main">
            <span class="name">{{ row.queryName }}</span>
            <span class="meta">
              {{ row.dbName || row.dbConfigId }} / {{ row.instanceName }}
              <template v-if="row.groupName"> · {{ row.groupName }}</template>
            </span>
          </div>
          <div class="preview">{{ row.sqlPreview || row.sqlText }}</div>
          <div class="row-actions">
            <ElButton
              type="primary"
              link
              size="small"
              @click="
                openInEditor({
                  id: row.id,
                  queryName: row.queryName,
                  sqlText: row.sqlText,
                  instanceName: row.instanceName,
                  dbConfigId: row.dbConfigId,
                })
              "
            >
              打开编辑器
            </ElButton>
            <ElButton
              type="danger"
              link
              size="small"
              @click="onDeleteQuery(row.id, row.queryName)"
            >
              删除
            </ElButton>
          </div>
        </div>
      </div>

      <!-- 树状管理 -->
      <div v-else class="tree-panel" v-loading="loading">
        <ElEmpty
          v-if="!treeData.length && !loading"
          description="暂无已保存查询，可在 SQL 编辑器中 Ctrl+S 保存，或拖入 .sql/.txt"
        />
        <ElTree
          v-else
          :data="treeData"
          node-key="id"
          default-expand-all
          :props="{ label: 'label', children: 'children' }"
        >
          <template #default="{ data }">
            <div class="tree-node" @dblclick="onNodeDblClick(data)">
              <span class="node-label">
                <span
                  class="tag"
                  :class="data.nodeType === 'group' ? 'tag-g' : 'tag-q'"
                >
                  {{ data.nodeType === 'group' ? '组' : 'SQL' }}
                </span>
                {{ data.label }}
                <span
                  v-if="data.nodeType === 'query'"
                  class="node-meta"
                >
                  {{ data.dbName || data.dbConfigId }} / {{ data.instanceName }}
                </span>
              </span>
              <span class="node-actions" @click.stop>
                <template v-if="data.nodeType === 'group'">
                  <ElButton
                    v-if="String(data.rawId) !== '-1'"
                    link
                    type="primary"
                    size="small"
                    @click="openCreateGroup(data.rawId)"
                  >
                    子分组
                  </ElButton>
                  <ElButton
                    v-if="String(data.rawId) !== '-1'"
                    link
                    size="small"
                    @click="openRenameGroup(data)"
                  >
                    重命名
                  </ElButton>
                  <ElButton
                    v-if="String(data.rawId) !== '-1'"
                    link
                    type="danger"
                    size="small"
                    @click="onDeleteGroup(data)"
                  >
                    删除
                  </ElButton>
                </template>
                <template v-else>
                  <ElButton
                    link
                    type="primary"
                    size="small"
                    @click="
                      openInEditor({
                        id: data.rawId,
                        queryName: data.label,
                        sqlText: data.sqlText || '',
                        instanceName: data.instanceName || '',
                        dbConfigId: data.dbConfigId,
                      })
                    "
                  >
                    打开
                  </ElButton>
                  <ElButton link size="small" @click="openMoveQuery(data)">
                    改分组
                  </ElButton>
                  <ElButton
                    link
                    type="danger"
                    size="small"
                    @click="onDeleteQuery(data.rawId, data.label)"
                  >
                    删除
                  </ElButton>
                </template>
              </span>
            </div>
          </template>
        </ElTree>
      </div>
    </div>

    <ElDialog
      v-model="groupDialog.visible"
      :title="groupDialog.mode === 'create' ? '新建分组' : '重命名分组'"
      width="420px"
      destroy-on-close
    >
      <ElForm label-width="80px" @submit.prevent>
        <ElFormItem label="名称" required>
          <ElInput
            v-model="groupDialog.groupName"
            maxlength="100"
            show-word-limit
            placeholder="分组名称"
            @keyup.enter="confirmGroupDialog"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="groupDialog.visible = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="groupDialog.saving"
          @click="confirmGroupDialog"
        >
          确定
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="moveDialog.visible"
      title="调整查询分组"
      width="420px"
      destroy-on-close
    >
      <p class="move-tip">查询：{{ moveDialog.queryName }}</p>
      <ElForm label-width="80px">
        <ElFormItem label="目标分组">
          <ElSelect v-model="moveDialog.groupId" style="width: 100%">
            <ElOption
              v-for="g in moveDialog.groupOptions"
              :key="g.id"
              :label="g.label"
              :value="g.id"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="moveDialog.visible = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="moveDialog.saving"
          @click="confirmMoveQuery"
        >
          确定
        </ElButton>
      </template>
    </ElDialog>
  </Page>
</template>

<style scoped>
.sq-manage {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--el-bg-color);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
  flex-wrap: wrap;
}
.search-box {
  display: flex;
  gap: 6px;
  margin-left: auto;
  min-width: 320px;
  flex: 1;
  max-width: 520px;
}
.tree-panel,
.search-panel {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
}
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 600;
}
.tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 8px;
  gap: 8px;
}
.node-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 18px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 11px;
  flex-shrink: 0;
}
.tag-g {
  background: var(--el-color-warning-light-7);
  color: var(--el-color-warning-dark-2);
}
.tag-q {
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}
.node-actions {
  display: none;
  flex-shrink: 0;
}
.tree-node:hover .node-actions {
  display: inline-flex;
  gap: 2px;
}
.search-row {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
}
.search-row:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-lighter);
}
.row-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.row-main .name {
  font-weight: 600;
}
.row-main .meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.preview {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-actions {
  margin-top: 4px;
}
.move-tip {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
}
</style>
