<script lang="ts" setup>
/**
 * SQL 编辑器工具栏：当前连接的环境标签 + 变更窗口状态
 * （「变更窗口开放至 22:00」/「当前不在变更窗口」）。窗口外直接执行写操作会被后端拦截。
 * @author yanch
 */
import type { DbConnection } from '../composables/useConnectionStore';
import type { ChangeWindowStatus } from '../utils/connectionEnv';

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { getChangeWindowStatus } from '#/api/visual/changeWindow';

import {
  envDisplayName,
  envTagType,
  formatChangeWindowStatus,
  resolveConnectionEnv,
} from '../utils/connectionEnv';

defineOptions({ name: 'ChangeWindowBadge' });

const props = defineProps<{
  connection?: DbConnection | null;
}>();

/** 状态刷新间隔：窗口边界精确到分钟，1 分钟足够 */
const REFRESH_MS = 60_000;

const status = ref<ChangeWindowStatus | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let seq = 0;

const env = computed(() => resolveConnectionEnv(props.connection));
const view = computed(() => formatChangeWindowStatus(status.value));

const envTitle = computed(() => {
  const name = envDisplayName(env.value.env);
  return env.value.source === 'LEGACY_NAME'
    ? `${name}（未设置环境标签，按名称关键词识别）`
    : name;
});

async function refresh() {
  const id = props.connection?.id;
  const current = ++seq;
  if (id === undefined || id === null || id === '') {
    status.value = null;
    return;
  }
  try {
    const res: any = await getChangeWindowStatus(id);
    if (current !== seq) return;
    status.value = (res?.data ?? res) || null;
  } catch {
    // 状态只是提示：接口不可用（旧后端/无权限）时隐藏，不影响编辑器
    if (current === seq) status.value = null;
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') refresh();
}

watch(
  () => props.connection?.id,
  () => {
    status.value = null;
    refresh();
  },
);

onMounted(() => {
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('visibilitychange', onVisibility);
});

defineExpose({ refresh });
</script>

<template>
  <span v-if="connection" class="change-window-badge">
    <ElTag
      v-if="env.text"
      size="small"
      :type="envTagType(env.env)"
      :effect="env.env === 'PROD' ? 'dark' : 'light'"
      :title="$tr(envTitle)"
    >
      {{ env.text }}{{ env.source === 'LEGACY_NAME' ? '?' : '' }}
    </ElTag>
    <ElTooltip
      v-if="view.level !== 'none'"
      :content="$tr(view.detail || view.text)"
      placement="bottom"
      :show-after="300"
    >
      <ElTag size="small" :type="view.tagType" effect="plain" class="window-tag">
        {{ $tr(view.text) }}
      </ElTag>
    </ElTooltip>
  </span>
</template>

<style scoped>
.change-window-badge {
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  margin-left: auto;
}

.window-tag {
  cursor: default;
}
</style>
