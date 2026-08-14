/**
 * 客户端会话 change 通知（独立小模块，避免与 tabs/persist 循环依赖）
 * @author yanch
 */
let notifyFn: (() => void) | null = null;

export function bindClientSessionChangeNotifier(fn: (() => void) | null) {
  notifyFn = fn;
}

export function notifyClientSessionChange() {
  notifyFn?.();
}
