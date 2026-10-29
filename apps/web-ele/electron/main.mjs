import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  app,
  BaseWindow,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  WebContentsView,
} from 'electron';

import { ServerConfigStore } from './config-store.mjs';
import { RENDERER_API_PREFIX } from './server-url.mjs';
import { createStreamingFetch, forwardApiRequest } from './api-proxy.mjs';

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.resolve(electronDirectory, '..', 'dist');
const configPage = path.join(electronDirectory, 'config', 'index.html');
const tabPage = path.join(electronDirectory, 'tabs', 'index.html');
const isSmokeTest = process.env.LEMON_DESKTOP_SMOKE_TEST === 'true';
const isRendererSmokeTest =
  process.env.LEMON_DESKTOP_RENDERER_SMOKE_TEST === 'true';
const isAnySmokeTest = isSmokeTest || isRendererSmokeTest;
/** 显式使用 Chromium 的分块网络请求，不能由 net.fetch 再缓存整个上传体。 */
const streamingApiFetch = createStreamingFetch((options) => net.request(options));
/** 标签栏高度，需与 tabs/style.css 中的 40px 保持一致。 */
const TAB_BAR_HEIGHT = 40;
/** 折叠后的纤细高度，需与 tabs/style.css 中的 24px 保持一致。 */
const TAB_BAR_COLLAPSED_HEIGHT = 24;

let configStore;
/** 同一窗口内同时在线的服务端。键是服务端配置 ID。 */
const serverTabs = new Map();
/** 协议代理读取的最新服务端记录，URL 或登录标记变化后立即生效。 */
const serversById = new Map();
/** 已经注册过 lemon:// 的会话分区，避免重复注册导致抛错。 */
const registeredPartitions = new Set();
let activeTabId = null;
/** 服务端标签栏是否折叠；默认展开，偏好持久化在 server-config.json。 */
let tabBarCollapsed = false;
/** @type {import('electron').BaseWindow | null} */
let mainWindow = null;
/** @type {import('electron').WebContentsView | null} */
let tabBarView = null;
let selectorWindow = null;
let selectorAccepted = false;
let desktopLocale = 'zh-CN';

