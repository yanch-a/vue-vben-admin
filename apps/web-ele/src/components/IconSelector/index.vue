<script lang="ts" setup>
import { computed, ref, watch } from 'vue';

import { IconifyIcon } from '@vben/icons';

import { getAllRemixIconNames } from '@/api/remixIcon';
import {
  ElButton,
  ElDialog,
  ElInput,
  ElMessage,
  ElPagination,
  ElTag,
} from 'element-plus';

type LibItem = {
  group: 'color' | 'legacy' | 'mono';
  key: string;
  label: string;
  offline?: boolean;
  /** Iconify collection prefix；remix-local 为本地旧库 */
  prefix: string;
};

defineOptions({ name: 'IconSelector' });

/**
 * 顶部标签切换图标库（不用下拉，避免被 Dialog 遮挡）
 * Remix 本地列表 = 原 admin-plus 图标库，可离线
 */
const ICON_LIBS: LibItem[] = [
  { key: 'remix', label: 'Remix（原系统）', prefix: 'ri', group: 'legacy', offline: true },
  { key: 'lucide', label: 'Lucide', prefix: 'lucide', group: 'mono' },
  { key: 'ep', label: 'Element Plus', prefix: 'ep', group: 'mono' },
  { key: 'carbon', label: 'Carbon', prefix: 'carbon', group: 'mono' },
  { key: 'mdi', label: 'Material', prefix: 'mdi', group: 'mono' },
  { key: 'ant-design', label: 'Ant Design', prefix: 'ant-design', group: 'mono' },
  { key: 'tabler', label: 'Tabler', prefix: 'tabler', group: 'mono' },
  { key: 'fa6-solid', label: 'Font Awesome', prefix: 'fa6-solid', group: 'mono' },
  { key: 'flat-color-icons', label: 'Flat Color', prefix: 'flat-color-icons', group: 'color' },
  { key: 'icon-park', label: 'IconPark 彩', prefix: 'icon-park', group: 'color' },
  { key: 'vscode-icons', label: 'VSCode Icons', prefix: 'vscode-icons', group: 'color' },
  { key: 'logos', label: 'Logos', prefix: 'logos', group: 'color' },
  { key: 'twemoji', label: 'Twemoji', prefix: 'twemoji', group: 'color' },
  { key: 'fluent-emoji-flat', label: 'Fluent Emoji', prefix: 'fluent-emoji-flat', group: 'color' },
];

const GROUP_LABEL: Record<LibItem['group'], string> = {
  legacy: '原系统',
  mono: '单色',
  color: '彩色',
};

const iconCache = new Map<string, string[]>();

