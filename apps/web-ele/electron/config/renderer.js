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
let servers = [];

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
  serverName.value = server?.name ?? '本地服务';
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
  newOption.textContent = '+ 配置新的服务端';
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
  if (!bridge) {
    setStatus('客户端安全桥接初始化失败，请重新启动应用', 'error');
    connectButton.disabled = true;
    testButton.disabled = true;
    return;
  }
  try {
    renderServers(await bridge.list());
  } catch (error) {
    setStatus(error.message || '读取本机配置失败', 'error');
  }
}

savedServer.addEventListener('change', () => fillForm(getSelectedServer()));

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  setStatus('正在检测连接…');
  try {
    const result = await bridge.test(serverUrl.value);
    setStatus(result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    setStatus(error.message || '连接检测失败', 'error');
  } finally {
    testButton.disabled = false;
  }
});

deleteButton.addEventListener('click', async () => {
  const selected = getSelectedServer();
  if (!selected) return;
  if (!window.confirm(`确定删除“${selected.name}”吗？`)) return;

  deleteButton.disabled = true;
  try {
    const config = await bridge.remove(selected.id);
    renderServers(config);
    setStatus('配置已删除', 'success');
  } catch (error) {
    setStatus(error.message || '删除配置失败', 'error');
    deleteButton.disabled = false;
  }
});

closeButton.addEventListener('click', () => bridge?.close());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  connectButton.disabled = true;
  setStatus('正在保存配置…');
  try {
    const selected = getSelectedServer();
    await bridge.connect({
      id: selected?.id,
      name: serverName.value,
      url: serverUrl.value,
    });
    setStatus('配置已保存，正在打开客户端…', 'success');
  } catch (error) {
    setStatus(error.message || '保存服务端配置失败', 'error');
    connectButton.disabled = false;
  }
});

void initialize();
