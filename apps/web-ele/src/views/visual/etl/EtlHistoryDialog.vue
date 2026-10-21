<script setup lang="ts">
/**
 * 工作区历史快照。只负责列出和发起切换，真正写回草稿由页面处理。
 * 这里的版本是保存时留下的草稿，和发布给定时用的版本不是同一份。
 * @author yanch
 */
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { EtlHistoryVersion } from '#/api/visual/etl';
import { listEtlHistory } from '#/api/visual/etl';
import { translateUiText } from '#/locales/ui-text';

defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ restore: [item: EtlHistoryVersion] }>();

const visible = ref(false);
const loading = ref(false);
const workspaceId = ref<string | number>('');
const rows = ref<EtlHistoryVersion[]>([]);
let requestVersion = 0;

function unbox<T>(response: any): T {
  return (response?.data ?? response) as T;
}

/** 打开并重新拉取，避免上次打开后新保存的版本不出现。 */
async function open(id: string | number) {
  workspaceId.value = id;
  rows.value = [];
  visible.value = true;
  await load();
}

function close() {
  visible.value = false;
}

async function load() {
  const request = ++requestVersion;
  loading.value = true;
  try {
    const list = unbox<EtlHistoryVersion[]>(await listEtlHistory(workspaceId.value)) || [];
    if (request !== requestVersion) return;
    rows.value = list;
  } catch (error: any) {
    if (request === requestVersion) {
      ElMessage.error(error?.msg || error?.message || translateUiText('操作失败'));
    }
  } finally {
    if (request === requestVersion) loading.value = false;
  }
}

/** 保存时间已经是 yyyy-MM-dd HH:mm:ss，只截到分钟。 */
function formatTime(value?: string) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

defineExpose({ open, close });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="$tr('历史版本')"
    width="min(720px, 94vw)"
    :close-on-click-modal="false"
  >
    <p class="history-hint">
      {{ $tr('这里保存的是草稿快照，用来回退配置。它和「发布」给定时执行用的版本不是同一份。') }}
    </p>
    <div v-loading="loading" class="history-body">
    <el-table v-if="rows.length" :data="rows" size="small">
      <el-table-column :label="$tr('版本')" width="80" prop="versionNo" />
      <el-table-column :label="$tr('说明')" min-width="180">
        <template #default="{ row }">
          {{ row.remark || $tr('没有说明') }}
        </template>
      </el-table-column>
      <el-table-column :label="$tr('保存时间')" width="160">
        <template #default="{ row }">
          {{ formatTime(row.createTime) }}
        </template>
      </el-table-column>
      <el-table-column width="130">
        <template #default="{ row }">
          <el-button link type="primary" :disabled="busy" @click="emit('restore', row)">
            {{ $tr('切换到此版本') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty
      v-if="!loading && !rows.length"
      :image-size="64"
      :description="$tr('还没有历史版本。保存时选择「保存为新版本」后会出现在这里。')"
    />
    </div>
  </el-dialog>
</template>

<style scoped>
.history-hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.history-body {
  min-height: 120px;
}
</style>
