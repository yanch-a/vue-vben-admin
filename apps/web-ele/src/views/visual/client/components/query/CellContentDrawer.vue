<script lang="ts" setup>
/**
 * 单元格内容抽屉（右侧）：
 * - JSON：vanilla-jsoneditor 可编辑（树/文本/表）
 * - XML / 原文：Monaco 可编辑，支持格式化
 *
 * @author yanch
 */
import * as monaco from 'monaco-editor';
import { usePreferences } from '@vben/preferences';
import { ElMessage } from 'element-plus';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue';

import JsonEditorPanel from './JsonEditorPanel.vue';

defineOptions({ name: 'CellContentDrawer' });

const props = defineProps<{
  modelValue: boolean;
  /** 列名，用于标题 */
  columnName?: string;
  /** 单元格原始文本 */
  rawText?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const { isDark } = usePreferences();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

type ViewMode = 'json' | 'xml' | 'raw';
const viewMode = ref<ViewMode>('json');
const editText = ref('');
const jsonValid = ref(true);
const hint = ref('');
const jsonEditorRef = ref<InstanceType<typeof JsonEditorPanel> | null>(null);

const monacoHost = ref<HTMLDivElement | null>(null);
let monacoEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let applyingExternal = false;

const title = computed(() => {
  const col = props.columnName?.trim();
  return col ? `单元格内容 · ${col}` : '单元格内容';
});

function themeName() {
  return isDark.value ? 'vs-dark' : 'vs';
}

function tryFormatJson(raw: string): string | null {
  try {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function tryFormatXml(raw: string): string | null {
  try {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    const serialized = new XMLSerializer().serializeToString(doc);
    return prettyIndentXml(serialized);
  } catch {
    return null;
  }
}

function prettyIndentXml(xml: string): string {
  try {
    const cleaned = xml.replace(/>\s+</g, '><').trim();
    const parts = cleaned.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n');
    let indent = 0;
    const lines: string[] = [];
    for (const part of parts) {
      const line = part.trim();
      if (!line) continue;
      if (/^<\/\w/.test(line)) indent = Math.max(0, indent - 1);
      lines.push(`${'  '.repeat(indent)}${line}`);
      if (
        /^<\w[^>]*[^/]>/.test(line) &&
        !/\/>$/.test(line) &&
        !/^<\?/.test(line) &&
        !/^<!/.test(line)
      ) {
        indent += 1;
      }
    }
    return lines.join('\n');
  } catch {
    return xml;
  }
}

function disposeMonaco() {
  monacoEditor?.dispose();
  monacoEditor = null;
}

async function ensureMonaco(language: 'xml' | 'plaintext') {
  await nextTick();
  if (!monacoHost.value) return;
  if (monacoEditor) {
    const model = monacoEditor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
    monacoEditor.updateOptions({ readOnly: false });
    if (!applyingExternal && editText.value !== monacoEditor.getValue()) {
      applyingExternal = true;
      monacoEditor.setValue(editText.value);
      applyingExternal = false;
    }
    return;
  }
  monacoEditor = monaco.editor.create(monacoHost.value, {
    value: editText.value,
    language,
    theme: themeName(),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
  });
  monacoEditor.onDidChangeModelContent(() => {
    if (applyingExternal) return;
    editText.value = monacoEditor?.getValue() || '';
  });
}

function switchMode(mode: ViewMode) {
  // 离开 JSON 模式前，把编辑器最新内容同步出来
  if (viewMode.value === 'json' && jsonEditorRef.value?.getText) {
    editText.value = jsonEditorRef.value.getText();
  }
  viewMode.value = mode;
  hint.value = '';
  if (mode === 'json') {
    disposeMonaco();
    const pretty = tryFormatJson(editText.value);
    if (pretty != null) {
      editText.value = pretty;
      hint.value = '';
    } else if (editText.value.trim()) {
      hint.value = '当前内容不是合法 JSON，可在编辑器文本模式中修改，或切换到原文';
    }
    return;
  }
  if (mode === 'xml') {
    const pretty = tryFormatXml(editText.value);
    if (pretty != null) {
      editText.value = pretty;
      hint.value = '';
    } else if (editText.value.trim()) {
      hint.value = 'XML 格式化失败，已保留原文，可继续编辑';
    }
    void ensureMonaco('xml');
    return;
  }
  void ensureMonaco('plaintext');
}

function onFormatClick() {
  if (viewMode.value === 'json') {
    jsonEditorRef.value?.format?.();
    const pretty = tryFormatJson(editText.value);
    if (pretty == null) {
      hint.value = 'JSON 格式化失败';
    } else {
      editText.value = pretty;
      hint.value = '';
    }
    return;
  }
  if (viewMode.value === 'xml') {
    const pretty = tryFormatXml(editText.value);
    if (pretty == null) {
      hint.value = 'XML 格式化失败';
      return;
    }
    editText.value = pretty;
    hint.value = '';
    if (monacoEditor) {
      applyingExternal = true;
      monacoEditor.setValue(pretty);
      applyingExternal = false;
    }
  }
}

async function copyCurrent() {
  const text =
    viewMode.value === 'json'
      ? jsonEditorRef.value?.getText?.() ?? editText.value
      : editText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  ElMessage.success('已复制');
}

function resetFromProps() {
  editText.value = props.rawText ?? '';
  viewMode.value = 'json';
  hint.value = '';
  const pretty = tryFormatJson(editText.value);
  if (pretty != null) {
    editText.value = pretty;
  } else if (editText.value.trim()) {
    hint.value = '默认按 JSON 打开失败，可切换原文或在文本模式编辑';
  }
  disposeMonaco();
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      resetFromProps();
      await nextTick();
      if (viewMode.value !== 'json') {
        await ensureMonaco(viewMode.value === 'xml' ? 'xml' : 'plaintext');
      }
    } else {
      disposeMonaco();
    }
  },
);

watch(isDark, () => {
  monaco.editor.setTheme(themeName());
});

onBeforeUnmount(() => {
  disposeMonaco();
});
</script>

<template>
  <ElDrawer
    v-model="visible"
    direction="rtl"
    size="560px"
    append-to-body
    destroy-on-close
    class="cell-content-drawer"
    :title="title"
  >
    <div class="ccd-body">
      <div class="ccd-toolbar">
        <div class="ccd-modes">
          <ElButton
            size="small"
            :type="viewMode === 'json' ? 'primary' : 'default'"
            @click="switchMode('json')"
          >
            JSON 编辑器
          </ElButton>
          <ElButton
            size="small"
            :type="viewMode === 'xml' ? 'primary' : 'default'"
            @click="switchMode('xml')"
          >
            XML
          </ElButton>
          <ElButton
            size="small"
            :type="viewMode === 'raw' ? 'primary' : 'default'"
            @click="switchMode('raw')"
          >
            原文
          </ElButton>
        </div>
        <div class="ccd-actions">
          <ElButton size="small" @click="onFormatClick">格式化</ElButton>
          <ElButton size="small" type="primary" plain @click="copyCurrent">
            复制
          </ElButton>
        </div>
      </div>

      <p v-if="hint" class="ccd-hint">{{ hint }}</p>
      <p v-else-if="viewMode === 'json'" class="ccd-tip">
        基于
        <a
          href="https://github.com/josdejong/svelte-jsoneditor"
          target="_blank"
          rel="noopener"
        >vanilla-jsoneditor</a>
        ：树形 / 文本 / 表格可切换，支持搜索、校验、转换与撤销。
        <span v-if="!jsonValid" class="ccd-invalid">（当前 JSON 尚未通过校验）</span>
      </p>

      <div class="ccd-editor">
        <JsonEditorPanel
          v-if="viewMode === 'json' && visible"
          ref="jsonEditorRef"
          v-model="editText"
          mode="text"
          height="100%"
          @update:valid="jsonValid = $event"
        />
        <div
          v-show="viewMode !== 'json'"
          ref="monacoHost"
          class="ccd-monaco"
        />
      </div>
    </div>
  </ElDrawer>
</template>

<style scoped>
.ccd-body {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  min-height: 360px;
  gap: 10px;
}
.ccd-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ccd-modes,
.ccd-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ccd-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-warning);
}
.ccd-tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.ccd-tip a {
  color: var(--el-color-primary);
  text-decoration: none;
}
.ccd-tip a:hover {
  text-decoration: underline;
}
.ccd-invalid {
  color: var(--el-color-danger);
}
.ccd-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ccd-monaco {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
}
</style>

<style>
/* 抽屉内容区拉高，给编辑器足够空间 */
.cell-content-drawer.el-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding-top: 8px;
  overflow: hidden;
}
</style>
