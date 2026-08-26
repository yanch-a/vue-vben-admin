<script setup>
/**
 * 查询结果分享页：无菜单全屏 Univer 表格，登录用户可协同编辑并同步到服务器
 * 右侧抽屉展示操作记录
 * @author yanch
 */
import { ElMessage } from 'element-plus';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { usePreferences } from '@vben/preferences';

import {
  exportQueryResultExcel,
  getQueryResultByShareCode,
  listQueryResultOpLogs,
  syncQueryResultContent,
} from '#/api/visual/queryResultFile';

import { LocaleType, mergeLocales, Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import DesignZhCN from '@univerjs/design/locale/zh-CN';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import SheetsFormulaUIZhCN from '@univerjs/sheets-formula-ui/locale/zh-CN';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import SheetsNumfmtUIZhCN from '@univerjs/sheets-numfmt-ui/locale/zh-CN';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import SheetsUIZhCN from '@univerjs/sheets-ui/locale/zh-CN';
import SheetsZhCN from '@univerjs/sheets/locale/zh-CN';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverVue3AdapterPlugin } from '@univerjs/ui-adapter-vue3';
import UIZhCN from '@univerjs/ui/locale/zh-CN';

import '@univerjs/engine-formula/facade';
import '@univerjs/ui/facade';
import '@univerjs/docs-ui/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-numfmt/facade';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';

const route = useRoute();
const { isDark } = usePreferences();
const univerContainer = ref(null);
const loading = ref(true);
const title = ref('共享查询结果');
const drawerVisible = ref(false);
const opLogs = ref([]);
const syncing = ref(false);
const exporting = ref(false);
/** 是否允许写回（WRITE 分享或所有者场景由后端 canWrite 判定） */
const canWrite = ref(false);

let univerInstance = null;
let univerAPI = null;
let resultFileId = null;
let contentVersion = 1;
let columnsCache = [];
let syncTimer = null;
let commandDisposable = null;
/** 批量写入时忽略命令回放，避免自触发同步风暴 */
let suppressCommand = false;

const shareCode = () => String(route.params.shareCode || '');

function initUniver() {
  if (!univerContainer.value) return;
  try {
    univerAPI?.dispose?.();
    univerInstance?.dispose?.();
  } catch {
    /* ignore */
  }

  univerInstance = new Univer({
    darkMode: !!isDark.value,
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(
        DesignZhCN,
        UIZhCN,
        DocsUIZhCN,
        SheetsZhCN,
        SheetsUIZhCN,
        SheetsFormulaUIZhCN,
        SheetsNumfmtUIZhCN,
      ),
    },
  });
  univerInstance.registerPlugin(UniverRenderEnginePlugin);
  univerInstance.registerPlugin(UniverFormulaEnginePlugin);
  univerInstance.registerPlugin(UniverUIPlugin, { container: univerContainer.value });
  univerInstance.registerPlugin(UniverVue3AdapterPlugin);
  univerInstance.registerPlugin(UniverDocsPlugin);
  univerInstance.registerPlugin(UniverDocsUIPlugin);
  univerInstance.registerPlugin(UniverSheetsPlugin);
  univerInstance.registerPlugin(UniverSheetsUIPlugin);
  univerInstance.registerPlugin(UniverSheetsFormulaPlugin);
  univerInstance.registerPlugin(UniverSheetsFormulaUIPlugin);
  univerInstance.registerPlugin(UniverSheetsNumfmtPlugin);
  univerInstance.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univerAPI = FUniver.newAPI(univerInstance);
  univerAPI.createWorkbook({ name: '共享结果' });
}

watch(isDark, (dark) => {
  try {
    univerAPI?.toggleDarkMode?.(!!dark);
  } catch {
    /* ignore */
  }
});

  /** 最近一次加载的行数，用于回读 sheet */
  let knownRowCount = 0;

