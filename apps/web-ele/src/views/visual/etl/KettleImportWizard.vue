<script setup lang="ts">
/** 分步 Kettle 导入：解析→连接→实例/别名→逐任务→确认；不自动保存或运行。@author yanch */
import { computed, nextTick, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type {
  EtlConnectionOption,
  EtlResource,
  EtlWorkspaceDocument,
  KettleImportResult,
} from '#/api/visual/etl';
import {
  importKettleFile,
  listEtlInstances,
  listEtlSources,
  listEtlTables,
  validateEtlWorkspace,
} from '#/api/visual/etl';
import AiChatWindow from '#/views/visual/client/components/ai/AiChatWindow.vue';
import ConnectionDialog from '#/views/visual/client/components/ConnectionDialog.vue';
import { cloneDocument, etlId } from './etlModel';
import { mergeKettleSelection, namespaceKettle } from './kettleMigration';

const props = defineProps<{
  document: EtlWorkspaceDocument;
  connections: EtlConnectionOption[];
}>();
const emit = defineEmits<{
  apply: [document: EtlWorkspaceDocument, baseJson: string];
}>();
interface FileRow {
  id: string;
  file: File;
  status: 'loading' | 'success' | 'error';
  error?: string;
  result?: KettleImportResult;
  document?: EtlWorkspaceDocument;
}
interface SourceRow {
  ref: string;
  name: string;
  product: string;
  hint: string;
  connectionId: string;
  instance: string;
  schema: string;
  alias: string;
  existingRef: string;
  instances: string[];
  schemas: string[];
  error: string;
  busy: boolean;
  version: number;
  acceptDialectChange: boolean;
}
const visible = ref(false),
  step = ref(0),
  busy = ref(false),
  connectionVisible = ref(false);
const pendingConnection = ref<SourceRow>();
const connectionHint = computed(() =>
  pendingConnection.value
    ? {
        dbName: pendingConnection.value.name,
        dbType: pendingConnection.value.product,
        schemaName: pendingConnection.value.hint,
      }
    : undefined,
);
const files = ref<FileRow[]>([]),
  sources = ref<SourceRow[]>([]),
  catalog = ref<EtlConnectionOption[]>([]);
const base = ref<EtlWorkspaceDocument>(),
  baseJson = ref(''),
  selected = ref<string[]>([]),
  search = ref(''),
  page = ref(1);
const parseDone = computed(() =>
  files.value.every((file) => file.status !== 'loading'),
);
const reports = computed(() =>
  files.value.flatMap((file) =>
    (file.result?.tasks || []).map((task) => ({
      ...task,
      fileName: file.file.name,
    })),
  ),
);
const filtered = computed(() =>
  reports.value.filter((task) =>
    `${task.name} ${task.fileName}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
const pageTasks = computed(() =>
  filtered.value.slice((page.value - 1) * 10, page.value * 10),
);
const readyCount = computed(
  () => reports.value.filter((task) => task.status === 'READY').length,
);
const aiWindow = ref<InstanceType<typeof AiChatWindow>>(),
  aiDocument = ref<EtlWorkspaceDocument>(),
  aiTaskId = ref(''),
  aiRef = ref('');
const aiSource = computed(() => aiDocument.value?.resources[aiRef.value]);
const aiVisible = ref(false),
  aiStage = ref(''),
  aiIssues = ref<string[]>([]);

/** 选择文件后立即展示阶段，不等待所有解析完成才弹窗；多文件各自重试。 */
async function open(input: File[]) {
  base.value = cloneDocument(props.document);
  baseJson.value = JSON.stringify(props.document);
  catalog.value = [...props.connections];
  files.value = input.map((file) => ({
    id: etlId('ktr'),
    file,
    status: 'loading',
  }));
  sources.value = [];
  selected.value = [];
  step.value = 0;
  search.value = '';
  page.value = 1;
  visible.value = true;
  for (const row of files.value) await parseFile(row);
}
/** 服务端只返回无凭据候选；解析失败不回显原始 XML，避免泄漏生产配置。 */
async function parseFile(row: FileRow) {
  row.status = 'loading';
  row.error = '';
  try {
    const response: any = await importKettleFile(row.file);
    const result = namespaceKettle(response.data ?? response, row.id);
    row.result = result;
    row.document = JSON.parse(result.workspaceJson);
    row.status = 'success';
    for (const hint of result.connections) {
      const matches = catalog.value.filter(
        (connection) => connection.name === hint.name,
      );
      sources.value.push({
        ref: hint.resourceRef,
        name: hint.name,
        product: hint.databaseType,
        hint: hint.instanceHint,
        connectionId: matches.length === 1 ? String(matches[0]!.id) : '',
        instance: '',
        schema: '',
        alias: `${hint.name} / ${hint.instanceHint || row.file.name} (${files.value.indexOf(row) + 1})`,
        existingRef: '',
        instances: [],
        schemas: [],
        error: '',
        busy: false,
        version: 0,
        acceptDialectChange: false,
      });
    }
    selected.value.push(
      ...result.tasks
        .filter((task) => task.status === 'READY')
        .map((task) => task.id),
    );
  } catch (error: any) {
    row.status = 'error';
    row.error = error?.message || '解析失败，请检查文件结构';
  }
}
/** 重新获取当前用户可见目录，新建连接后也必须经权限过滤，不使用文件里的账号授权。 */
async function refreshConnections() {
  busy.value = true;
  try {
    const response: any = await listEtlSources();
    catalog.value = response.data ?? response;
  } catch (error: any) {
    ElMessage.error(error.message || '连接目录加载失败');
  } finally {
    busy.value = false;
  }
}
/** 连接变更使旧实例失效，防止异步响应将其他连接实例覆盖回来。 */
function changeConnection(row: SourceRow) {
  row.version++;
  row.instance = '';
  row.schema = '';
  row.existingRef = '';
  row.instances = [];
  row.schemas = [];
  row.error = '';
  row.acceptDialectChange = false;
}
/** 连接名称匹配不能证明数据库族一致，用户必须明确确认跨族迁移并修复 SQL。 */
function differentFamily(row: SourceRow) {
  const expected: Record<string, string> = {
    MYSQL: 'MYSQL_LIKE',
    POSTGRESQL: 'POSTGRES_LIKE',
    HIGHGO: 'POSTGRES_LIKE',
    ORACLE: 'ORACLE_LIKE',
    SQL_SERVER: 'SQLSERVER_LIKE',
  };
  const actual = catalog.value.find(
    (item) => String(item.id) === row.connectionId,
  )?.family;
  return (
    !!actual && !!expected[row.product] && actual !== expected[row.product]
  );
}
/** 新建连接仅预填无凭据提示；地址/账号/密码由用户在原客户端表单输入。 */
function createConnection(row?: SourceRow) {
  pendingConnection.value = row;
  connectionVisible.value = true;
}
async function connectionCreated(connection: any) {
  await refreshConnections();
  const match = catalog.value.find(
    (item) => String(item.id) === String(connection?.id),
  );
  if (pendingConnection.value && match) {
    changeConnection(pendingConnection.value);
    pendingConnection.value.connectionId = String(match.id);
  }
}
/** 数据库族变更写成正式迁移阻塞标记，不能只弹个提示后继续运行原方言 SQL。 */
function recordDialectChanges() {
  for (const file of files.value)
    for (const task of file.document?.pipelines || []) {
      const report = file.result!.tasks.find((item) => item.id === task.id)!;
      report.issues = report.issues.filter(
        (issue) => !issue.startsWith('数据库族变更：'),
      );
      for (const node of task.nodes) {
        node.config.migrationWarnings = (
          node.config.migrationWarnings || []
        ).filter((issue: string) => !issue.startsWith('数据库族变更：'));
        const source = sources.value.find(
          (row) => row.ref === node.resourceRef,
        );
        if (source && differentFamily(source)) {
          const issue = `数据库族变更：${source.name} 的 ${source.product} SQL/字段类型需核对目标数据库族`;
          node.config.migrationWarnings.push(issue);
          if (!report.issues.includes(issue)) report.issues.push(issue);
        }
      }
      if (report.status !== 'DISABLED')
        report.status = report.issues.length ? 'REVIEW' : 'READY';
      task.enabled = report.status === 'READY';
    }
  selected.value = selected.value.filter(
    (id) => reports.value.find((task) => task.id === id)?.status === 'READY',
  );
}
/** 只从授权 API 获取实例；提示库名只有存在于授权清单时才可预选。 */
async function loadInstances(row: SourceRow) {
  const version = ++row.version,
    id = row.connectionId;
  row.busy = true;
  row.error = '';
  try {
    const response: any = await listEtlInstances(id);
    if (version !== row.version) return;
    row.instances = response.data ?? response;
    if (!row.instances.includes(row.instance))
      row.instance = row.instances.find((item) => item === row.hint) || '';
    if (row.instance) await loadSchemas(row);
  } catch (error: any) {
    if (version === row.version) row.error = error.message || '实例加载失败';
  } finally {
    if (version === row.version) row.busy = false;
  }
}
/** PostgreSQL/SQLServer 额外显示真实 schema；MySQL 与 schema 型实例不增加虚假的层级。 */
function hasSchema(row: SourceRow) {
  const connection = catalog.value.find(
    (item) => String(item.id) === row.connectionId,
  );
  return (
    connection?.instanceKind !== 'SCHEMA' &&
    ['POSTGRES_LIKE', 'SQLSERVER_LIKE'].includes(connection?.family || '')
  );
}
async function loadSchemas(row: SourceRow) {
  row.schema = '';
  row.schemas = [];
  if (!hasSchema(row) || !row.instance) return;
  const version = row.version,
    instance = row.instance;
  try {
    const response: any = await listEtlTables(row.connectionId, instance);
    if (version !== row.version || row.instance !== instance) return;
    row.schemas = [
      ...new Set<string>(
        (response.data ?? response)
          .map((table: any) => String(table.schemaName || ''))
          .filter(Boolean),
      ),
    ];
  } catch (error: any) {
    if (version === row.version) row.error = error.message || 'Schema 加载失败';
  }
}
/** 已有别名可直接复用，但必须属于选定连接且实例仍在本轮授权清单。 */
function useExisting(row: SourceRow) {
  const existing = base.value?.resources[row.existingRef];
  if (!existing) return;
  row.instance = existing.instance || '';
  row.schema = existing.schema || '';
  row.alias = existing.displayName || row.name;
}
function existingOptions(row: SourceRow) {
  return Object.entries(base.value?.resources || {}).filter(
    ([, item]) =>
      String(item.dbConfigId) === row.connectionId &&
      row.instances.includes(item.instance || ''),
  );
}
/** 每一阶段均独立检查，不让空连接、无权实例或重名别名流入生成阶段。 */
function checkSources() {
  const aliases = new Set(
    Object.values(base.value?.resources || {}).map((item) =>
      item.displayName?.trim(),
    ),
  );
  for (const row of sources.value) {
    if (
      row.busy ||
      row.error ||
      !catalog.value.some((item) => String(item.id) === row.connectionId) ||
      !row.instances.includes(row.instance)
    )
      throw new Error(`请完成“${row.name}”的授权实例配置`);
    if (!row.existingRef) {
      if (!row.alias.trim() || aliases.has(row.alias.trim()))
        throw new Error(`“${row.name}”别名为空或重复`);
      aliases.add(row.alias.trim());
    }
    if (row.schema && !row.schemas.includes(row.schema) && !row.existingRef)
      throw new Error(`“${row.name}”Schema 不在授权目录`);
  }
}
async function next() {
  try {
    if (
      step.value === 0 &&
      !files.value.some((file) => file.status === 'success')
    )
      throw new Error('请先成功解析至少一份文件');
    if (step.value === 1) {
      if (sources.value.some((row) => !row.connectionId))
        throw new Error('请先匹配所有连接');
      if (
        sources.value.some(
          (row) => differentFamily(row) && !row.acceptDialectChange,
        )
      )
        throw new Error('连接数据库族不同，请确认方言迁移或重新匹配连接');
      busy.value = true;
      for (const row of sources.value) await loadInstances(row);
      busy.value = false;
    }
    if (step.value === 2) {
      checkSources();
      recordDialectChanges();
    }
    if (step.value === 3 && !selected.value.length)
      throw new Error('请勾选要导入的任务');
    step.value++;
  } catch (error: any) {
    ElMessage.warning(error.message);
    busy.value = false;
  }
}
/** 生成授权资源和映射时不更改任何已保存连接；即使取消向导也不修改工作区草稿。 */
function bindings() {
  const additions: Record<string, EtlResource> = {},
    map: Record<string, string> = {};
  for (const row of sources.value) {
    if (row.existingRef) {
      map[row.ref] = row.existingRef;
      continue;
    }
    const connection = catalog.value.find(
      (item) => String(item.id) === row.connectionId,
    )!;
    const ref = `import_${row.ref}`;
    map[row.ref] = ref;
    additions[ref] = {
      kind: 'database',
      bindingRef: `local.db.${row.connectionId}`,
      dbConfigId: row.connectionId,
      displayName: row.alias.trim(),
      instance: row.instance,
      schema: row.schema,
      family: connection.family,
      dbType: connection.dbType,
      canWriteData: connection.canWriteData,
    };
  }
  return { additions, map };
}
function generate(ids = selected.value) {
  checkSources();
  const { additions, map } = bindings();
  return mergeKettleSelection(
    base.value!,
    files.value.flatMap((file) => (file.document ? [file.document] : [])),
    ids,
    map,
    additions,
  );
}
async function apply() {
  busy.value = true;
  try {
    const document = generate();
    const response: any = await validateEtlWorkspace(JSON.stringify(document));
    const validation = response.data ?? response;
    if (!validation.valid)
      throw new Error((validation.errors || []).join('；'));
    emit('apply', document, baseJson.value);
  } catch (error: any) {
    ElMessage.error(error.message || '导入配置校验失败');
  } finally {
    busy.value = false;
  }
}
/** 父级成功应用后才关闭，冲突/校验失败时保留向导，允许用户继续调整。 */
function complete() {
  visible.value = false;
}
function toggle(taskId: string, checked: unknown) {
  selected.value = checked
    ? [...new Set([...selected.value, taskId])]
    : selected.value.filter((id) => id !== taskId);
}
function taskDocument(id: string) {
  return files.value.find((file) =>
    file.document?.pipelines.some((task) => task.id === id),
  );
}
/** AI 一次只接收一条任务和所需资源，不发送原始生产 XML，也不挤爆大工作区上下文。 */
async function repair(taskId: string) {
  try {
    const generated = generate([taskId]);
    const task = generated.pipelines.find((item) => item.id === taskId)!;
    const used = new Set(
      task.nodes.map((node) => node.resourceRef).filter(Boolean),
    );
    aiDocument.value = {
      ...generated,
      pipelines: [task],
      resources: Object.fromEntries(
        Object.entries(generated.resources).filter(([ref]) => used.has(ref)),
      ),
    };
    aiTaskId.value = taskId;
    aiRef.value = Object.keys(aiDocument.value.resources)[0] || '';
    aiStage.value = 'task';
    aiIssues.value =
      reports.value.find((item) => item.id === taskId)?.issues || [];
    if (!aiRef.value) throw new Error('该任务无数据库上下文，请先匹配数据源');
    aiVisible.value = true;
    await nextTick();
    aiWindow.value?.open({
      scene: 'etl',
      skillIds: ['etl-config', 'etl-kettle'],
      prefill:
        '请按 etl-kettle 技能修复当前迁移任务，解释每一项差异。先检查真实结构，保留任务 ID 和资源绑定，不能仅删除警告假装修复。原流程停用时必须保留停用，未被用户明确要求不得恢复同步。以完整候选配置结束，不保存、不执行。',
    });
  } catch (error: any) {
    ElMessage.warning(error.message);
  }
}
/** 连接/实例失败也可交给 AI 查授权目录，AI 只能建议已有 ID，不能建连接或增加权限。 */
async function sourceHelp(row: SourceRow) {
  await directoryHelp(
    `请调用 inspect_etl_import 查询当前用户授权的连接与实例，协助匹配 Kettle 连接“${row.name}”，数据库类型 ${row.product}，库名提示 ${row.hint || '未提供'}。给出建议及失败原因，不创建连接、不修改权限。`,
    'source',
    [row.error || '连接或实例尚未匹配'],
  );
}
/** 解析失败只传文件名和安全错误；不得将含生产密码的原始 XML 自动发送给模型。 */
async function fileHelp(row: FileRow) {
  await directoryHelp(
    `Kettle 文件“${row.file.name}”解析失败。请解释安全错误并给出排查步骤，需要时向用户索取脱敏 XML 片段；当前没有原始 XML，不能声称已修复或生成等价任务。不要索取账号、密码或完整连接配置。`,
    'parse',
    [row.error || '文件结构无法识别'],
  );
}
/** 复用客户端 AI 的授权上下文，目录建议与解析诊断不允许直接应用任务候选。 */
async function directoryHelp(prefill: string, stage: string, issues: string[]) {
  const resource = Object.entries(base.value?.resources || {}).find(
    ([, value]) => value.dbConfigId && value.instance,
  );
  if (!resource) {
    ElMessage.info(
      '请先匹配一个可用实例，AI 需要有权限的数据库上下文；也可通过“新建连接”人工配置',
    );
    return;
  }
  aiDocument.value = {
    ...cloneDocument(base.value!),
    pipelines: [],
    resources: { [resource[0]]: resource[1] },
  };
  aiRef.value = resource[0];
  aiTaskId.value = '';
  aiStage.value = stage;
  aiIssues.value = issues;
  aiVisible.value = true;
  await nextTick();
  aiWindow.value?.open({
    scene: 'etl',
    skillIds: ['etl-kettle'],
    prefill,
  });
}
function aiContext() {
  return {
    workMode: 'etl',
    skillIds: ['etl-config', 'etl-kettle'],
    etlWorkspace: JSON.stringify(aiDocument.value),
    kettleMigration: {
      stage: aiStage.value,
      taskId: aiTaskId.value,
      issues: aiIssues.value,
    },
  };
}
async function beforeAiSend() {
  if (!aiDocument.value || JSON.stringify(aiDocument.value).length > 64000) {
    ElMessage.warning(
      '当前任务配置超过 AI 上下文限制，请缩小任务或精简 SQL 后重试',
    );
    return false;
  }
  return true;
}
/** AI 产物仍须确定性校验和用户确认，只替换该导入候选任务，不改原工作区。 */
async function applyAi(candidate: {
  workspace: EtlWorkspaceDocument;
  baseJson?: string;
}) {
  try {
    if (!aiTaskId.value)
      throw new Error('连接匹配建议请在向导中手动选择，不允许 AI 改变绑定');
    if (candidate.baseJson !== JSON.stringify(aiDocument.value))
      throw new Error('修复基准已变化，请重新提问');
    if (
      candidate.workspace.pipelines.length !== 1 ||
      candidate.workspace.pipelines[0]?.id !== aiTaskId.value ||
      JSON.stringify(candidate.workspace.resources) !==
        JSON.stringify(aiDocument.value?.resources)
    )
      throw new Error('AI 必须保留当前任务 ID 与资源绑定');
    const response: any = await validateEtlWorkspace(
      JSON.stringify(candidate.workspace),
    );
    const validation = response.data ?? response;
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    const task = candidate.workspace.pipelines[0]!;
    if (
      reports.value.find((item) => item.id === aiTaskId.value)?.status ===
        'DISABLED' &&
      task.enabled
    )
      throw new Error(
        '原 Kettle 任务停用，AI 不得自动启用；请保留停用候选，导入后由用户手动决定',
      );
    if (
      task.nodes.some(
        (node) =>
          node.config.migrationWarnings?.length ||
          ![
            'database.query',
            'database.write',
            'database.upsert',
            'transform.select',
            'flow.noop',
          ].includes(node.type),
      )
    )
      throw new Error('候选仍有未解决迁移问题，请继续修复');
    await ElMessageBox.confirm(
      '请核对候选 JSON 与原任务，确认迁移语义已经修复？仅替换这一条导入候选，不保存、不执行。',
      '确认 AI 修复',
      { type: 'warning', modalClass: 'ai-mask-confirm-overlay' },
    );
    const file = taskDocument(aiTaskId.value)!;
    const { map } = bindings();
    const reverse = Object.fromEntries(
      Object.entries(map).map(([a, b]) => [b, a]),
    );
    const repaired = JSON.parse(JSON.stringify(task));
    for (const node of repaired.nodes)
      if (node.resourceRef) node.resourceRef = reverse[node.resourceRef];
    repaired.enabled = task.enabled;
    const index = file.document!.pipelines.findIndex(
      (item) => item.id === repaired.id,
    );
    file.document!.pipelines[index] = repaired;
    const report = file.result!.tasks.find((item) => item.id === repaired.id)!;
    report.status = task.enabled ? 'READY' : 'DISABLED';
    report.issues = [];
    report.nodeCount = repaired.nodes.length;
    toggle(repaired.id, true);
    aiWindow.value?.close();
    ElMessage.success('修复候选已确认，请完成最终导入');
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close')
      ElMessage.error(error.message || '修复失败');
  }
}
defineExpose({ open, complete });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="$tr('导入 Kettle')"
    width="min(1060px, 96vw)"
    :close-on-click-modal="false"
    class="kettle-wizard"
    @closed="aiWindow?.close()"
  >
    <el-steps :active="step" finish-status="success" align-center>
      <el-step
        :title="$tr('解析文件')"
        :description="$tr('安全识别连接和链路')"
      />
      <el-step
        :title="$tr('导入数据源')"
        :description="$tr('匹配有权限的连接')"
      />
      <el-step
        :title="$tr('实例与别名')"
        :description="$tr('选择具体库 / Schema')"
      />
      <el-step
        :title="$tr('生成任务')"
        :description="$tr('逐条检查或 AI 修复')"
      />
      <el-step
        :title="$tr('确认导入')"
        :description="$tr('仅追加到草稿')"
      />
    </el-steps>
    <div class="wizard-body">
      <template v-if="step === 0">
        <p>{{ $tr('不会连接文件中的生产地址，也不会导入账号或密码。') }}</p>
        <div v-for="file in files" :key="file.id" class="file-row">
          <strong>{{ file.file.name }}</strong
          ><el-tag
            :type="
              file.status === 'error'
                ? 'danger'
                : file.status === 'success'
                  ? 'success'
                  : 'info'
            "
            >{{
              file.status === 'loading'
                ? $tr('解析中')
                : file.status === 'success'
                  ? `${file.result?.tasks.length} ${$tr('个任务')}`
                  : $tr('解析失败')
            }}</el-tag
          ><span>{{ file.error }}</span
          ><el-button v-if="file.status === 'error'" @click="parseFile(file)"
            >{{ $tr('重试') }}</el-button
          >
          <el-button v-if="file.status === 'error'" @click="fileHelp(file)">
            {{ $tr('AI 排查') }}
          </el-button>
        </div>
        <p v-if="parseDone && files.some((file) => file.status === 'error')">
          {{ $tr('失败文件不会被导入，可重试；继续仅处理成功文件。') }}
        </p>
      </template>
      <template v-else-if="step === 1">
        <div class="actions">
          <span>{{
            $tr(
              '选择已有连接，或手动新建。文件里的库名只是提示，不会授予访问权限。',
            )
          }}</span
          ><el-button @click="refreshConnections" :loading="busy">{{
            $tr('刷新目录')
          }}</el-button
          ><el-button type="primary" plain @click="createConnection()">{{
            $tr('新建连接')
          }}</el-button>
        </div>
        <div v-for="row in sources" :key="row.ref" class="source-card">
          <div>
            <strong>{{ row.name }}</strong
            ><small
              >{{ row.product }} · {{ row.hint || $tr('未提供库名') }}</small
            >
          </div>
          <el-select
            v-model="row.connectionId"
            filterable
            :placeholder="$tr('选择当前用户有权限的连接')"
            @change="changeConnection(row)"
            ><el-option
              v-for="connection in catalog"
              :key="connection.id"
              :value="String(connection.id)"
              :label="`${connection.name} · ${connection.dbType}`" /></el-select
          ><el-button link @click="sourceHelp(row)">{{
            $tr('AI 协助匹配')
          }}</el-button>
          <el-button link @click="createConnection(row)">{{
            $tr('新建此连接')
          }}</el-button>
          <el-checkbox
            v-if="differentFamily(row)"
            v-model="row.acceptDialectChange"
            >{{ $tr('确认跨数据库族迁移（需修复 SQL）') }}</el-checkbox
          >
        </div>
      </template>
      <template v-else-if="step === 2">
        <p>{{
          $tr('每个实例设置清晰别名，后续任务直接使用。已有工作区别名可复用。')
        }}</p>
        <div v-for="row in sources" :key="row.ref" class="instance-card">
          <strong>{{ row.name }}</strong
          ><el-select
            v-model="row.existingRef"
            clearable
            :placeholder="$tr('复用已有别名（可选）')"
            @change="useExisting(row)"
            ><el-option
              v-for="[ref, resource] in existingOptions(row)"
              :key="ref"
              :value="ref"
              :label="`${resource.displayName} · ${resource.instance}`"
          /></el-select>
          <el-select
            v-model="row.instance"
            filterable
            :disabled="!!row.existingRef"
            :loading="row.busy"
            :placeholder="$tr('选择授权实例 / 数据库')"
            @change="loadSchemas(row)"
            ><el-option
              v-for="instance in row.instances"
              :key="instance"
              :label="instance"
              :value="instance"
          /></el-select>
          <el-select
            v-if="hasSchema(row)"
            v-model="row.schema"
            clearable
            :disabled="!!row.existingRef"
            :placeholder="$tr('Schema（默认）')"
            ><el-option
              v-for="schema in row.schemas"
              :key="schema"
              :value="schema"
              :label="schema"
          /></el-select>
          <el-input
            v-model="row.alias"
            :disabled="!!row.existingRef"
            :placeholder="$tr('实例别名')"
            maxlength="100"
          />
          <el-button @click="loadInstances(row)">{{ $tr('重新识别') }}</el-button
          ><el-button link @click="sourceHelp(row)">{{ $tr('AI 排查') }}</el-button
          ><el-alert
            v-if="row.error"
            :title="row.error"
            type="error"
            :closable="false"
          />
        </div>
      </template>
      <template v-else-if="step === 3">
        <div class="actions">
          <span
            >{{ reports.length }} {{ $tr('个任务') }} · {{ readyCount }}
            {{ $tr('可转换') }} ·
            {{ reports.filter((task) => task.status === 'REVIEW').length }}
            {{ $tr('待修复') }} ·
            {{ reports.filter((task) => task.status === 'DISABLED').length }}
            {{ $tr('原流程停用') }}</span
          ><el-button
            @click="
              selected = reports
                .filter((task) => task.status === 'READY')
                .map((task) => task.id)
            "
            >{{ $tr('选择可转换任务') }}</el-button
          ><el-button @click="selected = reports.map((task) => task.id)">{{
            $tr('全选（停用保留）')
          }}</el-button
          ><el-input
            v-model="search"
            clearable
            :placeholder="$tr('检索任务 / 文件')"
            @input="page = 1"
          />
        </div>
        <p>
          {{
            $tr(
              '“可转换”仅表示配置语义已转换，仍需在实际数据库预检。待修复任务可选择导入，但会保持停用。',
            )
          }}
        </p>
        <el-table :data="pageTasks" max-height="420"
          ><el-table-column :label="$tr('导入')" width="65"
            ><template #default="{ row }"
              ><el-checkbox
                :model-value="selected.includes(row.id)"
                @change="toggle(row.id, $event)" /></template></el-table-column
          ><el-table-column type="expand"
            ><template #default="{ row }"
              ><div class="details">
                <p v-for="(issue, index) in row.issues" :key="index">
                  {{ issue }}
                </p>
                <p v-if="!row.issues.length">
                  {{ $tr('参数、字段和流程已确定性转换。') }}
                </p>
                <details>
                  <summary>{{ $tr('查看候选 JSON') }}</summary>
                  <pre>{{
                    JSON.stringify(
                      taskDocument(row.id)?.document?.pipelines.find(
                        (task) => task.id === row.id,
                      ),
                      null,
                      2,
                    )
                  }}</pre>
                </details>
              </div></template
            ></el-table-column
          ><el-table-column
            prop="name"
            :label="$tr('同步任务')"
            min-width="200"
          /><el-table-column
            prop="nodeCount"
            :label="$tr('节点')"
            width="65"
          /><el-table-column :label="$tr('状态')" width="100"
            ><template #default="{ row }"
              ><el-tag :type="row.status === 'READY' ? 'success' : 'warning'">{{
                row.status === 'READY'
                  ? $tr('可转换')
                  : row.status === 'DISABLED'
                    ? $tr('原流程停用')
                    : $tr('待修复')
              }}</el-tag></template
            ></el-table-column
          ><el-table-column
            prop="fileName"
            :label="$tr('来源文件')"
            min-width="180"
          /><el-table-column :label="$tr('操作')" width="115"
            ><template #default="{ row }"
              ><el-button link type="primary" @click="repair(row.id)">{{
                $tr('AI 检查 / 修复')
              }}</el-button></template
            ></el-table-column
          ></el-table
        >
        <el-pagination
          v-model:current-page="page"
          :total="filtered.length"
          :page-size="10"
          layout="total, prev, pager, next"
        />
      </template>
      <template v-else>
        <el-result
          icon="success"
          :title="$tr('准备追加到工作区草稿')"
          :sub-title="`${$tr('选中')} ${selected.length} ${$tr('个任务，匹配')} ${sources.length} ${$tr('个数据源。不覆盖已有任务，不保存、不运行。')}`"
        />
        <p
          v-if="
            reports.some(
              (task) => selected.includes(task.id) && task.status !== 'READY',
            )
          "
        >
          {{ $tr('包含待修复任务：将保留为停用状态，修复前不能运行。') }}
        </p>
      </template>
    </div>
    <template #footer
      ><el-button @click="visible = false">{{ $tr('取消') }}</el-button
      ><el-button v-if="step > 0" :disabled="busy" @click="step--">{{
        $tr('上一步')
      }}</el-button
      ><el-button
        v-if="step < 4"
        type="primary"
        :loading="busy"
        :disabled="!parseDone"
        @click="next"
        >{{ $tr('下一步') }}</el-button
      ><el-button v-else type="primary" :loading="busy" @click="apply">{{
        $tr('确认追加到草稿')
      }}</el-button></template
    >
  </el-dialog>
  <ConnectionDialog
    v-model="connectionVisible"
    mode="create"
    :initial-hint="connectionHint"
    @created="connectionCreated"
  />
  <AiChatWindow
    v-if="aiVisible"
    :key="`${aiStage}-${aiTaskId}`"
    ref="aiWindow"
    etl-mode
    :db-config-id="aiSource?.dbConfigId"
    :instance-name="aiSource?.instance"
    :conn-label="aiSource?.displayName"
    :get-extra-context="aiContext"
    :before-send="beforeAiSend"
    @apply-etl-config="applyAi"
  />
</template>

<style scoped>
:global(.kettle-wizard) {
  color: var(--el-text-color-primary);
}
.wizard-body {
  min-height: 310px;
  max-height: 58vh;
  overflow: auto;
  margin-top: 24px;
}
p {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.file-row,
.source-card,
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.source-card {
  border-bottom: 1px solid var(--el-border-color-light);
}
.source-card > div:first-child {
  width: 240px;
  flex-shrink: 0;
}
.source-card .el-select {
  flex: 1;
}
small {
  display: block;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
}
.instance-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--el-border-color-light);
  padding: 14px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.instance-card > strong {
  width: 100%;
}
.instance-card .el-select,
.instance-card .el-input {
  width: 220px;
}
.actions > span {
  flex: 1;
}
.actions .el-input {
  width: 220px;
}
.details {
  padding: 8px 18px;
}
pre {
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
}
.el-pagination {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
