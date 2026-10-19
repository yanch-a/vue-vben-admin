<script setup lang="ts">
/**
 * 把其他工作区里选中的任务节点追加到当前工作区。
 * 只改本地草稿，不立刻保存，也不覆盖当前已有节点。
 * @author yanch
 */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { EtlWorkspaceDocument, EtlWorkspaceRow } from '#/api/visual/etl';
import { getEtlWorkspace } from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';
import { parseEtlJson } from './etlSafeJson';
import { normalizeSqlDocument } from './etlModel';
import { importWorkspaceNodes } from './etlCollabMerge';

const props = defineProps<{
  workspaces: EtlWorkspaceRow[];
  currentId?: string | number;
  document: EtlWorkspaceDocument;
}>();
const emit = defineEmits<{
  apply: [document: EtlWorkspaceDocument, summary: string];
}>();

const visible = ref(false);
const loadingId = ref('');
const applying = ref(false);
/** 工作区 id -> 已加载文档，以及 nodeKey(pipelineId/nodeId) 是否选中 */
const loaded = ref<
  Record<string, { document: EtlWorkspaceDocument; checked: Record<string, boolean> }>
>({});

const candidates = computed(() =>
  props.workspaces.filter((item) => String(item.id) !== String(props.currentId)),
);

function unbox<T>(response: any): T {
  return (response?.data ?? response) as T;
}
function nodeKey(pipelineId: string, nodeId: string) {
  return `${pipelineId}/${nodeId}`;
}

function open() {
  loaded.value = {};
  visible.value = true;
}

async function toggleWorkspace(row: EtlWorkspaceRow, checked: boolean) {
  const id = String(row.id);
  if (!checked) {
    const next = { ...loaded.value };
    delete next[id];
    loaded.value = next;
    return;
  }
  if (loaded.value[id]) return;
  loadingId.value = id;
  try {
    const detail = unbox<EtlWorkspaceRow>(await getEtlWorkspace(row.id));
    const document = normalizeSqlDocument(parseEtlJson(detail.draftJson || '{}'));
    const checks: Record<string, boolean> = {};
    for (const pipeline of document.pipelines) {
      for (const node of pipeline.nodes) checks[nodeKey(pipeline.id, node.id)] = true;
    }
    loaded.value = { ...loaded.value, [id]: { document, checked: checks } };
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || translateUiText('操作失败'));
  } finally {
    loadingId.value = '';
  }
}

function setNode(workspaceId: string, key: string, checked: boolean) {
  const current = loaded.value[workspaceId];
  if (!current) return;
  loaded.value = {
    ...loaded.value,
    [workspaceId]: { ...current, checked: { ...current.checked, [key]: checked } },
  };
}

function apply() {
  const sources = candidates.value.flatMap((row) => {
    const item = loaded.value[String(row.id)];
    if (!item) return [];
    const nodesByPipeline: Record<string, string[]> = {};
    for (const pipeline of item.document.pipelines) {
      const ids = pipeline.nodes
        .filter((node) => item.checked[nodeKey(pipeline.id, node.id)])
        .map((node) => node.id);
      if (ids.length) nodesByPipeline[pipeline.id] = ids;
    }
    if (!Object.keys(nodesByPipeline).length) return [];
    return [{ label: row.workspaceName || String(row.id), document: item.document, nodesByPipeline }];
  });
  if (!sources.length) {
    ElMessage.warning(translateUiText('请至少选择一个节点'));
    return;
  }
  applying.value = true;
  try {
    const result = importWorkspaceNodes(props.document, sources);
    if (!result.nodeCount) {
      ElMessage.warning(translateUiText('请至少选择一个节点'));
      return;
    }
    const summary = [
      `${translateUiText('已并入')} ${result.nodeCount} ${translateUiText('个节点')}`,
      result.renamedResources.length
        ? `${translateUiText('数据源重名已改名')} ${result.renamedResources.join('、')}`
        : '',
      result.keptVariables.length
        ? `${translateUiText('同名变量保留当前工作区')} ${result.keptVariables.join('、')}`
        : '',
    ]
      .filter(Boolean)
      .join('；');
    emit('apply', result.document, summary);
    visible.value = false;
  } finally {
    applying.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="$tr('合并到当前工作区')"
    width="min(860px, 96vw)"
    :close-on-click-modal="false"
  >
    <p class="merge-hint">
      {{ $tr('勾选其他工作区里要并入的任务和节点。相同 ID 会自动改名，不会覆盖当前工作区已有节点。') }}
    </p>
    <el-empty v-if="!candidates.length" :image-size="64" :description="$tr('没有其他工作区')" />
    <div v-for="row in candidates" :key="String(row.id)" class="merge-workspace">
      <el-checkbox
        :model-value="Boolean(loaded[String(row.id)])"
        :disabled="loadingId === String(row.id)"
        @change="toggleWorkspace(row, Boolean($event))"
      >
        {{ row.workspaceName }}
      </el-checkbox>
      <div v-if="loaded[String(row.id)]" class="merge-tree">
        <div
          v-for="pipeline in loaded[String(row.id)]!.document.pipelines"
          :key="pipeline.id"
          class="merge-pipeline"
        >
          <strong>{{ pipeline.name || pipeline.id }}</strong>
          <el-checkbox
            v-for="node in pipeline.nodes"
            :key="node.id"
            :model-value="loaded[String(row.id)]!.checked[`${pipeline.id}/${node.id}`]"
            @change="setNode(String(row.id), `${pipeline.id}/${node.id}`, Boolean($event))"
          >
            {{ node.name || node.id }}
          </el-checkbox>
          <span v-if="!pipeline.nodes.length" class="merge-empty">{{ $tr('这个任务没有节点') }}</span>
        </div>
        <span v-if="!loaded[String(row.id)]!.document.pipelines.length" class="merge-empty">
          {{ $tr('这个工作区没有任务') }}
        </span>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">{{ $tr('取消') }}</el-button>
      <el-button type="primary" :loading="applying" @click="apply">{{ $tr('并入当前工作区') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.merge-hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.merge-workspace {
  padding: 8px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}
.merge-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 0 24px;
}
.merge-pipeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}
.merge-empty {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