/** 将 Vue、Electron 或操作系统语言统一为桌面端支持的语言标识。 */
function normalizeDesktopLocale(locale) {
  return String(locale ?? '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

/** 返回当前桌面语言对应的主进程文案。 */
function desktopText(chinese, english) {
  return desktopLocale === 'en-US' ? english : chinese;
}

/** 常用静态资源类型，确保自定义协议下脚本、样式和字体被正确识别。 */
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

// 必须在 app ready 前注册，lemon:// 才能作为标准、安全且支持 fetch 的来源。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lemon',
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

/** 判断请求是否属于 Vue 应用约定的虚拟 API 前缀。 */
function isApiPath(pathname) {
  return pathname === RENDERER_API_PREFIX || pathname.startsWith(`${RENDERER_API_PREFIX}/`);
}

/**
 * 由 Electron 主进程转发 API，桌面客户端无需关闭 webSecurity，
 * 也不要求每个被连接的 Lemon 服务端额外开放 CORS。
 * 每个服务端标签使用自己的会话，因此这里必须转发到发起请求的那个服务端。
 */
async function proxyApiRequest(request, server) {
  if (!server) {
    return Response.json(
      {
        code: 503,
        msg: desktopText(
          '尚未选择服务端，请从“服务端”菜单重新配置',
          'No server is selected. Reconfigure it from the Server menu.',
        ),
      },
      { status: 503 },
    );
  }

  try {
    return await forwardApiRequest(request, server.url, streamingApiFetch);
  } catch (error) {
    console.error('[desktop] API 代理失败', error);
    return Response.json(
      {
        code: 502,
        msg: desktopText(
          `无法连接服务端：${error.message}`,
          `Unable to connect to the server: ${error.message}`,
        ),
      },
      { status: 502 },
    );
  }
}

/** 安全解析静态资源路径，禁止通过 ../ 读取安装目录以外的文件。 */
async function resolveRendererFile(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!relativePath || relativePath.endsWith('/')) {
    relativePath += 'index.html';
  }

  const candidate = path.resolve(rendererDirectory, relativePath);
  const allowedPrefix = `${rendererDirectory}${path.sep}`;
  if (candidate !== rendererDirectory && !candidate.startsWith(allowedPrefix)) {
    return null;
  }

  try {
    if ((await stat(candidate)).isFile()) {
      return candidate;
    }
  } catch {
    // Vue History 路由访问不存在的磁盘路径时回退到入口页面。
  }
  return path.join(rendererDirectory, 'index.html');
}

/** 返回打包后的 Vue 静态资源。 */
async function serveRenderer(pathname) {
  const file = await resolveRendererFile(pathname);
  if (!file) {
    return new Response('Not Found', { status: 404 });
  }
  try {
    const content = await readFile(file);
    const contentType = MIME_TYPES.get(path.extname(file).toLowerCase());
    return new Response(content, {
      headers: contentType ? { 'Content-Type': contentType } : undefined,
      status: 200,
    });
  } catch (error) {
    console.error('[desktop] 静态资源读取失败', error);
    return new Response('Application resource not found', { status: 404 });
  }
}

/**
 * 把服务端 ID 变成稳定的会话分区名。
 * 不同分区拥有独立的 Cookie 和 localStorage，因此多个服务端可以同时保持登录。
 */
function partitionForServer(id) {
  const safe = String(id).replaceAll(/[^a-zA-Z0-9_-]/g, '');
  return `persist:lemon-${safe || 'server'}`;
}

/**
 * 在该服务端自己的会话上注册 lemon://。
 * 静态资源仍读本地包，/lmdb 只转发到这个分区对应的服务端。
 */
function registerPartitionProtocol(serverId) {
  const partition = partitionForServer(serverId);
  if (registeredPartitions.has(partition)) {
    return partition;
  }
  const serverSession = session.fromPartition(partition);
  serverSession.protocol.handle('lemon', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') {
      return new Response('Not Found', { status: 404 });
    }
    return isApiPath(url.pathname)
      ? proxyApiRequest(request, serversById.get(serverId) ?? null)
      : serveRenderer(url.pathname);
  });
  registeredPartitions.add(partition);
  return partition;
}

/** 仅允许业务页在当前应用内导航；http(s) 新窗口交给系统默认浏览器。 */
function secureServerView(webContents, serverId) {
  webContents.setWindowOpenHandler(({ url }) => {
    const server = serversById.get(serverId);
    if (url.startsWith('lemon://app/lmdb') && server) {
      void shell.openExternal(buildProxyTarget(server.url, url));
      return { action: 'deny' };
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('lemon://app/')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });
}

/** 放大或缩小当前服务端页面，不影响标签栏和其他服务端。 */
function adjustActiveZoom(delta) {
  const contents = activeServerWebContents();
  if (!contents) {
    return;
  }
  contents.setZoomLevel(contents.getZoomLevel() + delta);
}

/** 当前正在查看的服务端页面；菜单动作只作用于这个标签。 */
function activeServerWebContents() {
  const tab = serverTabs.get(activeTabId);
  if (!tab || tab.view.webContents.isDestroyed()) {
    return null;
  }
  return tab.view.webContents;
}

/** 按发起 IPC 的页面找到它所属的服务端，避免标签之间读到彼此的地址。 */
function serverTabByWebContents(webContents) {
  for (const tab of serverTabs.values()) {
    if (tab.view.webContents.id === webContents.id) {
      return tab;
    }
  }
  return null;
}

/** 标签栏和主进程共用的标签快照。 */
function tabsPayload() {
  return {
    activeId: activeTabId,
    collapsed: tabBarCollapsed,
    locale: desktopLocale,
    theme: shellTheme(),
    tabs: [...serverTabs.values()].map((tab) => ({
      id: tab.server.id,
      name: tab.server.name,
      url: tab.server.url,
    })),
  };
}

/** 当前标签栏占用的客户区高度。 */
function currentTabBarHeight() {
  return tabBarCollapsed ? TAB_BAR_COLLAPSED_HEIGHT : TAB_BAR_HEIGHT;
}

/** 壳层（菜单栏/标签栏/选择器）跟随系统亮暗。 */
function shellTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 主窗口客户区底色，与标签栏主题一致。 */
function shellBackgroundColor() {
  return shellTheme() === 'dark' ? '#0f172a' : '#e8eef6';
}

/** 服务端选择器窗口底色。 */
function selectorBackgroundColor() {
  return shellTheme() === 'dark' ? '#0f172a' : '#f4f7fb';
}

/** 把系统主题同步到窗口底色与标签栏；系统切换时由 nativeTheme.updated 触发。 */
function applyShellTheme() {
  const theme = shellTheme();
  const mainBg = shellBackgroundColor();
  const selectorBg = selectorBackgroundColor();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(mainBg);
  }
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.setBackgroundColor(selectorBg);
  }
  if (tabBarView && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('lemon-shell:theme', theme);
  }
  broadcastTabs();
}

