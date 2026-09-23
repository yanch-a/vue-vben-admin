<script lang="ts" setup>
/**
 * 可编辑 JSON 面板：封装 vanilla-jsoneditor（josdejong/svelte-jsoneditor）。
 * 支持 tree / text / table、格式化、校验、搜索、撤销重做。
 *
 * @see https://github.com/josdejong/svelte-jsoneditor
 * @author yanch
 */
import type { Content } from 'vanilla-jsoneditor';

import { usePreferences } from '@vben/preferences';
import {
  createJSONEditor,
  isTextContent,
  Mode,
  toTextContent,
} from 'vanilla-jsoneditor';
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

// 默认主题样式已打进 JS；仅暗色主题需额外 CSS（包内无 jse-theme-default.css）
import 'vanilla-jsoneditor/themes/jse-theme-dark.css';

defineOptions({ name: 'JsonEditorPanel' });

const props = withDefaults(
  defineProps<{
    /** JSON 文本或已格式化字符串；非法 JSON 也能以 text 模式打开 */
    modelValue: string;
    /** 只读 */
    readOnly?: boolean;
    /** 初始模式 */
    mode?: 'tree' | 'text' | 'table';
    /** 高度，默认撑满父容器 */
    height?: string;
  }>(),
  {
    readOnly: false,
    mode: 'text',
    height: '100%',
  },
);

const emit = defineEmits<{
  'update:modelValue': [string];
  /** 内容是否可解析为合法 JSON */
  'update:valid': [boolean];
}>();

const { isDark } = usePreferences();
const hostRef = ref<HTMLDivElement | null>(null);
let editor: ReturnType<typeof createJSONEditor> | null = null;
/** 避免 set → onChange → emit → watch 死循环 */
let syncingFromProp = false;

function modeOf(m: string): Mode {
  if (m === 'text') return Mode.text;
  if (m === 'table') return Mode.table;
  return Mode.tree;
}

/** 尽量以 json 对象喂给编辑器；失败则走 text */
function toContent(raw: string): Content {
  const text = String(raw ?? '');
  if (!text.trim()) {
    return { json: null };
  }
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { text };
  }
}

function contentToString(content: Content): string {
  try {
    if (isTextContent(content)) {
      return content.text ?? '';
    }
    return JSON.stringify(content.json, null, 2);
  } catch {
    try {
      return toTextContent(content).text ?? '';
    } catch {
      return '';
    }
  }
}

function isContentValid(content: Content): boolean {
  try {
    if (isTextContent(content)) {
      const t = (content.text ?? '').trim();
      if (!t) return true;
      JSON.parse(t);
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

function mountEditor() {
  if (!hostRef.value || editor) return;
  editor = createJSONEditor({
    target: hostRef.value,
    props: {
      content: toContent(props.modelValue),
      mode: modeOf(props.mode),
      readOnly: props.readOnly,
      mainMenuBar: true,
      navigationBar: true,
      statusBar: true,
      askToFormat: true,
      onChange: (content) => {
        if (syncingFromProp) return;
        const text = contentToString(content);
        emit('update:modelValue', text);
        emit('update:valid', isContentValid(content));
      },
    },
  });
  emit('update:valid', isContentValid(toContent(props.modelValue)));
}

function destroyEditor() {
  editor?.destroy();
  editor = null;
}

onMounted(async () => {
  await nextTick();
  mountEditor();
});

onBeforeUnmount(() => {
  destroyEditor();
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor) return;
    const current = contentToString(editor.get());
    if (current === val) return;
    syncingFromProp = true;
    try {
      editor.set(toContent(val));
    } finally {
      syncingFromProp = false;
    }
    emit('update:valid', isContentValid(toContent(val)));
  },
);

watch(
  () => props.readOnly,
  (v) => {
    editor?.updateProps({ readOnly: !!v });
  },
);

watch(
  () => props.mode,
  (m) => {
    editor?.updateProps({ mode: modeOf(m) });
  },
);

/** 供父级主动取当前文本 */
defineExpose({
  getText: () => (editor ? contentToString(editor.get()) : props.modelValue),
  format: () => {
    // vanilla-jsoneditor 菜单自带 Format；此处用 set 触发一次美化
    if (!editor) return;
    const text = contentToString(editor.get());
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2);
      syncingFromProp = true;
      editor.set({ text: pretty });
      syncingFromProp = false;
      emit('update:modelValue', pretty);
      emit('update:valid', true);
    } catch {
      // 非法 JSON 不强行格式化
    }
  },
});
</script>

<template>
  <div
    class="json-editor-panel"
    :class="{ 'jse-theme-dark': isDark }"
    :style="{ height }"
  >
    <div ref="hostRef" class="json-editor-host" />
  </div>
</template>

<style scoped>
.json-editor-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.json-editor-host {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.json-editor-host :deep(.jse-main) {
  height: 100%;
  border: none !important;
  border-radius: 0 !important;
}
.json-editor-host :deep(.jse-main),
.json-editor-host :deep(.cm-editor) {
  font-size: 13px;
}
</style>
