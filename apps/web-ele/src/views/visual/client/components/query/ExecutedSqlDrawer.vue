<script lang="ts" setup>
/**
 * 某个数据库连接最近执行过的 SQL。数据来自前端内存，不请求后台。
 *
 * @author yanch
 */
import { computed, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';

import {
  EXECUTED_SQL_LIMIT,
  filterExecutedSql,
  listExecutedSql,
} from '../../utils/executedSqlHistory';

defineOptions({ name: 'ExecutedSqlDrawer' });

const props = defineProps<{
  modelValue: boolean;
  dbConfigId?: number | string | null;
  connectionName?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const keyword = ref('');

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const entries = computed(() =>
  filterExecutedSql(listExecutedSql(props.dbConfigId), keyword.value),
);

const title = computed(() => {
  const name = props.connectionName?.trim();
  return name ? `已执行 SQL · ${name}` : '已执行 SQL';
});

watch(
  () => props.dbConfigId,
  () => {
    keyword.value = '';
  },
);

function formatTime(ts: number) {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function copySql(sql: string) {
  try {
    await navigator.clipboard.writeText(sql);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}
</script>

<template>
  <ElDrawer v-model="visible" :title="title" direction="rtl" size="420px" append-to-body>
    <div class="executed-sql">
      <ElInput
        v-model="keyword"
        clearable
        size="small"
        :placeholder="$tr('检索 SQL 或库名')"
      />
      <p class="hint">
        {{ $tr('仅保存在当前页面，最多') }} {{ EXECUTED_SQL_LIMIT }} {{ $tr('条，关闭页面后清空') }}
      </p>
      <div v-if="!entries.length" class="empty">
        {{ keyword.trim() ? $tr('没有匹配的 SQL') : $tr('这个连接还没有执行过 SQL') }}
      </div>
      <ul v-else class="list">
        <li v-for="item in entries" :key="item.id" class="row">
          <div class="meta">
            <span>{{ formatTime(item.executedAt) }}</span>
            <span v-if="item.instanceName">{{ item.instanceName }}</span>
            <span :class="item.success ? 'ok' : 'fail'">
              {{ item.success ? $tr('成功') : $tr('失败') }}
            </span>
            <button type="button" class="copy" @click="copySql(item.sql)">
              {{ $tr('复制') }}
            </button>
          </div>
          <pre class="sql">{{ item.sql }}</pre>
        </li>
      </ul>
    </div>
  </ElDrawer>
</template>

<style scoped>
.executed-sql {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.hint,
.empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  flex: 1;
}
.row {
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.ok {
  color: var(--el-color-success);
}
.fail {
  color: var(--el-color-danger);
}
.copy {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
}
.sql {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
}
</style>
