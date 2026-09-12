const { contextBridge, ipcRenderer } = require('electron');

/**
 * 服务端选择窗口的受限接口。所有输入仍会在主进程再次校验。
 *
 * @author yanch
 */
contextBridge.exposeInMainWorld(
  'lemonServerConfig',
  Object.freeze({
    close: () => ipcRenderer.send('lemon-server:close-selector'),
    connect: (server) => ipcRenderer.invoke('lemon-server:connect', server),
    list: () => ipcRenderer.invoke('lemon-server:list'),
    remove: (id) => ipcRenderer.invoke('lemon-server:remove', id),
    test: (url) => ipcRenderer.invoke('lemon-server:test', url),
  }),
);
