<script setup lang="ts">
/**
 * 工作区右键消息通知：失败时扇出到用户已启用的企微/钉钉/飞书渠道。
 * @author yanch
 */
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type {
  EtlNotifyConfig,
  EtlNotifyDetail,
  EtlWorkspaceRow,
  NotifyChannelRow,
} from '#/api/visual/etl';
import {
  deleteEtlNotifyChannel,
  getEtlNotify,
  saveEtlNotify,
  saveEtlNotifyChannel,
  testEtlNotifyChannel,
  type EtlNotifyChannelSave,
} from '#/api/visual/etl';

const visible = ref(false);
const loading = ref(false);
const saving = ref(false);
const testingId = ref('');
const target = ref<EtlWorkspaceRow>();
const detail = ref<EtlNotifyDetail>();
const form = ref<EtlNotifyConfig>({
  enabled: false,
  onFailure: true,
  channelIds: [],
  revision: 0,
});
const editing = ref(false);
const channelForm = ref<EtlNotifyChannelSave>(emptyChannel());
const clearSecret = ref(false);
let requestVersion = 0;

const typeLabels: Record<string, string> = {
  WECOM: '企业微信',
  DINGTALK: '钉钉',
  FEISHU: '飞书',
};
const channels = computed(() => detail.value?.channels || []);
const enabledChannels = computed(() =>
  channels.value.filter((item) => item.enabled),
);
const webhookHint = computed(() => {
  const type = channelForm.value.channelType;
  if (type === 'WECOM')
    return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...';
  if (type === 'DINGTALK')
    return 'https://oapi.dingtalk.com/robot/send?access_token=...';
  return 'https://open.feishu.cn/open-apis/bot/v2/hook/...';
});
const hostHint = computed(() => {
  const type = channelForm.value.channelType;
  if (type === 'WECOM') return '仅允许主机 qyapi.weixin.qq.com（https）';
  if (type === 'DINGTALK') return '仅允许主机 oapi.dingtalk.com（https）';
  return '仅允许主机 open.feishu.cn / open.larksuite.com（https）';
});
/** 复选框值统一字符串，避免雪花 ID 经 Number 丢精度。 */
function channelKey(id: string | number) {
  return String(id);
}

function emptyChannel(): EtlNotifyChannelSave {
  return {
    channelType: 'WECOM',
    channelName: '',
    enabled: true,
    webhookUrl: '',
    keyword: '',
    secretInput: '',
  };
}

/** 打开指定工作区通知配置，不切换当前草稿。 */
async function open(workspace: EtlWorkspaceRow) {
  target.value = workspace;
  visible.value = true;
  editing.value = false;
  clearSecret.value = false;
  channelForm.value = emptyChannel();
  form.value = { enabled: false, onFailure: true, channelIds: [], revision: 0 };
  detail.value = undefined;
  await load(true);
}

