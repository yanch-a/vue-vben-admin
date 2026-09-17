<script lang="ts" setup>
import type { SqlAuditRuleVO } from '#/api/visual/sqlAuditRules';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Refresh, RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  listSqlAuditRules,
  resetSqlAuditRule,
  updateSqlAuditRule,
} from '#/api/visual/sqlAuditRules';

defineOptions({ name: 'SqlAuditRules' });

const loading = ref(false);
const savingCode = ref('');
const rows = ref<SqlAuditRuleVO[]>([]);
const query = reactive({
  keyword: '',
  severity: '',
  source: '',
  enabled: '' as '' | '1' | '0',
});

const severityOptions = [
  { label: 'ERROR（拦截提交）', value: 'ERROR' },
  { label: 'WARNING（可提交）', value: 'WARNING' },
  { label: 'OFF（关闭）', value: 'OFF' },
];

function unbox(res: any) {
  return res?.data ?? res;
}

const filteredRows = computed(() => {
  const kw = query.keyword.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (query.severity && row.severity !== query.severity) return false;
    if (query.source && row.source !== query.source) return false;
    if (query.enabled === '1' && !row.enabled) return false;
    if (query.enabled === '0' && row.enabled) return false;
    if (!kw) return true;
    const blob = `${row.code || ''} ${row.name || ''} ${row.description || ''}`.toLowerCase();
    return blob.includes(kw);
  });
});

async function load() {
  loading.value = true;
  try {
    const data = unbox(await listSqlAuditRules());
    rows.value = Array.isArray(data) ? data : [];
  } finally {
    loading.value = false;
  }
}


function sourceLabel(source?: string) {
  return source === 'override' ? 'DB覆盖' : '内置默认';
}

function dialectsText(row: SqlAuditRuleVO) {
  const list = row.dialects || [];
  if (list.length === 0) return '*';
  return list.join(', ');
}

async function onSeverityChange(row: SqlAuditRuleVO, severity: string) {
  await persist(row, { severity });
}

async function onEnabledChange(row: SqlAuditRuleVO, enabled: boolean) {
  await persist(row, { enabled });
}

async function persist(
  row: SqlAuditRuleVO,
  patch: { severity?: string; enabled?: boolean },
) {
  savingCode.value = row.code;
  try {
    const data = unbox(
      await updateSqlAuditRule({
        code: row.code,
        severity: patch.severity ?? row.severity,
        enabled: patch.enabled ?? row.enabled,
      }),
    );
    Object.assign(row, data || {});
    ElMessage.success(`已保存覆盖：${row.code}`);
    // 刷新以同步 source 等字段
    await load();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
    await load();
  } finally {
    savingCode.value = '';
  }
}

async function onReset(row: SqlAuditRuleVO) {
  if (row.source !== 'override') {
    ElMessage.info('当前已是内置默认，无需重置');
    return;
  }
  await ElMessageBox.confirm(
    `确定删除「${row.code}」的数据库覆盖并恢复 YAML/内置默认吗？`,
    '重置为默认',
    { type: 'warning' },
  );
  savingCode.value = row.code;
  try {
    await resetSqlAuditRule(row.code);
    ElMessage.success(`已重置：${row.code}`);
    await load();
  } finally {
    savingCode.value = '';
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <Page auto-content-height>
    <div class="flex h-full flex-col gap-3 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <el-input
          v-model="query.keyword"
          clearable
          placeholder="搜索规则码 / 名称 / 说明"
          style="width: 260px"
          :prefix-icon="Search"
        />
        <el-select
          v-model="query.severity"
          clearable
          placeholder="严重度"
          style="width: 160px"
        >
          <el-option
            v-for="item in severityOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="query.source"
          clearable
          placeholder="来源"
          style="width: 140px"
        >
          <el-option label="内置默认" value="builtin" />
          <el-option label="DB覆盖" value="override" />
        </el-select>
        <el-select
          v-model="query.enabled"
          clearable
          placeholder="启用状态"
          style="width: 120px"
        >
          <el-option label="启用" value="1" />
          <el-option label="停用" value="0" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="load">
          刷新
        </el-button>
        <span class="text-muted-foreground text-sm">
          共 {{ filteredRows.length }} 条（合并内置默认 + DB 覆盖）。仅 DBA /
          管理员可改。
        </span>
      </div>

      <el-table
        v-loading="loading"
        :data="filteredRows"
        border
        height="100%"
        row-key="code"
        size="small"
      >
        <el-table-column
          prop="code"
          label="规则码"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="name"
          label="名称"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column label="严重度" width="170">
          <template #default="{ row }">
            <el-select
              :model-value="row.severity"
              size="small"
              style="width: 140px"
              :disabled="savingCode === row.code"
              @change="(v: string) => onSeverityChange(row, v)"
            >
              <el-option
                v-for="item in severityOptions"
                :key="item.value"
                :label="item.value"
                :value="item.value"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="90" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="Boolean(row.enabled)"
              :disabled="savingCode === row.code"
              @change="(v: boolean) => onEnabledChange(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="方言" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ dialectsText(row) }}
          </template>
        </el-table-column>
        <el-table-column label="权重" prop="scoreWeight" width="70" align="center" />
        <el-table-column label="来源" width="100" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.source === 'override' ? 'success' : 'info'"
            >
              {{ sourceLabel(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="description"
          label="说明"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :icon="RefreshLeft"
              :disabled="row.source !== 'override' || savingCode === row.code"
              @click="onReset(row)"
            >
              重置默认
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </Page>
</template>
