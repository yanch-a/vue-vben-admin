const bridge = window.lemonServerConfig;
const form = document.querySelector('#server-form');
const savedServer = document.querySelector('#saved-server');
const serverName = document.querySelector('#server-name');
const serverUrl = document.querySelector('#server-url');
const deleteButton = document.querySelector('#delete-server');
const testButton = document.querySelector('#test-server');
const closeButton = document.querySelector('#close-window');
const connectButton = document.querySelector('#connect-server');
const status = document.querySelector('#status');

const NEW_SERVER_VALUE = '__new_server__';
const locale = new URLSearchParams(window.location.search).get('locale') === 'en-US'
  ? 'en-US'
  : 'zh-CN';
const chineseMessages = {
  'bridge-error': '客户端安全桥接初始化失败，请重新启动应用',
  cancel: '取消',
  'config-name': '配置名称',
  'delete-confirm': '确定删除“{name}”吗？',
  'delete-failed': '删除配置失败',
  'delete-success': '配置已删除',
  delete: '删除',
  'local-server': '本地服务',
  'name-placeholder': '例如：生产环境',
  'new-server': '+ 配置新的服务端',
  'page-title': '选择 Lemon 服务端',
  'read-failed': '读取本机配置失败',
  heading: '选择服务端',
  privacy: '配置仅保存在本机，不会上传到其他服务。',
  'save-connect': '保存并连接',
  'save-failed': '保存服务端配置失败',
  'save-success': '配置已保存，正在打开客户端…',
  'saved-help': '可以保存多个开发、测试或生产环境。',
  'saved-servers': '已保存的服务端',
  'saving': '正在保存配置…',
  'server-url': '服务端 API 根地址',
  subtitle: '选择已保存的环境，或配置一个新的 Lemon 服务。',
  test: '检测连接',
  'test-failed': '连接检测失败',
  testing: '正在检测连接…',
  'url-help': '请输入完整的 http(s) 地址，并包含后台 context-path，例如',
};
const englishMessages = {
  'bridge-error': 'The desktop security bridge failed to initialize. Restart the app.',
  cancel: 'Cancel',
  'config-name': 'Configuration name',
  'delete-confirm': 'Delete “{name}”?',
  'delete-failed': 'Failed to delete the configuration',
  'delete-success': 'Configuration deleted',
  delete: 'Delete',
  'local-server': 'Local server',
  'name-placeholder': 'For example: Production',
  'new-server': '+ Configure a new server',
  'page-title': 'Select Lemon Server',
  'read-failed': 'Failed to read local configuration',
  heading: 'Select a server',
  privacy: 'Configurations are stored only on this device and are never uploaded elsewhere.',
  'save-connect': 'Save and connect',
  'save-failed': 'Failed to save the server configuration',
  'save-success': 'Configuration saved. Opening the client…',
  'saved-help': 'You can save multiple development, test, or production environments.',
  'saved-servers': 'Saved servers',
  'saving': 'Saving configuration…',
  'server-url': 'Server API root URL',
  subtitle: 'Choose a saved environment or configure a new Lemon service.',
  test: 'Test connection',
  'test-failed': 'Connection test failed',
  testing: 'Testing connection…',
  'url-help': 'Enter a complete http(s) URL including the backend context path, for example',
};
const englishErrors = {
  '请输入服务端地址': 'Enter the server URL',
  '服务端地址不能包含查询参数或锚点': 'The server URL cannot contain a query string or fragment',
  '服务端地址不能包含用户名或密码': 'The server URL cannot contain a username or password',
  '服务端地址仅支持 http:// 或 https:// 协议': 'The server URL must use http:// or https://',
  '服务端地址格式不正确，请输入完整的 http:// 或 https:// 地址':
    'The server URL is invalid. Enter a complete http:// or https:// URL',
  '服务端地址缺少主机名': 'The server URL must include a host name',
};
let servers = [];