async function load(reset = false) {
  if (!target.value) return;
  const version = ++requestVersion;
  loading.value = true;
  try {
    const response: any = await getEtlNotify(target.value.id);
    if (version !== requestVersion) return;
    detail.value = response.data ?? response;
    if (reset) {
      const row = detail.value?.notify;
      let channelIds: Array<string | number> = [];
      try {
        channelIds = JSON.parse(row?.channelIdsJson || '[]');
      } catch {
        channelIds = [];
      }
      form.value = {
        enabled: !!row?.enabled,
        onFailure: row?.onFailure !== false,
        channelIds: channelIds.map(channelKey),
        revision: row?.revision || 0,
      };
    }
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '消息通知加载失败');
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function selectAllEnabled() {
  form.value.channelIds = enabledChannels.value.map((item) =>
    channelKey(item.id),
  );
}

function startCreate() {
  editing.value = true;
  clearSecret.value = false;
  channelForm.value = emptyChannel();
}

function startEdit(row: NotifyChannelRow) {
  editing.value = true;
  clearSecret.value = false;
  channelForm.value = {
    id: row.id,
    channelType: row.channelType as EtlNotifyChannelSave['channelType'],
    channelName: row.channelName,
    enabled: !!row.enabled,
    webhookUrl: row.webhookUrl,
    keyword: row.keyword || '',
    secretInput: '',
  };
}

async function saveChannel() {
  if (!channelForm.value.channelName.trim()) {
    ElMessage.warning('请填写渠道名称');
    return;
  }
  if (!channelForm.value.webhookUrl.trim()) {
    ElMessage.warning('请填写 Webhook 地址');
    return;
  }
  if (!channelForm.value.webhookUrl.trim().toLowerCase().startsWith('https://')) {
    ElMessage.warning('Webhook 须为 https:// 官方地址');
    return;
  }
  saving.value = true;
  try {
    await saveEtlNotifyChannel({
      ...channelForm.value,
      channelName: channelForm.value.channelName.trim(),
      webhookUrl: channelForm.value.webhookUrl.trim(),
      keyword: channelForm.value.keyword?.trim() || '',
      secretInput: clearSecret.value
        ? undefined
        : channelForm.value.secretInput?.trim() || undefined,
      clearSecret: clearSecret.value || undefined,
    });
    ElMessage.success('渠道已保存');
    editing.value = false;
    clearSecret.value = false;
    await load(false);
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '渠道保存失败');
  } finally {
    saving.value = false;
  }
}

async function removeChannel(row: NotifyChannelRow) {
  try {
    await ElMessageBox.confirm(
      `确认删除渠道「${row.channelName}」？已勾选的工作区将不再向其发送。`,
      '删除渠道',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteEtlNotifyChannel(row.id);
    form.value.channelIds = form.value.channelIds.filter(
      (id) => String(id) !== String(row.id),
    );
    ElMessage.success('渠道已删除');
    await load(false);
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '渠道删除失败');
  }
}

async function testChannel(row: NotifyChannelRow) {
  testingId.value = String(row.id);
  try {
    await testEtlNotifyChannel(row.id);
    ElMessage.success('测试消息已发送');
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '测试发送失败');
  } finally {
    testingId.value = '';
  }
}

