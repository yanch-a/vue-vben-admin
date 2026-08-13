/**
 * Global authority directive
 * Used for fine-grained control of component permissions
 * @Example v-access:role="[ROLE_NAME]" or v-access:role="ROLE_NAME"
 * @Example v-access:code="[ROLE_CODE]" or v-access:code="ROLE_CODE"
 *
 * 不要用 el.remove()：会破坏 Vue vnode 与 DOM 映射，路由切换时易触发
 * Cannot read properties of null (reading 'parentNode')
 */
import type { App, Directive, DirectiveBinding } from 'vue';

import { useAccess } from './use-access';

function applyAccess(
  el: HTMLElement,
  binding: DirectiveBinding<string | string[]>,
) {
  const { accessMode, hasAccessByCodes, hasAccessByRoles } = useAccess();

  const value = binding.value;

  if (!value) return;
  const authMethod =
    accessMode.value === 'frontend' && binding.arg === 'role'
      ? hasAccessByRoles
      : hasAccessByCodes;

  const values = Array.isArray(value) ? value : [value];

  if (authMethod(values)) {
    el.style.removeProperty('display');
    el.removeAttribute('aria-hidden');
    return;
  }

  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}

const authDirective: Directive = {
  mounted(el, binding) {
    applyAccess(el as HTMLElement, binding);
  },
  updated(el, binding) {
    applyAccess(el as HTMLElement, binding);
  },
};

export function registerAccessDirective(app: App) {
  app.directive('access', authDirective);
}
