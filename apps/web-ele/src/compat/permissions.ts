import type { App, Directive, DirectiveBinding } from 'vue';

import { useAccess } from '@vben/access';

/**
 * 兼容 admin-plus: v-permissions="{ permission: ['UserManagement:add'] }"
 * 映射到 vben accessCodes
 *
 * 注意：不能 removeChild / el.remove()，否则路由切换时 Vue patch 会报
 * Cannot read properties of null (reading 'parentNode')，导致菜单无法再切换。
 */
function checkPermission(binding: DirectiveBinding) {
  const { hasAccessByCodes } = useAccess();
  const value = binding.value;
  let codes: string[] = [];
  if (Array.isArray(value)) {
    codes = value;
  } else if (value?.permission) {
    codes = Array.isArray(value.permission)
      ? value.permission
      : [value.permission];
  } else if (typeof value === 'string') {
    codes = [value];
  }
  if (!codes.length) return true;
  return hasAccessByCodes(codes);
}

function applyPermission(el: HTMLElement, binding: DirectiveBinding) {
  const ok = checkPermission(binding);
  if (ok) {
    el.style.removeProperty('display');
    el.removeAttribute('aria-hidden');
    el.removeAttribute('data-permission-denied');
    return;
  }
  // 仅隐藏，保留 vnode 与真实 DOM 的对应关系
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-permission-denied', '1');
}

const permissionsDirective: Directive = {
  mounted(el, binding) {
    applyPermission(el as HTMLElement, binding);
  },
  updated(el, binding) {
    applyPermission(el as HTMLElement, binding);
  },
};

export function registerPermissionsDirective(app: App) {
  app.directive('permissions', permissionsDirective);
}
