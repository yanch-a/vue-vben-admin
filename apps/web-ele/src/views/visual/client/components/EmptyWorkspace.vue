<script lang="ts" setup>
/**
 * 无已打开连接时的欢迎区：展示当前用户有权限的数据库卡片，点击即可打开连接。
 * @author yanch
 */
import { computed, onMounted, ref, watch } from 'vue';

import { getDbConfigList } from '#/api/visual/vq';
import { resolveDbType } from '../dialect/dbTypes';

defineOptions({ name: 'EmptyWorkspace' });

const props = defineProps<{
  /** 为 true 时可见并加载列表（父级无活动连接时传入） */
  active?: boolean;
}>();

const emit = defineEmits<{
  open: [conn: any];
  create: [];
}>();

const loading = ref(false);
const list = ref<any[]>([]);
const keyword = ref('');
const loadError = ref('');

/** 按名称 / 主机 / 类型等关键字过滤卡片 */
const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter((row) => {
    const hay = [
      row.dbName,
      row.dbType,
      row.dbHost,
      row.schemaName,
      row.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
});

function hostText(row: any) {
  if (!row?.dbHost) return '—';
  return row.dbPort ? `${row.dbHost}:${row.dbPort}` : String(row.dbHost);
}

function typeLabel(row: any) {
  return resolveDbType(row?.dbType).label;
}

async function loadList() {
  loading.value = true;
  loadError.value = '';
  try {
    const res: any = await getDbConfigList({});
    const raw = res?.data || res?.list || res || [];
    list.value = Array.isArray(raw) ? raw : [];
  } catch (e: any) {
    list.value = [];
    loadError.value = e?.msg || e?.message || '加载数据库列表失败';
  } finally {
    loading.value = false;
  }
}

function onCardClick(row: any) {
  if (!row?.id) return;
  emit('open', row);
}

onMounted(() => {
  if (props.active !== false) void loadList();
});

watch(
  () => props.active,
  (v) => {
    if (v) void loadList();
  },
);

defineExpose({ reload: loadList });
</script>

<template>
  <div class="empty-workspace" v-loading="loading">
    <div class="empty-workspace__head">
      <div class="empty-workspace__title">{{ $tr('选择数据库开始查询') }}</div>
      <div class="empty-workspace__desc">
        {{ $tr('以下为当前账号有权限使用的连接，点击卡片即可打开。') }}
      </div>
      <div class="empty-workspace__tools">
        <ElInput
          v-model="keyword"
          clearable
          size="default"
          class="empty-workspace__search"
          :placeholder="$tr('搜索名称 / 主机 / 类型')"
        />
        <ElButton @click="loadList">{{ $tr('刷新') }}</ElButton>
        <ElButton type="primary" @click="emit('create')">{{ $tr('新建连接') }}</ElButton>
      </div>
    </div>

    <div v-if="loadError" class="empty-workspace__error">{{ loadError }}</div>

    <div v-else-if="!loading && list.length === 0" class="empty-workspace__blank">
      <p>{{ $tr('暂无可用数据库连接') }}</p>
      <p class="hint">{{ $tr('请先新建连接，或联系管理员为你授权。') }}</p>
      <ElButton type="primary" @click="emit('create')">{{ $tr('新建连接') }}</ElButton>
    </div>

    <div v-else-if="!loading && filteredList.length === 0" class="empty-workspace__blank">
      <p>{{ $tr('没有匹配「') }}{{ keyword }}{{ $tr('」的连接') }}</p>
    </div>

    <div v-else class="empty-workspace__grid">
      <button
        v-for="row in filteredList"
        :key="row.id"
        type="button"
        class="db-card"
        @click="onCardClick(row)"
      >
        <div class="db-card__top">
          <span class="db-card__name" :title="row.dbName">{{ $tr(row.dbName || '未命名') }}</span>
          <span class="db-card__type">{{ typeLabel(row) }}</span>
        </div>
        <div class="db-card__meta">
          <span class="db-card__host" :title="hostText(row)">{{ hostText(row) }}</span>
          <span v-if="row.schemaName" class="db-card__schema" :title="row.schemaName">
            {{ row.schemaName }}
          </span>
        </div>
        <div v-if="row.description" class="db-card__desc" :title="row.description">
          {{ row.description }}
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.empty-workspace {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px 32px 40px;
  box-sizing: border-box;
}

.empty-workspace__head {
  max-width: 960px;
  margin: 0 auto 20px;
}

.empty-workspace__title {
  font-size: calc(var(--vc-ui-font-size, 13px) + 7px);
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.empty-workspace__desc {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: var(--vc-ui-font-size, 13px);
}

.empty-workspace__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  align-items: center;
}

.empty-workspace__search {
  width: min(280px, 100%);
}

.empty-workspace__error,
.empty-workspace__blank {
  max-width: 960px;
  margin: 48px auto 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.empty-workspace__blank .hint {
  margin: 8px 0 16px;
  font-size: calc(var(--vc-ui-font-size, 13px) - 1px);
  color: var(--el-text-color-placeholder);
}

.empty-workspace__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  max-width: 960px;
  margin: 0 auto;
}

.db-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: inherit;
  font: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
}

.db-card:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 1px 6px rgb(0 0 0 / 6%);
}

.db-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.db-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.db-card__name {
  font-weight: 600;
  font-size: calc(var(--vc-ui-font-size, 13px) + 1px);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.db-card__type {
  flex-shrink: 0;
  font-size: calc(var(--vc-ui-font-size, 13px) - 1px);
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.db-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: calc(var(--vc-ui-font-size, 13px) - 1px);
  color: var(--el-text-color-regular);
}

.db-card__host,
.db-card__schema {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.db-card__schema::before {
  content: '· ';
  color: var(--el-text-color-placeholder);
}

.db-card__desc {
  font-size: calc(var(--vc-ui-font-size, 13px) - 1px);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