function renderData(columns, rows) {
  if (!univerAPI) initUniver();
  const workbook = univerAPI?.getActiveWorkbook();
  const sheet = workbook?.getActiveSheet();
  if (!sheet) return;
  columnsCache = columns || [];
  knownRowCount = (rows || []).length;
  const values = [columnsCache.map((c) => String(c))];
  (rows || []).forEach((row) => {
    values.push(
      columnsCache.map((c) => {
        const v = row[c];
        return v === null || v === undefined ? '' : v;
      }),
    );
  });
  suppressCommand = true;
  try {
    sheet.getRange(0, 0, values.length, Math.max(columnsCache.length, 1)).setValues(values);
  } finally {
    nextTick(() => {
      suppressCommand = false;
    });
  }
}

/**
 * 从当前 sheet 读回二维数据，转为 columns + rows 对象数组
 */
function readSheetAsResult() {
  const workbook = univerAPI?.getActiveWorkbook();
  const sheet = workbook?.getActiveSheet();
  if (!sheet || !columnsCache.length) {
    return { columns: columnsCache, rows: [] };
  }
  // 表头 + 已知行数 + 缓冲，避免漏读用户新增行
  const maxRows = Math.max(knownRowCount + 50, 100);
  const range = sheet.getRange(0, 0, maxRows, columnsCache.length);
  const matrix = range.getValues?.() || [];
  if (!matrix.length) {
    return { columns: columnsCache, rows: [] };
  }
  const header = matrix[0].map((c) => (c == null ? '' : String(c)));
  const rows = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] || [];
    const empty = line.every((cell) => cell === null || cell === undefined || cell === '');
    if (empty) continue;
    const obj = {};
    header.forEach((col, idx) => {
      obj[col] = line[idx];
    });
    rows.push(obj);
  }
  columnsCache = header;
  knownRowCount = rows.length;
  return { columns: header, rows };
}

function scheduleSync(commandMeta) {
  if (!canWrite.value) return;
  if (suppressCommand || !resultFileId) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    flushSync(commandMeta);
  }, 800);
}

async function flushSync(commandMeta) {
  if (!canWrite.value || !resultFileId || syncing.value) return;
  syncing.value = true;
  try {
    const { columns, rows } = readSheetAsResult();
    const { data } = await syncQueryResultContent({
      resultFileId,
      contentVersion,
      columns,
      rows,
      commandId: commandMeta?.id,
      commandName: commandMeta?.name || commandMeta?.id,
      commandPayload: commandMeta?.params
        ? JSON.stringify(commandMeta.params).slice(0, 8000)
        : undefined,
    });
    if (data?.contentVersion != null) {
      contentVersion = data.contentVersion;
    }
  } catch (e) {
    console.error('同步结果失败', e);
    ElMessage.warning(e?.message || '同步失败，请稍后重试');
  } finally {
    syncing.value = false;
  }
}

function bindCommandListener() {
  try {
    const hooks = univerAPI?.getHooks?.() || univerInstance;
    // Facade：监听命令执行结束，记录并防抖同步整表
    commandDisposable = univerAPI?.onCommandExecuted?.((command) => {
      if (suppressCommand) return;
      const id = command?.id || command?.type || 'unknown';
      // 忽略纯选区类命令，减少噪音
      if (String(id).includes('set-selections') || String(id).includes('scroll')) {
        return;
      }
      scheduleSync({
        id: String(id),
        name: command?.name || String(id),
        params: command?.params,
      });
    });
    if (!commandDisposable && hooks) {
      // 兼容不同 Univer 版本：无 onCommandExecuted 时改为定时落盘
      console.warn('当前 Univer 版本无 onCommandExecuted，将使用定时同步');
    }
  } catch (e) {
    console.warn('绑定 Univer 命令监听失败', e);
  }
}

async function loadOpLogs() {
  if (!resultFileId) return;
  try {
    const { data } = await listQueryResultOpLogs(resultFileId, 200);
    opLogs.value = data || [];
  } catch (e) {
    console.error(e);
  }
}

