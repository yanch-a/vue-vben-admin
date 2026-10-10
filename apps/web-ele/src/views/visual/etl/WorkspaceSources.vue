<script setup lang="ts">
/** 工作区数据源选择：连接 → 多选实例 → 为每个具体数据源命名。@author yanch */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { EtlConnectionOption, EtlResource } from '#/api/visual/etl';
import { listEtlInstances, listEtlTables } from '#/api/visual/etl';
import { etlId } from './etlModel';

const props = defineProps<{
  modelValue: Record<string, EtlResource>;
  connections: EtlConnectionOption[];
  usedRefs?: string[];
}>();
const emit = defineEmits<{
  'update:modelValue': [Record<string, EtlResource>];
}>();
const connectionId = ref('');
const instances = ref<string[]>([]);
const selectedInstances = ref<string[]>([]);
const busy = ref(false);
const schemas = ref<Record<string, string[]>>({});
let instanceRequest = 0;
const selectedConnection = computed(() =>
  props.connections.find((item) => item.id === connectionId.value),
);
const entries = computed(() => Object.entries(props.modelValue));

/** 连接改变时加载扁平实例列表，失败保留空列表并显示提示，不伪造默认实例。 */
async function changeConnection() {
  const request = ++instanceRequest;
  const id = connectionId.value;
  instances.value = [];
  selectedInstances.value = [];
  busy.value = true;
  try {
    const res = await listEtlInstances(id);
    if (request === instanceRequest) instances.value = res.data ?? res;
  } catch (error: any) {
    if (request === instanceRequest)
      ElMessage.error(error.message || '实例加载失败');
  } finally {
    if (request === instanceRequest) busy.value = false;
  }
}

/** 多选的每个实例都是一个独立稳定资源，后续步骤只需要选择它的别名。 */
async function addSources() {
  const connection = selectedConnection.value;
  if (!connection || !selectedInstances.value.length) return;
  const next = { ...props.modelValue };
  for (const instance of selectedInstances.value) {
    if (
      Object.values(next).some(
        (item) =>
          String(item.dbConfigId) === connection.id &&
          item.instance === instance &&
          !item.schema,
      )
    )
      continue;
    const key = etlId('db');
    next[key] = {
      kind: 'database',
      bindingRef: `local.db.${connection.id}`,
      dbConfigId: connection.id,
      displayName: `${connection.name} / ${instance}`,
      instance,
      schema: '',
      family: connection.family,
      dbType: connection.dbType,
      canWriteData: connection.canWriteData,
    };
  }
  emit('update:modelValue', next);
  selectedInstances.value = [];
}

function patchSource(key: string, patch: Partial<EtlResource>) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: { ...props.modelValue[key]!, ...patch },
  });
}

/** 被流程引用的资源必须保留，避免用户在设置界面误删步骤的数据源。 */
function removeSource(key: string) {
  if (props.usedRefs?.includes(key)) {
    ElMessage.warning('该数据源正在被步骤使用，请先修改步骤的数据源');
    return;
  }
  const next = { ...props.modelValue };
  delete next[key];
  emit('update:modelValue', next);
}

function hasSchema(resource: EtlResource) {
  return (
    ['POSTGRES_LIKE', 'SQLSERVER_LIKE', 'ORACLE_LIKE'].includes(
      resource.family || '',
    ) && resource.dbType !== 'DM'
  );
}

/** Schema 从授权表目录提取；Oracle 也可输入已有 owner，执行时再验证表权限。 */
async function loadSchemas(key: string, resource: EtlResource) {
  if (!resource.dbConfigId || !resource.instance || schemas.value[key]) return;
  try {
    const response = await listEtlTables(
      resource.dbConfigId,
      resource.instance,
    );
    const rows: any[] = response.data ?? response;
    schemas.value[key] = [
      ...new Set(
        rows.map((item) => String(item.schemaName || '')).filter(Boolean),
      ),
    ];
  } catch (error: any) {
    ElMessage.error(error.message || 'Schema 加载失败');
  }
}
</script>

<template>
  <div class="sources-manager">
    <p class="help">
      {{
        $tr(
          '先选好连接和具体库，为它设置容易辨认的别名。每个查询或写入步骤都直接选这里的数据源。',
        )
      }}
    </p>
    <div class="source-builder">
      <el-select
        v-model="connectionId"
        filterable
        :placeholder="$tr('选择有权限的数据库连接')"
        @change="changeConnection"
      >
        <el-option
          v-for="item in connections"
          :key="item.id"
          :value="item.id"
          :label="`${item.name} · ${item.dbType}`"
        />
      </el-select>
      <el-select
        v-model="selectedInstances"
        multiple
        filterable
        :loading="busy"
        :disabled="!connectionId"
        :placeholder="
          selectedConnection?.instanceKind === 'SCHEMA'
            ? $tr('勾选 Schema / 模式')
            : $tr('勾选数据库 / 实例')
        "
      >
        <el-option
          v-for="instance in instances"
          :key="instance"
          :value="instance"
          :label="instance"
        />
      </el-select>
      <el-button
        type="primary"
        :disabled="!selectedInstances.length"
        @click="addSources"
        >{{ $tr('加入工作区') }}</el-button
      >
    </div>
    <el-empty
      v-if="!entries.length"
      :image-size="60"
      :description="$tr('选好具体实例后加入工作区')"
    />
    <div v-for="[key, resource] in entries" :key="key" class="source-row">
      <div class="source-identity">
        <span
          >{{
            resource.dbType || resource.databaseTypeHint || $tr('待绑定')
          }}
          ·
          {{ resource.instance || $tr('尚未绑定实例') }}</span
        >
        <el-input
          :model-value="resource.displayName"
          :placeholder="$tr('数据源别名，例如：订单库、数仓')"
          maxlength="100"
          @input="patchSource(key, { displayName: String($event) })"
        />
      </div>
      <el-select
        v-if="hasSchema(resource)"
        :model-value="resource.schema"
        clearable
        filterable
        allow-create
        default-first-option
        :placeholder="$tr('Schema / owner（可选）')"
        @visible-change="$event && loadSchemas(key, resource)"
        @change="patchSource(key, { schema: String($event || '') })"
      >
        <el-option
          v-for="schema in schemas[key] || []"
          :key="schema"
          :label="schema"
          :value="schema"
        />
      </el-select>
      <el-tag :type="resource.canWriteData ? 'success' : 'info'">{{
        resource.canWriteData ? $tr('可读写') : $tr('只读 / 权限待核对')
      }}</el-tag>
      <el-button link type="danger" @click="removeSource(key)">{{
        $tr('移除')
      }}</el-button>
    </div>
    <p v-if="!connections.length" class="help">
      {{
        $tr(
          '当前没有可使用的数据库连接，请在数据库连接管理中配置或申请授权。',
        )
      }}
    </p>
  </div>
</template>

<style scoped>
.help {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.source-builder {
  display: grid;
  grid-template-columns: 1fr 1.3fr auto;
  gap: 10px;
}
.source-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
.source-identity {
  flex: 1;
  min-width: 200px;
}
.source-identity span {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.source-row > .el-select {
  width: 200px;
}
</style>
