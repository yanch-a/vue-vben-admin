<script lang="ts" setup>
/**
 * SQL 编辑器（Monaco）
 * - 跟随系统亮/暗主题
 * - Ctrl+Enter 执行（由父级按光标/选区切分语句）
 * - Ctrl+S 保存
 * - 智能补全：写表名用本地表清单；写字段名按需拉列并缓存；Tab 接受建议
 * @author yanch
 */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { usePreferences } from '@vben/preferences';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import 'monaco-editor/min/vs/editor/editor.main.css';

import {
  detectCompletionContext,
  extractExecutableSql,
  getAllRememberedTables,
  getCachedColumns,
  getRememberedTables,
  matchColumnSuggestions,
  matchTableSuggestions,
  setCachedColumns,
} from '../../utils/sqlEditorAssist';
import { resolveSqlDialect } from '../../dialect/sqlDialect';

// monaco-editor 0.56+：exports 映射为 "./*" -> "./esm/vs/*.js"
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

defineOptions({ name: 'SqlEditor' });

const props = defineProps<{
  modelValue: string;
  dbConfigId?: number | string;
  /** 数据库类型码：用于方言触发字符等（不拆多套编辑器组件） */
  dbType?: string;
  /** 当前编辑器所属库 */
  instanceName?: string;
  /**
   * 缓存未命中时按需加载字段（返回字段名列表；主键可选）
   */
  loadColumns?: (
    instanceName: string,
    tableName: string,
  ) => Promise<{ columns: string[]; primaryKeys?: string[] }>;
  /** 当前库表清单为空时，按需从远端拉一次表名 */
  loadTables?: (instanceName: string) => Promise<string[]>;
}>();

const emit = defineEmits<{
  'update:modelValue': [string];
  execute: [];
  save: [];
}>();

const { isDark } = usePreferences();
const container = ref<HTMLDivElement>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let completionDisposable: monaco.IDisposable | null = null;

function themeName() {
  return isDark.value ? 'vs-dark' : 'vs';
}

async function resolveTableNames(schemaHint?: string): Promise<
  { tableName: string; schema?: string }[]
> {
  const dbId = props.dbConfigId;
  const inst = props.instanceName || '';
  if (dbId == null) return [];

  // 指定了库前缀：优先该库缓存
  if (schemaHint) {
    let list = getRememberedTables(dbId, schemaHint);
    if (!list.length && props.loadTables) {
      const names = await props.loadTables(schemaHint);
      list = names.map((tableName) => ({ tableName, schema: schemaHint }));
    }
    return list;
  }

  // 当前库
  let list = inst ? getRememberedTables(dbId, inst) : [];
  if (!list.length && inst && props.loadTables) {
    const names = await props.loadTables(inst);
    list = names.map((tableName) => ({ tableName, schema: inst }));
  }
  // 再并入本连接其它已展开库（支持手写其它 db.table）
  const all = getAllRememberedTables(dbId);
  const map = new Map<string, { tableName: string; schema?: string }>();
  [...list, ...all].forEach((t) => {
    map.set(`${(t.schema || '').toLowerCase()}.${t.tableName.toLowerCase()}`, t);
  });
  return [...map.values()];
}

async function resolveColumns(
  schema: string | undefined,
  table: string,
): Promise<string[]> {
  const dbId = props.dbConfigId;
  const inst = schema || props.instanceName || '';
  if (dbId == null || !inst || !table) return [];

  const cached = getCachedColumns(dbId, inst, table);
  if (cached) return cached.columns;

  if (!props.loadColumns) return [];
  try {
    const res = await props.loadColumns(inst, table);
    setCachedColumns(
      dbId,
      inst,
      table,
      res.columns || [],
      res.primaryKeys || [],
    );
    return res.columns || [];
  } catch {
    return [];
  }
}