async function save() {
  if (!target.value) return;
  if (form.value.enabled && enabledChannels.value.length === 0) {
    ElMessage.warning('请先配置并启用至少一个消息渠道');
    return;
  }
  saving.value = true;
  try {
    const response: any = await saveEtlNotify(target.value.id, {
      ...form.value,
      channelIds: form.value.channelIds,
    });
    const row = response.data ?? response;
    form.value.revision = row?.revision ?? form.value.revision + 1;
    ElMessage.success(
      form.value.enabled ? '已开启失败消息通知' : '已保存（通知关闭）',
    );
    await load(true);
  } catch (error: any) {
    ElMessage.error(error.msg || error.message || '消息通知保存失败');
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    title="消息通知配置"
    width="min(760px, 94vw)"
    top="6vh"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-loading="loading" class="notify-body">
      <div class="notify-heading">
        <strong>{{ target?.workspaceName }}</strong>
        <el-tag :type="form.enabled ? 'success' : 'info'">{{
          form.enabled ? '失败通知已开启' : '未开启'
        }}</el-tag>
      </div>
      <el-alert
        title="开启后，本工作区 ETL 执行失败时，会向勾选的已启用渠道发送摘要（不含业务数据行）。渠道 Webhook 为当前用户共用。"
        type="info"
        :closable="false"
      />
      <el-form label-width="110px" class="notify-form" @submit.prevent="save">
        <el-form-item label="失败通知">
          <el-switch v-model="form.enabled" />
          <span class="hint">关闭后本工作区不再发送；不影响其他工作区</span>
        </el-form-item>
        <el-form-item label="通知渠道">
          <div class="channel-picker">
            <div class="picker-tools">
              <el-button size="small" @click="selectAllEnabled"
                >全选已启用</el-button
              >
              <el-button size="small" type="primary" @click="startCreate"
                >新增渠道</el-button
              >
            </div>
            <el-checkbox-group v-model="form.channelIds" class="channel-options">
              <div
                v-for="channel in channels"
                :key="channelKey(channel.id)"
                class="channel-row"
              >
                <el-checkbox
                  :value="channelKey(channel.id)"
                  :disabled="!channel.enabled"
                >
                  {{ typeLabels[channel.channelType] || channel.channelType }} ·
                  {{ channel.channelName
                  }}{{ channel.enabled ? '' : '（已停用）' }}
                  <el-tag v-if="channel.keyword" size="small" class="mini-tag"
                    >关键词</el-tag
                  >
                  <el-tag
                    v-if="channel.secretConfigured"
                    size="small"
                    class="mini-tag"
                    >已加签</el-tag
                  >
                </el-checkbox>
                <div class="channel-actions">
                  <el-button
                    link
                    type="primary"
                    :loading="testingId === String(channel.id)"
                    @click="testChannel(channel)"
                    >测试</el-button
                  >
                  <el-button link @click="startEdit(channel)">编辑</el-button>
                  <el-button link type="danger" @click="removeChannel(channel)"
                    >删除</el-button
                  >
                </div>
              </div>
            </el-checkbox-group>
            <small v-if="!channels.length"
              >尚未配置渠道。请新增企微 / 钉钉 / 飞书 Webhook。</small
            >
            <small v-else
              >未勾选时发送到当前用户全部已启用渠道；已勾选则仅发送到勾选项。</small
            >
          </div>
        </el-form-item>
      </el-form>

      <div v-if="editing" class="channel-editor">
        <strong>{{ channelForm.id ? '编辑渠道' : '新增渠道' }}</strong>
        <el-form label-width="100px" class="editor-form">
          <el-form-item label="渠道类型">
            <el-radio-group v-model="channelForm.channelType">
              <el-radio-button value="WECOM">企业微信</el-radio-button>
              <el-radio-button value="DINGTALK">钉钉</el-radio-button>
              <el-radio-button value="FEISHU">飞书</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="渠道名称">
            <el-input
              v-model="channelForm.channelName"
              maxlength="64"
              placeholder="例如：运维告警群"
            />
          </el-form-item>
          <el-form-item label="Webhook">
            <el-input
              v-model="channelForm.webhookUrl"
              type="textarea"
              :rows="2"
              :placeholder="webhookHint"
            />
            <small class="hint-block">{{ hostHint }}。超长正文会按各平台上限截断后再发。</small>
          </el-form-item>
          <el-form-item label="安全关键词">
            <el-input
              v-model="channelForm.keyword"
              maxlength="32"
              placeholder="与机器人安全设置中的关键词一致，可不填"
            />
            <small class="hint-block"
              >填写后，测试和告警若正文里没有该词，会自动补在末尾。企微群机器人主要靠关键词或
              IP 白名单；钉钉、飞书可与加签同时使用。</small
            >
          </el-form-item>
          <el-form-item
            v-if="channelForm.channelType !== 'WECOM'"
            label="加签密钥"
          >
            <el-input
              v-model="channelForm.secretInput"
              type="password"
              show-password
              :disabled="clearSecret"
              :placeholder="
                channelForm.id
                  ? '留空表示不修改已存密钥'
                  : '机器人开启加签时填写'
              "
            />
            <el-checkbox
              v-if="channelForm.id"
              v-model="clearSecret"
              class="clear-secret"
              >清空已存密钥</el-checkbox
            >
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="channelForm.enabled" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveChannel"
              >保存渠道</el-button
            >
            <el-button @click="editing = false">取消</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="save"
        >保存通知配置</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.notify-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(70vh, 720px);
  overflow: auto;
}
.notify-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.notify-form {
  margin-top: 4px;
}
.hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.channel-picker {
  width: 100%;
}
.picker-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.channel-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.channel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.channel-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}
.channel-editor {
  margin-top: 4px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}
.editor-form {
  margin-top: 10px;
}
.hint-block,
small {
  display: block;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
}
.clear-secret {
  margin-top: 6px;
}
.mini-tag {
  margin-left: 6px;
}
</style>
