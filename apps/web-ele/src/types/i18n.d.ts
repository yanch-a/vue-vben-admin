import type { translateUiText } from '../locales/ui-text';

declare module 'vue' {
  interface ComponentCustomProperties {
    /** 翻译历史业务界面文案；新增代码优先使用 $t 语义消息键。 */
    $tr: typeof translateUiText;
  }
}

export {};
