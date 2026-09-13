import type { App } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';

import { translateUiText } from '#/locales/ui-text';

/**
 * 兼容 admin-plus 的 $baseMessage / $baseConfirm
 */
export function setupAdminPlusCompat(app: App) {
  const $baseMessage = (
    message: string,
    type: 'error' | 'info' | 'success' | 'warning' = 'info',
    _customClass?: string,
    dangerouslyUseHTMLString = false,
  ) => {
    ElMessage({
      message: translateUiText(message),
      type,
      dangerouslyUseHTMLString,
    });
  };

  const $baseConfirm = (
    content: string,
    title: null | string,
    callback?: () => void,
    catchCallback?: () => void,
  ) => {
    ElMessageBox.confirm(
      translateUiText(content),
      translateUiText(title || '提示'),
      {
      confirmButtonText: translateUiText('确定'),
      cancelButtonText: translateUiText('取消'),
      type: 'warning',
      },
    )
      .then(() => {
        callback?.();
      })
      .catch(() => {
        catchCallback?.();
      });
  };

  app.provide('$baseMessage', $baseMessage);
  app.provide('$baseConfirm', $baseConfirm);
  app.config.globalProperties.$baseMessage = $baseMessage;
  app.config.globalProperties.$baseConfirm = $baseConfirm;
}
