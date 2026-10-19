<script setup lang="ts">
/**
 * 工作区协同成员。所有者按登录账号邀请，成员与所有者编辑同一份草稿。
 * @author yanch
 */
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { EtlMember } from '#/api/visual/etl';
import { addEtlMember, listEtlMembers, removeEtlMember } from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';

const visible = ref(false);
const loading = ref(false);
const saving = ref(false);
const owner = ref(false);
const workspaceId = ref<string | number>('');
const userName = ref('');
const members = ref<EtlMember[]>([]);
let requestVersion = 0;

function unbox<T>(response: any): T {
  return (response?.data ?? response) as T;
}

/** 打开当前工作区的成员名单。非所有者只能查看。 */
async function open(id: string | number, isOwner: boolean) {
  workspaceId.value = id;
  owner.value = isOwner;
  userName.value = '';
  visible.value = true;
  await load();
}

async function load() {
  const request = ++requestVersion;
  loading.value = true;
  try {
    const rows = unbox<EtlMember[]>(await listEtlMembers(workspaceId.value)) || [];
    if (request !== requestVersion) return;
    members.value = rows;
  } catch (error: any) {
    if (request === requestVersion) ElMessage.error(error?.msg || error?.message || translateUiText('操作失败'));
  } finally {
    if (request === requestVersion) loading.value = false;
  }
}

async function invite() {
  const name = userName.value.trim();
  if (!name) {
    ElMessage.warning(translateUiText('请输入对方的登录账号'));
    return;
  }
  saving.value = true;
  try {
    members.value = unbox<EtlMember[]>(await addEtlMember(workspaceId.value, name)) || [];
    userName.value = '';
    ElMessage.success(translateUiText('已邀请'));
  } catch (error: any) {
    ElMessage.error(error?.msg || error?.message || translateUiText('操作失败'));
  } finally {
    saving.value = false;
  }
}

async function remove(member: EtlMember) {
  try {
    await ElMessageBox.confirm(
      translateUiText('移除后对方不能再保存这个工作区。对方电脑上未保存的内容仍在本地。继续？'),
      translateUiText('移除成员'),
      { type: 'warning' },
    );
    saving.value = true;
    members.value = unbox<EtlMember[]>(await removeEtlMember(workspaceId.value, member.userId)) || [];
    ElMessage.success(translateUiText('已移除'));
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.msg || error?.message || translateUiText('操作失败'));
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="$tr('协同成员')"
    width="min(520px, 94vw)"
    :close-on-click-modal="false"
  >
    <p class="share-hint">
      {{ $tr('被邀请的人可以和你同时编辑这一份草稿。保存时按版本合并，不会直接覆盖对方。') }}
    </p>
    <div v-if="owner" class="share-invite">
      <el-input
        v-model="userName"
        :placeholder="$tr('登录账号')"
        maxlength="30"
        @keyup.enter="invite"
      />
      <el-button type="primary" :loading="saving" @click="invite">{{ $tr('邀请') }}</el-button>
    </div>
    <p v-else class="share-hint">{{ $tr('只有工作区所有者可以邀请或移除成员。') }}</p>
    <el-table v-loading="loading" :data="members" size="small">
      <el-table-column :label="$tr('账号')" min-width="140">
        <template #default="{ row }">
          {{ row.nickName ? `${row.nickName}（${row.userName}）` : row.userName }}
        </template>
      </el-table-column>
      <el-table-column :label="$tr('角色')" width="100">
        <template #default="{ row }">
          {{ row.role === 'OWNER' ? $tr('所有者') : $tr('可编辑') }}
        </template>
      </el-table-column>
      <el-table-column v-if="owner" width="90">
        <template #default="{ row }">
          <el-button
            v-if="row.role !== 'OWNER'"
            link
            type="danger"
            :disabled="saving"
            @click="remove(row)"
          >
            {{ $tr('移除') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
.share-hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.share-invite {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
