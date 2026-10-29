<script lang="ts" setup>
/**
 * 把当前 SQL 工作现场存到服务器，或从本人的历史现场里取回一份。
 * 本地还没有持久化 id 时只能新建；已有 id 时默认更新这一条，也可以另存。
 *
 * @author yanch
 */
import { computed, ref, watch } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';

import {
  addClientSession,
  deleteClientSession,
  getClientSession,
  listClientSessions,
  updateClientSession,
  type ClientSessionListItem,
} from '#/api/visual/clientSession';

import type { ClientSessionSnapshot } from '../composables/useClientSessionPersist';

defineOptions({ name: 'WorkspaceSnapshotDialog' });

const props = defineProps<{
  modelValue: boolean;
  mode: 'load' | 'save';
  persistId: string;
  persistAlias: string;
  snapshot: ClientSessionSnapshot | null;
}>();

const emit = defineEmits<{
  'update:modelValue': (value: boolean) => void;
  saved: (payload: { id: string; alias: string }) => void;
  loaded: (payload: { id: string; alias: string; snapshot: unknown }) => void;
  /** 删掉的是当前本地关联的那一条，前台应忘掉这个 id */
  unlinked: (id: string) => void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const aliasName = ref('');
const clientLabel = ref('');
/** create：新建一条；update：覆盖 persistId 对应的记录 */
const saveMode = ref<'create' | 'update'>('create');
const saving = ref(false);
const loadingList = ref(false);
const rows = ref<ClientSessionListItem[]>([]);

const linked = computed(() => !!props.persistId);
const title = computed(() => (props.mode === 'save' ? '保存工作现场' : '加载工作现场'));

watch(
  () => [props.modelValue, props.mode] as const,
  ([open, mode]) => {
    if (!open) return;
    if (mode === 'save') {
      saveMode.value = props.persistId ? 'update' : 'create';
      aliasName.value = props.persistAlias || '';
      clientLabel.value = describeClientLabel();
      return;
    }
    void loadRows();
  },
);

function describeClientLabel() {
  const ua = navigator.userAgent || '';
  let browser = '浏览器';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  const platform = navigator.platform || '';
  return `${platform} · ${browser}`.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function formatTime(value: unknown) {
  if (value == null || value === '') return '';
  return String(value).replace('T', ' ').slice(0, 19);
}

async function loadRows() {
  loadingList.value = true;
  try {
    const res: any = await listClientSessions();
    const list = res?.data ?? res;
    rows.value = Array.isArray(list) ? list : [];
  } catch (e: any) {
    rows.value = [];
    ElMessage.error(e?.msg || e?.message || '加载现场列表失败');
  } finally {
    loadingList.value = false;
  }
}

async function onSave() {
  const alias = aliasName.value.trim();
  if (!alias) {
    ElMessage.warning('请填写现场别名');
    return;
  }
  if (!props.snapshot?.connections?.length) {
    ElMessage.warning('当前没有可保存的连接');
    return;
  }
  const asNew = !linked.value || saveMode.value === 'create';
  saving.value = true;
  try {
    const payload = {
      aliasName: alias,
      clientLabel: clientLabel.value.trim(),
      snapshot: props.snapshot,
    };
    const res: any = asNew
      ? await addClientSession(payload)
      : await updateClientSession({ ...payload, id: props.persistId });
    const data = res?.data || res;
    const id = String(data?.id || (asNew ? '' : props.persistId));
    if (!id) {
      ElMessage.error('保存成功但没有返回现场编号');
      return;
    }
    emit('saved', { id, alias });
    visible.value = false;
  } catch (e: any) {
    ElMessage.error(e?.msg || e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function onLoad(row: ClientSessionListItem) {
  try {
    await ElMessageBox.confirm(
      `加载「${row.aliasName}」会覆盖当前已打开的连接和查询。`,
      '加载工作现场',
      { type: 'warning', confirmButtonText: '加载', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const res: any = await getClientSession(row.id);
    const data = res?.data || res;
    let snapshot = data?.snapshot;
    if (typeof snapshot === 'string') {
      snapshot = JSON.parse(snapshot);
    }
    if (!snapshot) {
      ElMessage.error('这份现场没有可恢复的内容');
      return;
    }
    emit('loaded', {
      id: String(data?.id || row.id),
      alias: String(data?.aliasName || row.aliasName || ''),
      snapshot,
    });
    visible.value = false;
  } catch (e: any) {
    if (e === 'cancel' || e?.action === 'cancel') return;
    ElMessage.error(e?.msg || e?.message || '加载失败');
  }
}

async function onDelete(row: ClientSessionListItem) {
  try {
    await ElMessageBox.confirm(`删除现场「${row.aliasName}」？`, '删除工作现场', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteClientSession(row.id);
    const id = String(row.id);
    if (id === props.persistId) emit('unlinked', id);
    ElMessage.success('已删除');
    await loadRows();
  } catch (e: any) {
    if (e === 'cancel' || e?.action === 'cancel') return;
    ElMessage.error(e?.msg || e?.message || '删除失败');
  }
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="title"
    :width="mode === 'save' ? '480px' : '760px'"
    append-to-body
    destroy-on-close
  >
    <template v-if="mode === 'save'">
      <p class="hint">
        保存的是当前已打开的连接和 SQL。密码和查询结果不会上传。同一账号可以保存多份，换一台电脑登录后从列表取回。
      </p>
      <ElForm label-width="88px" @submit.prevent>
        <ElFormItem v-if="linked" label="保存方式">
          <ElRadioGroup v-model="saveMode">
            <ElRadio value="update">更新「{{ persistAlias || '当前现场' }}」</ElRadio>
            <ElRadio value="create">另存为新现场</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem label="别名" required>
          <ElInput
            v-model="aliasName"
            maxlength="100"
            show-word-limit
            placeholder="例如：客户库排查"
          />
        </ElFormItem>
        <ElFormItem label="这台电脑">
          <ElInput
            v-model="clientLabel"
            maxlength="200"
            placeholder="用于在另一台电脑上辨认是哪次保存"
          />
        </ElFormItem>
      </ElForm>
    </template>
    <template v-else>
      <ElTable v-loading="loadingList" :data="rows" empty-text="还没有保存过工作现场" height="360">
        <ElTableColumn prop="aliasName" label="别名" min-width="160" show-overflow-tooltip />
        <ElTableColumn prop="clientLabel" label="客户端" min-width="160" show-overflow-tooltip />
        <ElTableColumn prop="connectionCount" label="连接" width="70" />
        <ElTableColumn prop="tabCount" label="查询" width="70" />
        <ElTableColumn label="更新时间" min-width="160">
          <template #default="{ row }">{{ formatTime(row.updateTime) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" @click="onLoad(row)">加载</ElButton>
            <ElButton link type="danger" @click="onDelete(row)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </template>
    <template v-if="mode === 'save'" #footer>
      <ElButton @click="visible = false">取消</ElButton>
      <ElButton type="primary" :loading="saving" @click="onSave">保存</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--vc-ui-font-size-sm, 13px);
  line-height: 1.5;
}
</style>
