<script lang="ts" setup>
/**
 * 变更窗口配置：按环境或单个连接定义允许直接执行写操作（DML/DDL/导入）的时间段与封网期。
 * 窗口外 SQL 客户端的写操作会被后端拦截，引导走 SQL 工单；查询不受影响。
 * 默认仅管理员可见（菜单与 DbChangeWindow:* 操作权限来自后端菜单数据）。
 * @author yanch
 */
import type { ChangeWindowRow } from '#/api/visual/changeWindow';
import type {
  ChangeWindowRule,
  ChangeWindowStatus,
} from '#/views/visual/client/utils/connectionEnv';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Delete, Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

import {
  deleteChangeWindow,
  listChangeWindows,
  previewChangeWindow,
  saveChangeWindow,
} from '#/api/visual/changeWindow';
import { getDbConfigList } from '#/api/visual/vq';
import {
  describeRule,
  ENV_OPTIONS,
  envTagType,
  formatChangeWindowStatus,
  normalizeEnv,
  resolveConnectionEnv,
  WEEKDAY_OPTIONS,
} from '#/views/visual/client/utils/connectionEnv';

defineOptions({ name: 'DbChangeWindow' });

interface FreezeItem {
  start: string;
  end: string;
  reason: string;
}

const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Tokyo',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

const loading = ref(false);
const rows = ref<ChangeWindowRow[]>([]);
const connections = ref<any[]>([]);

const dialogVisible = ref(false);
const saving = ref(false);
const previewing = ref(false);
const previewStatus = ref<ChangeWindowStatus | null>(null);
const form = reactive({
  id: undefined as number | string | undefined,
  scopeType: 'ENV' as 'CONNECTION' | 'ENV',
  env: 'PROD' as string,
  dbConfigId: undefined as number | string | undefined,
  enabled: 1,
  timezone: 'Asia/Shanghai',
  rules: [] as ChangeWindowRule[],
  freezes: [] as FreezeItem[],
  remark: '',
});

const previewView = computed(() => formatChangeWindowStatus(previewStatus.value));

function unbox(res: any) {
  return res?.data ?? res;
}

