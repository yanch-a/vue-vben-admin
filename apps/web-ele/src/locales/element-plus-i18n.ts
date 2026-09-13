import { watch } from 'vue';

import { i18n } from '@vben/locales';

import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';

import { translateUiText } from './ui-text';

type AnyFunction = (...args: any[]) => any;

const PATCHED_FLAG = Symbol('lemon-i18n-patched');

/**
 * 翻译 Element Plus 消息参数，兼容字符串、VNode 和 options 对象。
 */
function translateMessageArgument(argument: unknown): unknown {
  if (typeof argument === 'string') {
    return translateUiText(argument);
  }
  if (!argument || typeof argument !== 'object') {
    return argument;
  }
  const options = { ...(argument as Record<string, unknown>) };
  for (const key of [
    'message',
    'title',
    'confirmButtonText',
    'cancelButtonText',
    'inputPlaceholder',
  ]) {
    if (typeof options[key] === 'string') {
      options[key] = translateUiText(options[key]);
    }
  }
  return options;
}

/**
 * 包装对象上的反馈方法，使脚本中的历史中文提示自动跟随当前语言。
 */
function patchFeedbackMethods(
  api: Record<PropertyKey, unknown>,
  methods: string[],
) {
  if (api[PATCHED_FLAG]) return;
  for (const method of methods) {
    const original = api[method];
    if (typeof original !== 'function') continue;
    api[method] = (...args: unknown[]) => {
      const translatedArgs = [...args];
      if (translatedArgs.length > 0) {
        translatedArgs[0] = translateMessageArgument(translatedArgs[0]);
      }
      if (
        translatedArgs.length > 1 &&
        typeof translatedArgs[1] === 'string'
      ) {
        translatedArgs[1] = translateUiText(translatedArgs[1]);
      }
      if (translatedArgs.length > 2) {
        translatedArgs[2] = translateMessageArgument(translatedArgs[2]);
      }
      return (original as AnyFunction)(...translatedArgs);
    };
  }
  api[PATCHED_FLAG] = true;
}

/**
 * 只翻译明确属于控件文案的 DOM 节点，避免修改 SQL 编辑器、查询结果和用户数据。
 */
function translateControlDom(root: ParentNode) {
  if (i18n.global.locale.value !== 'en-US') return;

  const selector = [
    'button',
    'th',
    '.el-form-item__label',
    '.el-dialog__title',
    '.el-drawer__title',
    '.el-tabs__item',
    '.el-menu-item',
    '.el-sub-menu__title',
    '.el-dropdown-menu__item',
    '.el-message__content',
    '.el-message-box',
    '.el-notification',
    '.el-empty__description',
    '.el-checkbox__label',
    '.el-radio__label',
    '.el-pagination',
    '.el-descriptions__label',
  ].join(',');

  const elements = [
    ...(root instanceof Element && root.matches(selector) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(selector),
  ];
  for (const element of elements) {
    if (
      element.closest(
        '[data-i18n-ignore], .monaco-editor, .cm-editor, pre, code, tbody',
      )
    ) {
      continue;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const translated = translateUiText(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
      node = walker.nextNode();
    }
  }

  const attributeElements = [
    ...(root instanceof Element ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(
      '[placeholder], [title], [aria-label]',
    ),
  ];
  for (const element of attributeElements) {
    if (element.closest('[data-i18n-ignore], .monaco-editor, .cm-editor')) {
      continue;
    }
    for (const name of ['placeholder', 'title', 'aria-label']) {
      const value = element.getAttribute(name);
      if (value) element.setAttribute(name, translateUiText(value));
    }
  }
}

/**
 * 安装 Element Plus 与历史页面文案兼容层。
 *
 * <p>模板中的静态文字由迁移脚本改为 $tr；运行时生成的表头、反馈弹窗和动态属性
 * 在这里兜底。新增页面仍应直接使用 $t 语义消息键。</p>
 *
 * @author yanch
 */
function setupElementPlusI18nBridge() {
  patchFeedbackMethods(ElMessage as any, [
    'closeAll',
    'error',
    'info',
    'primary',
    'success',
    'warning',
  ]);
  patchFeedbackMethods(ElMessageBox as any, [
    'alert',
    'confirm',
    'prompt',
  ]);
  patchFeedbackMethods(ElNotification as any, [
    'error',
    'info',
    'success',
    'warning',
  ]);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) translateControlDom(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  translateControlDom(document.body);

  // 当前应用切换语言后会刷新并重新获取后台菜单；监听用于开发热更新场景即时补齐控件。
  watch(i18n.global.locale, () => translateControlDom(document.body), {
    flush: 'post',
  });
}

export { setupElementPlusI18nBridge };
