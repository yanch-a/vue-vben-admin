const { contextBridge, ipcRenderer } = require('electron');

/**
 * 业务窗口只暴露读取当前服务端和打开选择器两个安全能力，
 * 不向 Vue 页面开放 Node.js、文件系统或任意 IPC。
 *
 * @author yanch
 */
contextBridge.exposeInMainWorld(
  'lemonDesktop',
  Object.freeze({
    isDesktop: true,
    getActiveServer: () => ipcRenderer.invoke('lemon-server:get-active'),
    openServerSelector: () => ipcRenderer.invoke('lemon-server:open-selector'),
    setAuthenticated: (authenticated) =>
      ipcRenderer.invoke('lemon-server:set-authenticated', authenticated),
    setLocale: (locale) => ipcRenderer.invoke('lemon-i18n:set-locale', locale),
  }),
);