/** 在已打开的服务端标签间循环切换。 */
async function cycleServerTab(delta) {
  const ids = [...serverTabs.keys()];
  if (ids.length === 0) {
    return;
  }
  const current = Math.max(0, ids.indexOf(activeTabId));
  const next = ids[(current + delta + ids.length) % ids.length];
  if (next === activeTabId) {
    return;
  }
  activeTabId = next;
  revealActiveTab();
  broadcastTabs();
  await rememberSelectedServer(next);
}

/** 按序号（1 起）激活服务端标签。 */
async function activateServerTabAt(index) {
  const ids = [...serverTabs.keys()];
  const id = ids[index];
  if (!id) {
    return;
  }
  activeTabId = id;
  revealActiveTab();
  broadcastTabs();
  await rememberSelectedServer(id);
}

/** 关闭当前服务端标签（Ctrl+F4）；Ctrl+W 留给业务页内查询页签。 */
async function closeActiveServerTab() {
  if (!activeTabId) {
    return;
  }
  await closeServerTab(activeTabId);
}

/**
 * 在 WebContents 上拦截壳层快捷键，避免业务页抢占 Ctrl+Tab / Ctrl+F4。
 * Ctrl+W 不拦截，留给查询编辑器关页签。
 */
function attachShellShortcuts(webContents) {
  if (!webContents || webContents.isDestroyed() || webContents.__lemonShellShortcuts) {
    return;
  }
  webContents.__lemonShellShortcuts = true;
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }
    const key = String(input.key || '');
    const ctrl = input.control || input.meta;
    if (!ctrl) {
      return;
    }
    // Ctrl+Tab / Ctrl+Shift+Tab
    if (key === 'Tab') {
      event.preventDefault();
      void cycleServerTab(input.shift ? -1 : 1);
      return;
    }
    // Ctrl+F4 关闭当前服务端
    if (key === 'F4' && !input.alt && !input.shift) {
      event.preventDefault();
      void closeActiveServerTab();
      return;
    }
    // Ctrl+1..9
    if (/^[1-9]$/.test(key) && !input.alt && !input.shift) {
      event.preventDefault();
      void activateServerTabAt(Number(key) - 1);
    }
  });
}


/**
 * 折叠或展开服务端标签栏，并写回本机偏好。
 * 折叠后仍保留一条纤细条，便于一键恢复。
 */
async function setTabBarCollapsed(collapsed) {
  tabBarCollapsed = collapsed === true;
  layoutServerViews();
  const payload = broadcastTabs();
  installApplicationMenu();
  try {
    await configStore?.setTabBarCollapsed(tabBarCollapsed);
  } catch (error) {
    console.warn('[desktop] 保存标签栏折叠偏好失败', error);
  }
  return payload;
}

/** 通知标签栏刷新。页面尚未加载完成时，标签栏会在启动后再拉取一次。 */
function broadcastTabs() {
  const payload = tabsPayload();
  if (tabBarView && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('lemon-tabs:changed', payload);
  }
  return payload;
}

/** 按窗口客户区摆放标签栏和全部服务端页面，隐藏的标签继续保留连接。 */
function layoutServerViews() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  let [width, height] = mainWindow.getContentSize();
  // 窗口尚未显示时客户区可能暂时为 0，先用设计尺寸把页面铺开，避免后台标签无法完成加载。
  if (width <= 0 || height <= 0) {
    width = 1440;
    height = 860;
  }
  const barHeight = currentTabBarHeight();
  tabBarView?.setBounds({ x: 0, y: 0, width, height: barHeight });
  const contentBounds = {
    height: Math.max(0, height - barHeight),
    width,
    x: 0,
    y: barHeight,
  };
  for (const [id, tab] of serverTabs) {
    tab.view.setBounds(contentBounds);
    const visible = id === activeTabId;
    tab.view.setVisible(visible);
    if (visible) {
      mainWindow.contentView.addChildView(tab.view);
    }
  }
}

