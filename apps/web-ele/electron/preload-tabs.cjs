const { contextBridge, ipcRenderer } = require('electron');

/**
 * 服务端标签栏的受限接口。
 * 只允许切换、关闭、折叠和新增已由主进程管理的服务端标签，不开放 Node.js 或任意 IPC。
 *
 * @author yanch
 */
contextBridge.exposeInMainWorld(
  'lemonServerTabs',
  Object.freeze({
    activate: (id) => ipcRenderer.invoke('lemon-tabs:activate', id),
    add: () => ipcRenderer.invoke('lemon-tabs:add'),
    close: (id) => ipcRenderer.invoke('lemon-tabs:close', id),
    list: () => ipcRenderer.invoke('lemon-tabs:list'),
    setCollapsed: (collapsed) =>
      ipcRenderer.invoke('lemon-tabs:set-collapsed', collapsed === true),
    /** 订阅标签列表变化，返回取消订阅函数。 */
    onChanged: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on('lemon-tabs:changed', handler);
      return () => ipcRenderer.removeListener('lemon-tabs:changed', handler);
    },
    /** 订阅壳层亮/暗主题变化（跟随系统 nativeTheme）。 */
    onThemeChanged: (listener) => {
      const handler = (_event, theme) => listener(theme);
      ipcRenderer.on('lemon-shell:theme', handler);
      return () => ipcRenderer.removeListener('lemon-shell:theme', handler);
    },
  }),
);