function registerCompletion() {
  completionDisposable?.dispose();
  completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [
      ...resolveSqlDialect(props.dbType).completionTriggers,
      ',',
      '(',
    ],
    provideCompletionItems: async (model, position) => {
      // 只服务当前编辑器 model，避免多 Tab 互相干扰
      if (!editor || model !== editor.getModel()) {
        return { suggestions: [] };
      }
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const ctx = detectCompletionContext(text, offset);
      if (ctx.kind === 'none') {
        return { suggestions: [] };
      }

      const range = {
        startLineNumber: model.getPositionAt(ctx.replaceFrom).lineNumber,
        startColumn: model.getPositionAt(ctx.replaceFrom).column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };

      if (ctx.kind === 'table') {
        const tables = await resolveTableNames(ctx.schema);
        const matched = matchTableSuggestions(
          tables,
          ctx,
          props.instanceName,
        );
        return {
          suggestions: matched.slice(0, 100).map((t, i) => {
            const label =
              ctx.schema || t.schema !== props.instanceName
                ? `${t.schema ? t.schema + '.' : ''}${t.tableName}`
                : t.tableName;
            // 若用户已输入 schema.，只补全表名段
            const insert = ctx.schema ? t.tableName : label;
            return {
              label,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: insert,
              range,
              sortText: String(i).padStart(4, '0'),
              detail: '表',
            } as monaco.languages.CompletionItem;
          }),
        };
      }

      // column
      if (!ctx.table) {
        return { suggestions: [] };
      }
      const cols = await resolveColumns(ctx.schema, ctx.table);
      const matchedCols = matchColumnSuggestions(cols, ctx.prefix);
      return {
        suggestions: matchedCols.slice(0, 200).map((c, i) => ({
          label: c,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: c,
          range,
          sortText: String(i).padStart(4, '0'),
          detail: `${ctx.table} 字段`,
        })),
      };
    },
  });
}

onMounted(() => {
  if (!container.value) return;
  editor = monaco.editor.create(container.value, {
    value: props.modelValue || '',
    language: 'sql',
    theme: themeName(),
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    // Tab 接受补全建议
    tabCompletion: 'on',
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: {
      showWords: false,
      insertMode: 'replace',
      preview: true,
    },
    acceptSuggestionOnCommitCharacter: true,
    acceptSuggestionOnEnter: 'on',
  });
  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor?.getValue() || '');
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    emit('execute');
  });
  // F9：与多数数据库客户端一致的执行快捷键
  editor.addCommand(monaco.KeyCode.F9, () => {
    emit('execute');
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save');
  });
  registerCompletion();
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor) return;
    if (val !== editor.getValue()) {
      editor.setValue(val || '');
    }
  },
);

watch(isDark, () => {
  monaco.editor.setTheme(themeName());
});

onBeforeUnmount(() => {
  completionDisposable?.dispose();
  completionDisposable = null;
  editor?.dispose();
  editor = null;
  // 字段缓存按连接切换清理（见 index），切换 Tab 不清空以便复用
});

function insertText(text: string) {
  if (!editor) return;
  const selection = editor.getSelection();
  if (selection) {
    editor.executeEdits('', [
      { range: selection, text, forceMoveMarkers: true },
    ]);
  } else {
    editor.setValue((editor.getValue() || '') + text);
  }
  editor.focus();
}

/**
 * 供父级执行：优先选区，否则光标所在分号语句
 */
function getExecutableSql(): string {
  if (!editor) return props.modelValue || '';
  const model = editor.getModel();
  if (!model) return editor.getValue();
  const value = model.getValue();
  const sel = editor.getSelection();
  let selectionRange = null as { start: number; end: number } | null;
  if (sel && !sel.isEmpty()) {
    selectionRange = {
      start: model.getOffsetAt(sel.getStartPosition()),
      end: model.getOffsetAt(sel.getEndPosition()),
    };
  }
  const pos = editor.getPosition() || sel?.getStartPosition();
  const cursor = pos ? model.getOffsetAt(pos) : value.length;
  return extractExecutableSql(value, cursor, selectionRange);
}

defineExpose({
  insertText,
  getValue: () => editor?.getValue() || '',
  getExecutableSql,
});
</script>

<template>
  <div ref="container" class="sql-editor" />
</template>

<style scoped>
.sql-editor {
  width: 100%;
  height: 100%;
  min-height: 160px;
}
</style>