/** 显示当前标签，并让窗口标题跟随该服务端名称。 */
function revealActiveTab() {
  const tab = serverTabs.get(activeTabId);
  layoutServerViews();
  if (!tab || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setTitle(
    tab.server.name ? `${tab.server.name} — Lemon DB Client` : 'Lemon DB Client',
  );
  if (!isRendererSmokeTest) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
  if (!isAnySmokeTest && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.focus();
  }
}

/** 记住上次查看的服务端，下次启动时优先打开它。 */
async function rememberSelectedServer(id) {
  try {
    await configStore?.select(id);
  } catch (error) {
    console.warn('[desktop] 记录当前服务端失败', error);
  }
}

/** 创建带标签栏的主窗口。业务页面随后作为子视图加入，而不是替换整个窗口。 */
async function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  mainWindow = new BaseWindow({
    autoHideMenuBar: false,
    backgroundColor: shellBackgroundColor(),
    height: 900,
    icon: path.join(rendererDirectory, 'logo.png'),
    minHeight: 640,
    minWidth: 980,
    show: false,
    title: 'Lemon DB Client',
    width: 1440,
  });
  tabBarView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(electronDirectory, 'preload-tabs.cjs'),
      sandbox: true,
    },
  });
  mainWindow.contentView.addChildView(tabBarView);
  tabBarView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tabBarView.webContents.on('will-navigate', (event, url) => {
    // 首次 loadFile 使用 file://，之后禁止标签栏离开本地页面。
    if (!url.startsWith('file:')) {
      event.preventDefault();
    }
  });
  try {
    tabBarView.webContents.setVisualZoomLevelLimits(1, 1);
  } catch (error) {
    console.warn('[desktop] 标签栏缩放限制未生效', error);
  }
  for (const eventName of [
    'resize',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    mainWindow.on(eventName, () => layoutServerViews());
  }
  mainWindow.on('closed', () => {
    // BaseWindow 不拥有子视图的渲染进程；关闭所有标签和标签栏，避免关窗后保留后台页面。@author yanch
    const views = [tabBarView, ...[...serverTabs.values()].map((tab) => tab.view)];
    mainWindow = null;
    tabBarView = null;
    serverTabs.clear();
    serversById.clear();
    activeTabId = null;
    for (const view of views) {
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
    }
  });
  layoutServerViews();
  attachShellShortcuts(tabBarView.webContents);
  await tabBarView.webContents.loadFile(tabPage);
  applyShellTheme();
  if (!isRendererSmokeTest) {
    mainWindow.show();
  }
  layoutServerViews();
}

/**
 * 在当前窗口打开一个服务端标签。
 * 同一配置已打开时只切换过去；地址没变则不重新加载，避免丢掉正在编辑的内容。
 */
async function openServerTab(server) {
  await ensureMainWindow();
  serversById.set(server.id, server);
  const existing = serverTabs.get(server.id);
  if (existing) {
    const urlChanged = existing.server.url !== server.url;
    existing.server = server;
    activeTabId = server.id;
    revealActiveTab();
    if (urlChanged && !existing.view.webContents.isDestroyed()) {
      try {
        await existing.view.webContents.loadURL('lemon://app/index.html');
      } catch (error) {
        console.error('[desktop] 服务端页面加载失败', error);
      }
    }
    broadcastTabs();
    void rememberSelectedServer(server.id);
    return;
  }

  const partition = registerPartitionProtocol(server.id);
  const view = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition,
      preload: path.join(electronDirectory, 'preload-main.cjs'),
      sandbox: true,
    },
  });
  secureServerView(view.webContents, server.id);
  attachShellShortcuts(view.webContents);
  serverTabs.set(server.id, { server, view });
  mainWindow.contentView.addChildView(view);
  activeTabId = server.id;
  revealActiveTab();
  broadcastTabs();
  try {
    await view.webContents.loadURL('lemon://app/index.html');
  } catch (error) {
    console.error('[desktop] 服务端页面加载失败', error);
  }
  void rememberSelectedServer(server.id);
}