function parseJson<T>(text: null | string | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    const value = JSON.parse(text);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function rulesOf(row: ChangeWindowRow): ChangeWindowRule[] {
  return parseJson<ChangeWindowRule[]>(row.rulesJson, []);
}

function freezesOf(row: ChangeWindowRow): FreezeItem[] {
  return parseJson<FreezeItem[]>(row.freezesJson, []);
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** 只有日期的封网转成分钟精度，便于日期时间选择器编辑（结束日含当天 → 次日 00:00，语义不变） */
function toEditablePoint(value: string, isEnd: boolean): string {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (!isEnd) return `${text} 00:00`;
    const [y, m, d] = text.split('-').map(Number);
    const next = new Date(y!, (m ?? 1) - 1, (d ?? 1) + 1);
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())} 00:00`;
  }
  return text.replace('T', ' ').slice(0, 16);
}

function connectionName(id: unknown) {
  const hit = connections.value.find((c) => String(c.id) === String(id));
  return hit?.dbName || String(id ?? '');
}

async function load() {
  loading.value = true;
  try {
    const data = unbox(await listChangeWindows());
    rows.value = Array.isArray(data) ? data : [];
  } finally {
    loading.value = false;
  }
}

async function loadConnections() {
  try {
    const data = unbox(await getDbConfigList({}));
    connections.value = Array.isArray(data) ? data : [];
  } catch {
    connections.value = [];
  }
}

function resetForm() {
  Object.assign(form, {
    id: undefined,
    scopeType: 'ENV',
    env: 'PROD',
    dbConfigId: undefined,
    enabled: 1,
    timezone: 'Asia/Shanghai',
    rules: [{ days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' }],
    freezes: [],
    remark: '',
  });
  previewStatus.value = null;
}

function openCreate() {
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: ChangeWindowRow) {
  resetForm();
  Object.assign(form, {
    id: row.id,
    scopeType: row.scopeType === 'CONNECTION' ? 'CONNECTION' : 'ENV',
    env: normalizeEnv(row.env) || 'PROD',
    dbConfigId: row.dbConfigId ?? undefined,
    enabled: row.enabled === 0 ? 0 : 1,
    timezone: row.timezone || 'Asia/Shanghai',
    rules: rulesOf(row).map((r) => ({ days: [...(r.days || [])], start: r.start, end: r.end })),
    freezes: freezesOf(row).map((f) => ({
      start: toEditablePoint(f.start, false),
      end: toEditablePoint(f.end, true),
      reason: f.reason || '',
    })),
    remark: row.remark || '',
  });
  dialogVisible.value = true;
}

function addRule() {
  form.rules.push({ days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00' });
}

function addFreeze() {
  form.freezes.push({ start: '', end: '', reason: '' });
}

function buildPayload(): ChangeWindowRow | null {
  if (form.scopeType === 'CONNECTION' && !form.dbConfigId) {
    ElMessage.warning('请选择连接');
    return null;
  }
  for (const [i, rule] of form.rules.entries()) {
    if (!rule.days?.length || !rule.start || !rule.end) {
      ElMessage.warning(`时间段 ${i + 1} 未填写完整`);
      return null;
    }
  }
  for (const [i, f] of form.freezes.entries()) {
    if (!f.start || !f.end) {
      ElMessage.warning(`封网时段 ${i + 1} 未填写完整`);
      return null;
    }
  }
  return {
    id: form.id,
    scopeType: form.scopeType,
    env: form.scopeType === 'ENV' ? form.env : null,
    dbConfigId: form.scopeType === 'CONNECTION' ? form.dbConfigId : null,
    enabled: form.enabled,
    timezone: form.timezone || 'Asia/Shanghai',
    rulesJson: JSON.stringify(form.rules.map((r) => ({ days: r.days, start: r.start, end: r.end }))),
    freezesJson: JSON.stringify(
      form.freezes.map((f) => ({ start: f.start, end: f.end, ...(f.reason.trim() ? { reason: f.reason.trim() } : {}) })),
    ),
    remark: form.remark,
  };
}

async function preview() {
  const payload = buildPayload();
  if (!payload) return;
  previewing.value = true;
  try {
    previewStatus.value = unbox(await previewChangeWindow(payload)) || null;
  } finally {
    previewing.value = false;
  }
}

async function save() {
  const payload = buildPayload();
  if (!payload) return;
  saving.value = true;
  try {
    await saveChangeWindow(payload);
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function remove(row: ChangeWindowRow) {
  try {
    await ElMessageBox.confirm('删除后该范围的写操作不再受变更窗口限制，确认删除？', '删除变更窗口', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await deleteChangeWindow(row.id!);
  ElMessage.success('删除成功');
  await load();
}

function scopeTagType(row: ChangeWindowRow) {
  return row.scopeType === 'ENV' ? envTagType(normalizeEnv(row.env)) : 'info';
}

function connectionEnvText(c: any) {
  return resolveConnectionEnv(c).text;
}

onMounted(async () => {
  await Promise.all([load(), loadConnections()]);
});
</script>

<template>
  <Page auto-content-height>
    <div class="flex h-full flex-col gap-3 p-3">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          {{ $tr('变更窗口外，SQL 客户端中的写操作（DML / DDL / 脚本 / 导入 / 复制到目标库）会被拦截并提示提交 SQL 工单；查询不受影响。') }}
        </template>
        <div class="alert-desc">
          {{ $tr('连接专属窗口（启用时）优先于环境窗口；没有任何窗口的连接不受限制。工单执行同样受窗口约束，具备「变更窗口外强制执行工单」权限的审批人可填写原因后强制执行，并记录审计。') }}
        </div>
      </el-alert>

      <div class="flex flex-wrap items-center gap-2">
        <el-button type="primary" :icon="Plus" @click="openCreate">{{ $tr('新增变更窗口') }}</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load">{{ $tr('刷新') }}</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe class="flex-1" height="100%">
        <el-table-column :label="$tr('范围')" min-width="180">
          <template #default="{ row }">
            <el-tag :type="scopeTagType(row)" :effect="row.env === 'PROD' ? 'dark' : 'light'" size="small">
              {{ row.scopeType === 'ENV' ? row.env : $tr('连接') }}
            </el-tag>
            <span v-if="row.scopeType === 'CONNECTION'" class="scope-name">
              {{ row.dbName || connectionName(row.dbConfigId) }}
            </span>
            <span v-else class="scope-name">{{ $tr('环境') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$tr('启用')" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.enabled === 0 ? 'info' : 'success'" size="small">
              {{ $tr(row.enabled === 0 ? '停用' : '启用') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="timezone" :label="$tr('时区')" width="150" />
        <el-table-column :label="$tr('开放时段')" min-width="240">
          <template #default="{ row }">
            <div v-for="(rule, i) in rulesOf(row)" :key="i">{{ $tr(describeRule(rule)) }}</div>
            <span v-if="!rulesOf(row).length" class="muted">{{ $tr('全天开放（仅受封网约束）') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$tr('封网时段')" min-width="220">
          <template #default="{ row }">
            <div v-for="(f, i) in freezesOf(row)" :key="i">
              {{ f.start }} ~ {{ f.end }}<span v-if="f.reason" class="muted">（{{ f.reason }}）</span>
            </div>
            <span v-if="!freezesOf(row).length" class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="$tr('当前状态')" min-width="200">
          <template #default="{ row }">
            <el-tag v-if="row.enabled === 0" type="info" size="small">{{ $tr('未生效') }}</el-tag>
            <el-tag v-else :type="row.currentOpen ? 'success' : 'warning'" size="small">
              {{ $tr(row.currentText || '-') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" :label="$tr('备注')" min-width="140" show-overflow-tooltip />
        <el-table-column :label="$tr('操作')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ $tr('编辑') }}</el-button>
            <el-button link type="danger" @click="remove(row)">{{ $tr('删除') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="$tr(form.id ? '编辑变更窗口' : '新增变更窗口')"
      width="820px"
      destroy-on-close
    >
      <el-form label-width="110px">
        <el-form-item :label="$tr('范围')">
          <el-radio-group v-model="form.scopeType">
            <el-radio value="ENV">{{ $tr('按环境') }}</el-radio>
            <el-radio value="CONNECTION">{{ $tr('单个连接') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.scopeType === 'ENV'" :label="$tr('环境')">
          <el-select v-model="form.env" style="width: 220px">
            <el-option
              v-for="opt in ENV_OPTIONS"
              :key="opt.value"
              :label="`${opt.value} · ${$tr(opt.label)}`"
              :value="opt.value"
            />
          </el-select>
          <div class="hint">{{ $tr('未标记环境的连接若名称含「生产/prod/正式/production」，按 PROD 处理') }}</div>
        </el-form-item>
        <el-form-item v-else :label="$tr('连接')">
          <el-select v-model="form.dbConfigId" filterable style="width: 360px" :placeholder="$tr('请选择连接')">
            <el-option v-for="c in connections" :key="c.id" :label="c.dbName" :value="c.id">
              <span>{{ c.dbName }}</span>
              <span v-if="connectionEnvText(c)" class="option-env">{{ connectionEnvText(c) }}</span>
            </el-option>
          </el-select>
          <div class="hint">{{ $tr('连接专属窗口启用时覆盖其环境窗口；停用后回退到环境窗口') }}</div>
        </el-form-item>
        <el-form-item :label="$tr('启用')">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
        </el-form-item>
        <el-form-item :label="$tr('时区')">
          <el-select v-model="form.timezone" filterable allow-create default-first-option style="width: 220px">
            <el-option v-for="tz in TIMEZONES" :key="tz" :label="tz" :value="tz" />
          </el-select>
        </el-form-item>

        <el-form-item :label="$tr('开放时段')">
          <div class="rule-list">
            <div v-for="(rule, i) in form.rules" :key="i" class="rule-row">
              <el-checkbox-group v-model="rule.days" size="small">
                <el-checkbox-button v-for="d in WEEKDAY_OPTIONS" :key="d.value" :value="d.value">
                  {{ $tr(d.label) }}
                </el-checkbox-button>
              </el-checkbox-group>
              <el-time-picker
                v-model="rule.start"
                format="HH:mm"
                value-format="HH:mm"
                :clearable="false"
                size="small"
                style="width: 100px"
              />
              <span>~</span>
              <el-time-picker
                v-model="rule.end"
                format="HH:mm"
                value-format="HH:mm"
                :clearable="false"
                size="small"
                style="width: 100px"
              />
              <el-button link type="danger" :icon="Delete" @click="form.rules.splice(i, 1)" />
            </div>
            <el-button size="small" :icon="Plus" @click="addRule">{{ $tr('添加时间段') }}</el-button>
            <div class="hint">
              {{ $tr('开始=结束表示当天全天；结束早于开始表示跨夜（如 22:00~06:00 从所选日的 22:00 到次日 06:00）；不配置时段表示全天开放，仅受封网约束。') }}
            </div>
          </div>
        </el-form-item>

        <el-form-item :label="$tr('封网时段')">
          <div class="rule-list">
            <div v-for="(f, i) in form.freezes" :key="i" class="rule-row">
              <el-date-picker
                v-model="f.start"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm"
                size="small"
                style="width: 180px"
                :placeholder="$tr('开始')"
              />
              <span>~</span>
              <el-date-picker
                v-model="f.end"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm"
                size="small"
                style="width: 180px"
                :placeholder="$tr('结束')"
              />
              <el-input v-model="f.reason" size="small" maxlength="100" style="width: 200px" :placeholder="$tr('原因（可选）')" />
              <el-button link type="danger" :icon="Delete" @click="form.freezes.splice(i, 1)" />
            </div>
            <el-button size="small" :icon="Plus" @click="addFreeze">{{ $tr('添加封网时段') }}</el-button>
            <div class="hint">{{ $tr('封网优先于开放时段，封网期间一律禁止直接执行写操作。') }}</div>
          </div>
        </el-form-item>

        <el-form-item :label="$tr('备注')">
          <el-input v-model="form.remark" maxlength="255" show-word-limit />
        </el-form-item>

        <el-form-item :label="$tr('预览')">
          <el-button size="small" :loading="previewing" @click="preview">{{ $tr('按当前配置计算状态') }}</el-button>
          <el-tag v-if="previewStatus" class="preview-tag" :type="previewView.tagType">
            {{ $tr(previewView.text || '不受限制') }}
          </el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $tr('取消') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ $tr('保存') }}</el-button>
      </template>
    </el-dialog>
  </Page>
</template>

<style scoped>
.alert-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
}

.scope-name {
  margin-left: 6px;
}

.muted {
  color: var(--el-text-color-secondary);
}

.hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.rule-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.option-env {
  float: right;
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.preview-tag {
  margin-left: 8px;
}
</style>