async function fetchRemoteIcons(prefix: string): Promise<string[]> {
  if (iconCache.has(prefix)) return iconCache.get(prefix)!;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    // 国内可换镜像；失败会提示
    const res = await fetch(
      `https://api.iconify.design/collection?prefix=${prefix}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list: string[] = [...(data.uncategorized || [])];
    if (data.categories) {
      for (const key of Object.keys(data.categories)) {
        list.push(...(data.categories[key] || []));
      }
    }
    if (list.length === 0 && data.aliases) {
      list.push(...Object.keys(data.aliases));
    }
    const full = [...new Set(list)].map((name) => `${prefix}:${name}`);
    iconCache.set(prefix, full);
    return full;
  } catch (error) {
    console.error(`加载图标集失败: ${prefix}`, error);
    ElMessage.warning(`加载 ${prefix} 失败，请检查网络或改用「Remix（原系统）」`);
    return [];
  }
}

function loadRemixLocal(): string[] {
  const cacheKey = 'remix-local';
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;
  // 存库兼容旧格式：裸名；预览时加 ri:
  const full = getAllRemixIconNames().map((name) => `ri:${name}`);
  iconCache.set(cacheKey, full);
  return full;
}

const modelValue = defineModel<string>({ default: '' });

const visible = ref(false);
const loading = ref(false);
const keyword = ref('');
const activeKey = ref('remix');
const icons = ref<string[]>([]);
const page = ref(1);
const pageSize = 60;

const activeLib = computed((): LibItem => {
  return ICON_LIBS.find((i) => i.key === activeKey.value) ?? ICON_LIBS[0]!;
});

const displayIcon = computed(() => {
  const v = modelValue.value?.trim();
  if (!v) return 'ri:question-line';
  if (v.includes(':')) return v;
  return `ri:${v}`;
});

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return icons.value;
  return icons.value.filter((item) => item.toLowerCase().includes(kw));
});

const paged = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filtered.value.slice(start, start + pageSize);
});

const total = computed(() => filtered.value.length);

const libsByGroup = computed(() => {
  const map: Record<string, LibItem[]> = { legacy: [], mono: [], color: [] };
  for (const lib of ICON_LIBS) {
    (map[lib.group] ??= []).push(lib);
  }
  return map;
});

watch(keyword, () => {
  page.value = 1;
});

watch(activeKey, async () => {
  page.value = 1;
  keyword.value = '';
  await loadCurrentLib();
});

async function loadCurrentLib() {
  loading.value = true;
  const lib = activeLib.value;
  if (lib.offline) {
    icons.value = loadRemixLocal();
  } else {
    icons.value = await fetchRemoteIcons(lib.prefix);
  }
  loading.value = false;
}

function resolveActiveKeyFromValue(val?: string) {
  if (!val) return 'remix';
  if (!val.includes(':')) return 'remix';
  const prefix = val.split(':')[0];
  const hit = ICON_LIBS.find((i) => i.prefix === prefix);
  return hit?.key || 'remix';
}

async function open() {
  visible.value = true;
  activeKey.value = resolveActiveKeyFromValue(modelValue.value);
  await loadCurrentLib();
}

function pick(icon: string) {
  // Remix：存裸名，兼容旧 admin-plus；其它：存 iconify 全名
  if (activeLib.value.key === 'remix') {
    modelValue.value = icon.replace(/^ri:/, '');
  } else {
    modelValue.value = icon;
  }
  visible.value = false;
}

function clear() {
  modelValue.value = '';
}

function cellName(icon: string) {
  return icon.includes(':') ? icon.split(':')[1] : icon;
}
</script>

<template>
  <div class="icon-selector">
    <ElInput
      :model-value="modelValue"
      clearable
      placeholder="点击选择图标（支持原 Remix / 多图标库）"
      readonly
      @clear="clear"
      @click="open"
    >
      <template #prepend>
        <IconifyIcon :icon="displayIcon" class="icon-preview" />
      </template>
      <template #append>
        <ElButton @click="open">选择</ElButton>
      </template>
    </ElInput>

    <ElDialog
      v-model="visible"
      append-to-body
      destroy-on-close
      title="选择图标"
      width="860px"
      :z-index="5000"
    >
      <div class="lib-section">
        <div
          v-for="(libs, group) in libsByGroup"
          :key="group"
          class="lib-row"
        >
          <span class="lib-row__label">{{ GROUP_LABEL[group as LibItem['group']] }}</span>
          <div class="lib-row__tags">
            <ElTag
              v-for="lib in libs"
              :key="lib.key"
              class="lib-tag"
              :effect="activeKey === lib.key ? 'dark' : 'plain'"
              :type="activeKey === lib.key ? 'primary' : 'info'"
              @click="activeKey = lib.key"
            >
              {{ lib.label }}
            </ElTag>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <ElInput
          v-model="keyword"
          clearable
          :placeholder="
            activeLib.key === 'remix'
              ? '搜索原图标，如 settings-3-line / user-line'
              : '搜索图标名称，如 settings / user'
          "
        />
      </div>

      <div class="hint">
        当前：<b>{{ activeLib.label }}</b>
        <template v-if="activeLib.offline">（本地内置，无需联网，与旧系统一致）</template>
        <template v-else-if="activeLib.group === 'color'">（彩色图标）</template>
        <template v-else>（需访问 Iconify，失败请用 Remix）</template>
      </div>

      <div v-loading="loading" class="icon-grid">
        <button
          v-for="item in paged"
          :key="item"
          class="icon-cell"
          :class="{
            active:
              modelValue === item ||
              modelValue === item.replace(/^ri:/, '') ||
              displayIcon === item,
          }"
          :title="item"
          type="button"
          @click="pick(item)"
        >
          <IconifyIcon :icon="item" class="icon-cell__icon" />
          <span class="icon-cell__name">{{ cellName(item) }}</span>
        </button>
        <div v-if="!loading && paged.length === 0" class="empty">
          暂无图标
        </div>
      </div>

      <div class="pager">
        <ElPagination
          v-model:current-page="page"
          background
          layout="total, prev, pager, next"
          :page-size="pageSize"
          small
          :total="total"
        />
      </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.icon-selector {
  width: 100%;
}

.icon-preview {
  display: inline-flex;
  font-size: 18px;
  vertical-align: middle;
}

.lib-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.lib-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.lib-row__label {
  flex: none;
  width: 52px;
  padding-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.lib-row__tags {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 6px;
}

.lib-tag {
  cursor: pointer;
  user-select: none;
}

.toolbar {
  margin-bottom: 8px;
}

.hint {
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  min-height: 320px;
  max-height: 440px;
  overflow: auto;
}

.icon-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  height: 78px;
  padding: 6px;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.icon-cell:hover,
.icon-cell.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.icon-cell__icon {
  font-size: 24px;
}

.icon-cell__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 1.2;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.empty {
  grid-column: 1 / -1;
  padding: 48px 0;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