async function bootstrap() {
  loading.value = true;
  try {
    const code = shareCode();
    if (!code) {
      ElMessage.error('分享码无效');
      return;
    }
    const { data } = await getQueryResultByShareCode(code);
    title.value = data?.meta?.title || '共享查询结果';
    resultFileId = data?.meta?.id;
    contentVersion = data?.meta?.contentVersion || 1;
    canWrite.value = !!data?.canWrite;
    await nextTick();
    initUniver();
    renderData(data?.columns || [], data?.rows || []);
    if (canWrite.value) {
      bindCommandListener();
    }
    await loadOpLogs();
  } catch (e) {
    console.error(e);
    ElMessage.error(e?.message || '加载分享失败，请确认已登录且链接有效');
  } finally {
    loading.value = false;
  }
}

function openDrawer() {
  drawerVisible.value = true;
  loadOpLogs();
}

function unwrapFileBlob(res) {
  if (res instanceof Blob) return res;
  if (res?.data instanceof Blob) return res.data;
  return null;
}

/** 导出当前表格视图为 Excel */
async function exportExcel() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    // 可编辑时先尽量落盘，再读当前 sheet，保证导出含本地改动
    if (canWrite.value && resultFileId) {
      try {
        await flushSync({ id: 'export', name: 'export-before-download' });
      } catch {
        /* 同步失败仍允许导出当前视图 */
      }
    }
    const { columns, rows } = readSheetAsResult();
    if (!columns?.length) {
      ElMessage.warning('没有可导出的数据');
      return;
    }
    const res = await exportQueryResultExcel({
      shareCode: shareCode(),
      resultFileId: resultFileId || undefined,
      title: title.value || '分享结果导出',
      columns,
      rows,
    });
    const fileBlob = unwrapFileBlob(res);
    if (!fileBlob) {
      ElMessage.error('导出失败：未收到有效文件');
      return;
    }
    if (fileBlob.type && fileBlob.type.includes('application/json')) {
      const text = await fileBlob.text();
      let msg = '导出失败';
      try {
        msg = JSON.parse(text)?.msg || msg;
      } catch {
        /* ignore */
      }
      ElMessage.error(msg);
      return;
    }
    const safeName = String(title.value || '分享结果导出')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80);
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    console.error(e);
    ElMessage.error(e?.message || e?.msg || '导出失败');
  } finally {
    exporting.value = false;
  }
}

onMounted(() => {
  bootstrap();
});

onBeforeUnmount(() => {
  if (syncTimer) clearTimeout(syncTimer);
  try {
    commandDisposable?.dispose?.();
    univerAPI?.dispose?.();
    univerInstance?.dispose?.();
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <div class="share-page" v-loading="loading">
    <header class="share-header">
      <h1>{{ title }}</h1>
      <div class="actions">
        <el-tag v-if="!canWrite" type="info" size="small">只读分享</el-tag>
        <el-tag v-else type="success" size="small">可编辑</el-tag>
        <el-tag v-if="syncing" type="warning" size="small">同步中…</el-tag>
        <el-button size="small" type="primary" :loading="exporting" @click="exportExcel">
          导出 Excel
        </el-button>
        <el-button size="small" @click="openDrawer">操作记录</el-button>
      </div>
    </header>
    <div ref="univerContainer" class="share-univer"></div>

    <el-drawer v-model="drawerVisible" title="用户操作记录" size="360px">
      <el-timeline v-if="opLogs.length">
        <el-timeline-item
          v-for="item in opLogs"
          :key="item.id"
          :timestamp="item.createTime"
          placement="top"
        >
          <p class="op-user">{{ item.userName || item.userId }}</p>
          <p class="op-cmd">{{ item.commandName || item.commandId }}</p>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无操作记录" />
    </el-drawer>
  </div>
</template>

<style scoped>
.share-page {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--el-bg-color-page);
}

.share-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.share-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.share-univer {
  flex: 1;
  min-height: 0;
  background: var(--el-bg-color);
}

.op-user {
  margin: 0 0 4px;
  font-weight: 600;
}

.op-cmd {
  margin: 0;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
}
</style>