/** 获取选择器当前语言的文案，并替换少量动态占位符。 */
function tr(key, params = {}) {
  const source = (locale === 'en-US' ? englishMessages : chineseMessages)[key];
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    source ?? key,
  );
}

/** 翻译主进程校验错误；未知错误保持原文，便于问题诊断。 */
function translateError(message) {
  const source = String(message ?? '');
  return locale === 'en-US' ? englishErrors[source] ?? source : source;
}

/** 本地化静态 HTML，并让辅助技术读取到正确语言。 */
function applyLocale() {
  document.documentElement.lang = locale;
  if (locale !== 'en-US') return;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = tr(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = tr(element.dataset.i18nPlaceholder);
  }
}

/** 更新页面提示，统一处理成功、失败和普通状态。 */
function setStatus(message = '', type = '') {
  status.textContent = message;
  status.className = `status${type ? ` status--${type}` : ''}`;
}

/** 返回下拉框当前对应的服务端记录。 */
function getSelectedServer() {
  return servers.find((item) => item.id === savedServer.value) ?? null;
}

/** 将一条已保存记录填入编辑表单；新建时提供本地开发默认值。 */
function fillForm(server) {
  serverName.value = server?.name ?? tr('local-server');
  serverUrl.value = server?.url ?? 'http://localhost:7806/lmdb';
  deleteButton.disabled = !server;
  setStatus();
}

/** 重新渲染服务端下拉框，并优先选中磁盘中记录的上次服务端。 */
function renderServers(config, preferredId) {
  servers = config.servers ?? [];
  savedServer.replaceChildren();

  for (const server of servers) {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = `${server.name} — ${server.url}`;
    savedServer.append(option);
  }

  const newOption = document.createElement('option');
  newOption.value = NEW_SERVER_VALUE;
  newOption.textContent = tr('new-server');
  savedServer.append(newOption);

  const selectedId =
    preferredId ??
    (servers.some((item) => item.id === config.selectedServerId)
      ? config.selectedServerId
      : servers[0]?.id);
  savedServer.value = selectedId ?? NEW_SERVER_VALUE;
  fillForm(getSelectedServer());
}

/** 初始化选择器；预加载桥接缺失时给出明确错误。 */
async function initialize() {
  applyLocale();
  if (!bridge) {
    setStatus(tr('bridge-error'), 'error');
    connectButton.disabled = true;
    testButton.disabled = true;
    return;
  }
  try {
    renderServers(await bridge.list());
  } catch (error) {
    setStatus(translateError(error.message) || tr('read-failed'), 'error');
  }
}

savedServer.addEventListener('change', () => fillForm(getSelectedServer()));

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  setStatus(tr('testing'));
  try {
    const result = await bridge.test(serverUrl.value);
    setStatus(result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    setStatus(translateError(error.message) || tr('test-failed'), 'error');
  } finally {
    testButton.disabled = false;
  }
});

deleteButton.addEventListener('click', async () => {
  const selected = getSelectedServer();
  if (!selected) return;
  const deleteMessage = locale === 'en-US'
    ? tr('delete-confirm', { name: selected.name })
    : `确定删除“${selected.name}”吗？`;
  if (!window.confirm(deleteMessage)) return;

  deleteButton.disabled = true;
  try {
    const config = await bridge.remove(selected.id);
    renderServers(config);
    setStatus(tr('delete-success'), 'success');
  } catch (error) {
    setStatus(translateError(error.message) || tr('delete-failed'), 'error');
    deleteButton.disabled = false;
  }
});

closeButton.addEventListener('click', () => bridge?.close());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  connectButton.disabled = true;
  setStatus(tr('saving'));
  try {
    const selected = getSelectedServer();
    await bridge.connect({
      id: selected?.id,
      name: serverName.value,
      url: serverUrl.value,
    });
    setStatus(tr('save-success'), 'success');
  } catch (error) {
    setStatus(translateError(error.message) || tr('save-failed'), 'error');
    connectButton.disabled = false;
  }
});

void initialize();