/** 关闭一个服务端标签。最后一个标签关闭后回到服务端选择窗口。 */
async function closeServerTab(id) {
  const tab = serverTabs.get(id);
  if (!tab || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  serverTabs.delete(id);
  serversById.delete(id);
  mainWindow.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) {
    tab.view.webContents.close();
  }
  if (activeTabId === id) {
    const remaining = [...serverTabs.keys()];
    activeTabId = remaining.at(-1) ?? null;
  }
  if (activeTabId) {
    revealActiveTab();
  } else {
    mainWindow.setTitle('Lemon DB Client');
    layoutServerViews();
  }
  broadcastTabs();
  if (serverTabs.size === 0) {
    mainWindow.hide();
    await showServerSelector();
  }
}

/**
 * 自动化验证自定义协议、预加载桥接和 Vue 挂载链路，不读取或写入用户配置。
 */
async function runRendererSmokeTest() {
  // 使用本机临时 HTTP 服务验证主进程 API 代理，避免依赖真实 Lemon 后台。
  const smokeServer = createServer((request, response) => {
    const reply = (data) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      response.end(gzipSync(JSON.stringify({ code: 200, data })));
    };
    if (request.url === '/lmdb/stream-fixture') {
      let bytes = 0; request.on('data', (chunk) => { bytes += chunk.length; });
      request.on('end', () => reply({ bytes }));
    } else reply({});
  });
  await new Promise((resolve, reject) => {
    smokeServer.once('error', reject);
    smokeServer.listen(0, '127.0.0.1', resolve);
  });
  const address = smokeServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法创建桌面端冒烟测试服务');
  }
  const smokeServerConfig = {
    id: 'desktop-smoke-server',
    name: '桌面冒烟测试',
    url: `http://127.0.0.1:${address.port}/lmdb`,
  };
  await openServerTab(smokeServerConfig);
  try {
    const ready = await activeServerWebContents().executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + 15000;
        const inspect = () => {
          const appRoot = document.querySelector('#app');
          if (window.lemonDesktop && appRoot?.childElementCount > 0) {
            resolve(true);
          } else if (Date.now() >= deadline) {
            resolve(false);
          } else {
            setTimeout(inspect, 100);
          }
        };
        inspect();
      })
    `);
    const tabsReady = await tabBarView.webContents.executeJavaScript(
      `Boolean(document.querySelector('#add-server') && window.lemonServerTabs)`,
    );
    // 验证 renderer -> 自定义协议 -> 分块网络请求，以及 gzip 响应不会被重复解压。
    const proxyReady = await activeServerWebContents().executeJavaScript(`
      (async () => {
        const response = await fetch('/lmdb/stream-fixture', { method: 'POST', body: new Uint8Array(131072) });
        return (await response.json()).data.bytes === 131072;
      })()
    `);
    // 再打开一个服务端，确认第一个标签的页面没有被销毁。
    const secondServer = {
      id: 'desktop-smoke-server-b',
      name: '第二个冒烟服务端',
      url: smokeServerConfig.url,
    };
    await openServerTab(secondServer);
    const firstContents = serverTabs.get(smokeServerConfig.id)?.view.webContents;
    const firstStillMounted = firstContents
      ? await firstContents.executeJavaScript(`
          (async () => {
            const server = await window.lemonDesktop.getActiveServer();
            return Boolean(
              server?.id === 'desktop-smoke-server' &&
              document.querySelector('#app')?.childElementCount > 0
            );
          })()
        `)
      : false;
    const secondMounted = await activeServerWebContents().executeJavaScript(`
      (async () => {
        const server = await window.lemonDesktop.getActiveServer();
        return Boolean(
          server?.id === 'desktop-smoke-server-b' &&
          document.querySelector('#app')?.childElementCount > 0
        );
      })()
    `);
    const multiTabReady =
      serverTabs.size === 2 &&
      activeTabId === secondServer.id &&
      firstStillMounted &&
      secondMounted;
    console.log(
      `[desktop-smoke] renderer mounted: ${ready}; tabs: ${tabsReady}; multi: ${multiTabReady}; stream/gzip: ${proxyReady}`,
    );
      // 验证真实关窗会销毁全部渲染进程；成功路径按正常退出流程释放资源。@author yanch
      const contents = [tabBarView.webContents, ...[...serverTabs.values()].map((tab) => tab.view.webContents)];
      const destroyed = contents.map((content) => new Promise((resolve, reject) => {
        if (content.isDestroyed()) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('关闭主窗口后子视图未销毁')), 5000);
        content.once('destroyed', () => { clearTimeout(timer); resolve(); });
      }));
      mainWindow.close();
      await Promise.all(destroyed);
      console.log(`[desktop-smoke] closed views destroyed: ${contents.every((content) => content.isDestroyed())}`);
    smokeServer.close();
      if (ready && tabsReady && multiTabReady && proxyReady) app.quit();
      else app.exit(1);
  } catch (error) {
    console.error('[desktop-smoke] renderer failed', error);
    smokeServer.close();
    app.exit(1);
  }
}

/** 检测已标准化地址是否能返回 Lemon 的公开品牌配置接口。 */
async function testServerConnection(rawUrl) {
  const serverUrl = (await import('./server-url.mjs')).normalizeServerUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await net.fetch(`${serverUrl}/system/systemSetting/brandConfig`, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      ok: response.status < 500,
      status: response.status,
      message:
        response.status < 500
          ? desktopText(
              `连接成功（HTTP ${response.status}）`,
              `Connected successfully (HTTP ${response.status})`,
            )
          : desktopText(
              `服务端返回 HTTP ${response.status}`,
              `The server returned HTTP ${response.status}`,
            ),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message:
        error.name === 'AbortError'
          ? desktopText(
              '连接超时，请检查地址和网络',
              'Connection timed out. Check the address and network.',
            )
          : desktopText(
              `连接失败：${error.message}`,
              `Connection failed: ${error.message}`,
            ),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 用户确认服务端后关闭选择器，并在当前窗口增加或切到对应标签。 */
async function activateServer(server) {
  selectorAccepted = true;
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.close();
  }
  await openServerTab(server);
}

/** 每次启动或从菜单切换时显示服务端选择/编辑窗口。 */
async function showServerSelector() {
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.focus();
    return;
  }

  selectorAccepted = false;
  // 已经有在线服务端时，选择器只是再加一个连接，不能把现有窗口藏起来。
  if (serverTabs.size === 0) {
    mainWindow?.hide();
  }
  selectorWindow = new BrowserWindow({
    backgroundColor: selectorBackgroundColor(),
    height: 640,
    maximizable: false,
    minimizable: false,
    // 没有在线标签时主窗口会被隐藏；这时不能把选择器设成它的子窗口，否则选择器会一起被隐藏。
    parent: serverTabs.size > 0 ? mainWindow ?? undefined : undefined,
    resizable: false,
    show: false,
    title: desktopText('选择 Lemon 服务端', 'Select Lemon Server'),
    useContentSize: true,
    width: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(electronDirectory, 'preload-config.cjs'),
      sandbox: true,
    },
  });
  const currentSelector = selectorWindow;
  currentSelector.once('ready-to-show', () => {
    if (!isSmokeTest) {
      currentSelector.show();
    }
  });
  currentSelector.on('closed', () => {
    if (selectorWindow === currentSelector) {
      selectorWindow = null;
    }
    if (!selectorAccepted) {
      if (serverTabs.size > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      } else if (!isSmokeTest) {
        app.quit();
      }
    }
  });
  await currentSelector.loadFile(configPage, {
    query: { locale: desktopLocale },
  });

  // 自动化冒烟测试只验证页面和预加载桥接成功，不写入用户配置。
  if (isSmokeTest) {
    try {
      const result = await currentSelector.webContents.executeJavaScript(
        `({
          ready: Boolean(document.querySelector('#server-form') && window.lemonServerConfig),
          fits: document.documentElement.scrollHeight <= window.innerHeight,
          innerHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
        })`,
      );
      console.log(`[desktop-smoke] server selector: ${JSON.stringify(result)}`);
      app.exit(result.ready && result.fits ? 0 : 1);
    } catch (error) {
      console.error('[desktop-smoke] failed', error);
      app.exit(1);
    }
  }
}

/** 注册选择器与业务窗口需要的受限 IPC。 */
function registerIpcHandlers() {
  ipcMain.handle('lemon-server:list', () => configStore.read());
  ipcMain.handle('lemon-server:get-active', (event) => {
    return serverTabByWebContents(event.sender)?.server ?? null;
  });
  ipcMain.handle('lemon-server:set-authenticated', async (event, authenticated) => {
    const tab = serverTabByWebContents(event.sender);
    if (!tab) return;
    const updated = await configStore.setAuthenticated(
      tab.server.id,
      authenticated === true,
    );
    if (!updated) return;
    tab.server = updated;
    serversById.set(updated.id, updated);
  });
  ipcMain.handle('lemon-tabs:list', () => tabsPayload());
  ipcMain.handle('lemon-tabs:activate', async (_event, id) => {
    const tabId = String(id ?? '');
    if (!serverTabs.has(tabId)) {
      return tabsPayload();
    }
    activeTabId = tabId;
    revealActiveTab();
    broadcastTabs();
    await rememberSelectedServer(tabId);
    return tabsPayload();
  });
  ipcMain.handle('lemon-tabs:close', async (_event, id) => {
    await closeServerTab(String(id ?? ''));
    return tabsPayload();
  });
  ipcMain.handle('lemon-tabs:add', async () => {
    await showServerSelector();
  });
  ipcMain.handle('lemon-tabs:set-collapsed', async (_event, collapsed) => {
    return setTabBarCollapsed(collapsed === true);
  });
  ipcMain.handle('lemon-i18n:set-locale', (_event, locale) => {
    desktopLocale = normalizeDesktopLocale(locale);
    installApplicationMenu();
    broadcastTabs();
  });
  ipcMain.handle('lemon-server:test', (_event, url) => testServerConnection(url));
  ipcMain.handle('lemon-server:remove', (_event, id) => configStore.remove(String(id ?? '')));
  ipcMain.handle('lemon-server:connect', async (_event, input) => {
    const server = await configStore.upsert(input);
    // 先让 invoke 的结果返回页面，再销毁发起 IPC 的窗口。
    setTimeout(() => void activateServer(server), 0);
    return { ok: true, server };
  });
  ipcMain.handle('lemon-server:open-selector', async () => {
    await showServerSelector();
  });
  ipcMain.on('lemon-server:close-selector', () => selectorWindow?.close());
}

/** 构建跨平台应用菜单，为运行中的客户端保留服务端切换入口。 */
function installApplicationMenu() {
  const fileSubmenu = [
    {
      label: desktopText('导出临时查询记录', 'Export Temporary Queries'),
      click: () => {
        activeServerWebContents()?.send('lemon-session:export');
      },
    },
    {
      label: desktopText('导入临时查询记录', 'Import Temporary Queries'),
      click: () => {
        activeServerWebContents()?.send('lemon-session:import');
      },
    },
  ];
  if (process.platform !== 'darwin') {
    fileSubmenu.push({ type: 'separator' });
    fileSubmenu.push({
      role: 'quit',
      label: desktopText('退出', 'Quit'),
    });
  }

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: desktopText('文件', 'File'),
      submenu: fileSubmenu,
    },
    {
      label: desktopText('服务端', 'Server'),
      submenu: [
        {
          accelerator: 'CmdOrCtrl+,',
          click: () => void showServerSelector(),
          label: desktopText('连接服务端…', 'Connect Server…'),
        },
        {
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => void setTabBarCollapsed(!tabBarCollapsed),
          label: tabBarCollapsed
            ? desktopText('显示服务端栏', 'Show Server Bar')
            : desktopText('隐藏服务端栏', 'Hide Server Bar'),
        },
        { type: 'separator' },
        {
          accelerator: 'Ctrl+Tab',
          click: () => void cycleServerTab(1),
          label: desktopText('下一个服务端', 'Next Server'),
        },
        {
          accelerator: 'Ctrl+Shift+Tab',
          click: () => void cycleServerTab(-1),
          label: desktopText('上一个服务端', 'Previous Server'),
        },
        {
          // Ctrl+W 留给业务页查询编辑器关页签；此处用 Ctrl+F4（Windows 关文档惯例）
          accelerator: 'Ctrl+F4',
          click: () => void closeActiveServerTab(),
          label: desktopText('关闭当前服务端', 'Close Current Server'),
        },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          accelerator: `CmdOrCtrl+${n}`,
          click: () => void activateServerTabAt(n - 1),
          label: desktopText(`切换到服务端 ${n}`, `Switch to Server ${n}`),
          visible: false,
        })),
      ],
    },
    {
      label: desktopText('视图', 'View'),
      submenu: [
        {
          accelerator: 'CmdOrCtrl+R',
          click: () => activeServerWebContents()?.reload(),
          label: desktopText('重新加载', 'Reload'),
        },
        {
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => activeServerWebContents()?.reloadIgnoringCache(),
          label: desktopText('强制重新加载', 'Force Reload'),
        },
        { type: 'separator' },
        {
          accelerator: 'CmdOrCtrl+Plus',
          click: () => adjustActiveZoom(0.5),
          label: desktopText('放大', 'Zoom In'),
        },
        {
          accelerator: 'CmdOrCtrl+-',
          click: () => adjustActiveZoom(-0.5),
          label: desktopText('缩小', 'Zoom Out'),
        },
        {
          accelerator: 'CmdOrCtrl+0',
          click: () => activeServerWebContents()?.setZoomLevel(0),
          label: desktopText('实际大小', 'Actual Size'),
        },
        { type: 'separator' },
        {
          accelerator: 'F12',
          click: () => activeServerWebContents()?.toggleDevTools(),
          label: desktopText('开发者工具', 'Toggle Developer Tools'),
        },
        { type: 'separator' },
        {
          role: 'togglefullscreen',
          label: desktopText('切换全屏', 'Toggle Full Screen'),
        },
      ],
    },
    // 自定义窗口菜单：不把 Cmd/Ctrl+W 绑到关窗口，留给查询编辑器关页签
    {
      label: desktopText('窗口', 'Window'),
      submenu: [
        { role: 'minimize', label: desktopText('最小化', 'Minimize') },
        { role: 'zoom', label: desktopText('缩放', 'Zoom') },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? [{ role: 'front', label: desktopText('前置全部窗口', 'Bring All to Front') }]
          : []),
        {
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.close();
            }
          },
          label: desktopText('关闭窗口', 'Close Window'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 冒烟测试使用独立 userData，避免干扰用户正在运行或已经登录的正式客户端。
if (isAnySmokeTest) {
  app.setPath(
    'userData',
    path.join(app.getPath('temp'), `lemon-desktop-smoke-${process.pid}`),
  );
}
const hasSingleInstanceLock =
  isAnySmokeTest || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = selectorWindow ?? mainWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    desktopLocale = normalizeDesktopLocale(app.getLocale());
    // 菜单栏与壳层 UI 跟随操作系统亮/暗主题
    nativeTheme.themeSource = 'system';
    nativeTheme.on('updated', () => {
      applyShellTheme();
      installApplicationMenu();
    });
    configStore = new ServerConfigStore(path.join(app.getPath('userData'), 'server-config.json'));
    tabBarCollapsed = (await configStore.read()).tabBarCollapsed === true;
    registerIpcHandlers();
    installApplicationMenu();
    if (isRendererSmokeTest) {
      await runRendererSmokeTest();
    } else if (isSmokeTest) {
      await showServerSelector();
    } else {
      // 上次选中的服务端仍处于登录状态时直接进入主程序；否则先选择地址。
      const config = await configStore.read();
      const selectedServer = config.servers.find(
        (server) =>
          server.id === config.selectedServerId && server.authenticated,
      );
      if (selectedServer) {
        await openServerTab(selectedServer);
      } else {
        await showServerSelector();
      }
    }
  });

  app.on('activate', () => {
    if (!mainWindow && !selectorWindow) {
      void showServerSelector();
    }
  });

  app.on('window-all-closed', () => {
    // 冒烟在关窗后还需检查销毁事件，由测试明确结束进程。
    if (process.platform !== 'darwin' && !isAnySmokeTest) {
      app.quit();
    }
  });
}
