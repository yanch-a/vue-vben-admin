import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';

import { ServerConfigStore } from './config-store.mjs';
import { buildProxyTarget, RENDERER_API_PREFIX } from './server-url.mjs';

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.resolve(electronDirectory, '..', 'dist');
const configPage = path.join(electronDirectory, 'config', 'index.html');
const isSmokeTest = process.env.LEMON_DESKTOP_SMOKE_TEST === 'true';
const isRendererSmokeTest =
  process.env.LEMON_DESKTOP_RENDERER_SMOKE_TEST === 'true';
const isAnySmokeTest = isSmokeTest || isRendererSmokeTest;

let configStore;
let activeServer = null;
let mainWindow = null;
let selectorWindow = null;
let selectorAccepted = false;

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
 */
async function proxyApiRequest(request) {
  if (!activeServer) {
    return Response.json(
      { code: 503, msg: '尚未选择服务端，请从“服务端”菜单重新配置' },
      { status: 503 },
    );
  }

  try {
    const target = buildProxyTarget(activeServer.url, request.url);
    const headers = new Headers(request.headers);
    // 目标站点应自行生成 Host/Content-Length；移除自定义协议来源，避免后端误判 CORS。
    for (const name of ['content-length', 'host', 'origin', 'referer']) {
      headers.delete(name);
    }
    const method = request.method.toUpperCase();
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.arrayBuffer();
    return await net.fetch(target, {
      body,
      headers,
      method,
      redirect: 'follow',
      signal: request.signal,
    });
  } catch (error) {
    console.error('[desktop] API 代理失败', error);
    return Response.json({ code: 502, msg: `无法连接服务端：${error.message}` }, { status: 502 });
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

/** 注册桌面端统一协议：静态资源本地读取，/lmdb 请求转发到当前服务端。 */
function registerApplicationProtocol() {
  protocol.handle('lemon', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') {
      return new Response('Not Found', { status: 404 });
    }
    return isApiPath(url.pathname) ? proxyApiRequest(request) : serveRenderer(url.pathname);
  });
}

/** 仅允许业务窗口在当前应用内导航；http(s) 新窗口交给系统默认浏览器。 */
function secureMainWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('lemon://app/lmdb') && activeServer) {
      void shell.openExternal(buildProxyTarget(activeServer.url, url));
      return { action: 'deny' };
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('lemon://app/')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });
}

/** 创建或重新加载主业务窗口。 */
async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL('lemon://app/index.html');
    mainWindow.show();
    return;
  }

  mainWindow = new BrowserWindow({
    autoHideMenuBar: false,
    backgroundColor: '#0f172a',
    height: 900,
    icon: path.join(rendererDirectory, 'logo.png'),
    minHeight: 640,
    minWidth: 980,
    show: false,
    title: 'Lemon DB Client',
    width: 1440,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(electronDirectory, 'preload-main.cjs'),
      sandbox: true,
    },
  });
  secureMainWindowNavigation(mainWindow);
  mainWindow.once('ready-to-show', () => {
    if (!isRendererSmokeTest) {
      mainWindow?.show();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL('lemon://app/index.html');
}

/**
 * 自动化验证自定义协议、预加载桥接和 Vue 挂载链路，不读取或写入用户配置。
 */
async function runRendererSmokeTest() {
  // 使用本机临时 HTTP 服务验证主进程 API 代理，避免依赖真实 Lemon 后台。
  const smokeServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 200, data: {} }));
  });
  await new Promise((resolve, reject) => {
    smokeServer.once('error', reject);
    smokeServer.listen(0, '127.0.0.1', resolve);
  });
  const address = smokeServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法创建桌面端冒烟测试服务');
  }
  activeServer = {
    id: 'desktop-smoke-server',
    name: '桌面冒烟测试',
    url: `http://127.0.0.1:${address.port}/lmdb`,
  };
  await createMainWindow();
  try {
    const ready = await mainWindow.webContents.executeJavaScript(`
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
    console.log(`[desktop-smoke] renderer mounted: ${ready}`);
    smokeServer.close();
    app.exit(ready ? 0 : 1);
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
          ? `连接成功（HTTP ${response.status}）`
          : `服务端返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message:
        error.name === 'AbortError' ? '连接超时，请检查地址和网络' : `连接失败：${error.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 用户确认服务端后关闭选择器，并以新的隔离命名空间加载业务窗口。 */
async function activateServer(server) {
  activeServer = server;
  selectorAccepted = true;
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.close();
  }
  await createMainWindow();
}

/** 每次启动或从菜单切换时显示服务端选择/编辑窗口。 */
async function showServerSelector() {
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.focus();
    return;
  }

  selectorAccepted = false;
  mainWindow?.hide();
  selectorWindow = new BrowserWindow({
    backgroundColor: '#f4f7fb',
    height: 640,
    maximizable: false,
    minimizable: false,
    parent: mainWindow ?? undefined,
    resizable: false,
    show: false,
    title: '选择 Lemon 服务端',
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      } else if (!isSmokeTest) {
        app.quit();
      }
    }
  });
  await currentSelector.loadFile(configPage);

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
  ipcMain.handle('lemon-server:get-active', () => activeServer);
  ipcMain.handle('lemon-server:set-authenticated', async (_event, authenticated) => {
    if (!activeServer) return;
    const updated = await configStore.setAuthenticated(
      activeServer.id,
      authenticated === true,
    );
    if (updated) activeServer = updated;
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
  const template = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' }]
      : [{ label: '文件', submenu: [{ role: 'quit', label: '退出' }] }]),
    {
      label: '服务端',
      submenu: [
        {
          accelerator: 'CmdOrCtrl+,',
          click: () => void showServerSelector(),
          label: '选择或配置服务端…',
        },
      ],
    },
    { role: 'viewMenu', label: '视图' },
    { role: 'windowMenu', label: '窗口' },
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
    configStore = new ServerConfigStore(path.join(app.getPath('userData'), 'server-config.json'));
    registerApplicationProtocol();
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
        activeServer = selectedServer;
        await createMainWindow();
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
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
