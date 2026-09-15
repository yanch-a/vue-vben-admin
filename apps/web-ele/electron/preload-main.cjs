const { contextBridge, ipcRenderer } = require('electron');

/**
 * 业务窗口只暴露读取当前服务端和打开选择器两个安全能力，
 * 不向 Vue 页面开放 Node.js、文件系统或任意 IPC。
 *
 * 会话导入/导出仅转发主进程菜单事件，实际读写仍由渲染进程通过
 * localStorage（按服务端隔离）与浏览器文件选择器完成。
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
    /** 订阅原生菜单「导出临时查询记录」 */
    onExportTemporarySession: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('lemon-session:export', handler);
      return () => ipcRenderer.removeListener('lemon-session:export', handler);
    },
    /** 订阅原生菜单「导入临时查询记录」 */
    onImportTemporarySession: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('lemon-session:import', handler);
      return () => ipcRenderer.removeListener('lemon-session:import', handler);
    },
  }),
);
