const bridge = window.lemonServerTabs;
const tabsElement = document.querySelector('#tabs');
const addButton = document.querySelector('#add-server');
const collapseButton = document.querySelector('#toggle-collapse');
const expandButton = document.querySelector('#expand-bar');
const collapsedStrip = document.querySelector('#collapsed-strip');
const expandName = document.querySelector('#expand-name');
const collapsedLabel = document.querySelector('#collapsed-label');
const switcherToggle = document.querySelector('#switcher-toggle');
const switcherMenu = document.querySelector('#switcher-menu');

const messages = {
  'en-US': {
    add: 'Connect server',
    close: 'Close',
    collapse: 'Hide server bar',
    expand: 'Show server bar',
    servers: 'Servers',
    switchServer: 'Switch server',
  },
  'zh-CN': {
    add: '连接服务端',
    close: '关闭',
    collapse: '隐藏服务端栏',
    expand: '显示服务端栏',
    servers: '服务端',
    switchServer: '切换服务端',
  },
};

let collapsed = false;
let latestPayload = null;
let menuOpen = false;

/** 按主进程下发的语言刷新标签栏文案。 */
function applyLocale(locale) {
  const text = messages[locale] ?? messages['zh-CN'];
  document.documentElement.lang = locale === 'en-US' ? 'en' : 'zh-CN';
  addButton.title = text.add;
  addButton.setAttribute('aria-label', text.add);
  collapseButton.title = text.collapse;
  collapseButton.setAttribute('aria-label', text.collapse);
  expandButton.title = text.expand;
  expandButton.setAttribute('aria-label', text.expand);
  collapsedLabel.textContent = text.servers;
  switcherToggle.title = text.switchServer;
  switcherToggle.setAttribute('aria-label', text.switchServer);
  return text;
}

/** 同步壳层亮/暗主题；主进程也会随 nativeTheme 推送 theme。 */
function applyTheme(theme) {
  const next =
    theme === 'light' || theme === 'dark'
      ? theme
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset.theme = next;
}

function closeSwitcherMenu() {
  menuOpen = false;
  switcherMenu.hidden = true;
  switcherToggle.setAttribute('aria-expanded', 'false');
}

/** 折叠细条上的服务端下拉，无需展开整栏即可切换。 */
function renderSwitcherMenu(payload) {
  switcherMenu.replaceChildren();
  for (const tab of payload?.tabs ?? []) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'switcher__option';
    option.role = 'option';
    option.title = `${tab.name}\n${tab.url}`;
    option.textContent = tab.name || tab.url;
    option.setAttribute('aria-selected', String(tab.id === payload.activeId));
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      closeSwitcherMenu();
      void bridge.activate(tab.id);
    });
    switcherMenu.append(option);
  }
}

function openSwitcherMenu() {
  if (!latestPayload?.tabs?.length) return;
  renderSwitcherMenu(latestPayload);
  menuOpen = true;
  switcherMenu.hidden = false;
  switcherToggle.setAttribute('aria-expanded', 'true');
}

/** 同步折叠态到 DOM；真正高度由主进程调整 WebContentsView。 */
function applyCollapsed(nextCollapsed, payload) {
  collapsed = nextCollapsed === true;
  document.documentElement.classList.toggle('bar-collapsed', collapsed);
  collapseButton.setAttribute('aria-expanded', String(!collapsed));
  collapsedStrip.hidden = !collapsed;
  const active = (payload?.tabs ?? []).find((tab) => tab.id === payload?.activeId);
  expandName.textContent = active?.name || active?.url || '';
  if (!collapsed) {
    closeSwitcherMenu();
  }
}

/** 用当前已连接的服务端重绘标签，不销毁正在后台运行的业务页面。 */
function renderTabs(payload) {
  latestPayload = payload;
  applyTheme(payload?.theme);
  const text = applyLocale(payload?.locale);
  applyCollapsed(payload?.collapsed === true, payload);
  if (menuOpen && collapsed) {
    renderSwitcherMenu(payload);
  }
  tabsElement.replaceChildren();
  for (const tab of payload?.tabs ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.role = 'tab';
    button.title = `${tab.name}\n${tab.url}`;
    button.setAttribute('aria-selected', String(tab.id === payload.activeId));
    button.addEventListener('click', () => {
      void bridge.activate(tab.id);
    });
    button.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        void bridge.close(tab.id);
      }
    });

    const name = document.createElement('span');
    name.className = 'tab__name';
    name.textContent = tab.name || tab.url;

    const close = document.createElement('span');
    close.className = 'tab__close';
    close.title = text.close;
    close.setAttribute('aria-label', text.close);
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void bridge.close(tab.id);
    });

    button.append(name, close);
    tabsElement.append(button);
  }
}

async function setCollapsed(next) {
  if (!bridge?.setCollapsed) return;
  const payload = await bridge.setCollapsed(next === true);
  if (payload) {
    renderTabs(payload);
  }
}

addButton.addEventListener('click', () => {
  void bridge.add();
});

collapseButton.addEventListener('click', () => {
  void setCollapsed(true);
});

expandButton.addEventListener('click', () => {
  closeSwitcherMenu();
  void setCollapsed(false);
});

switcherToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  if (menuOpen) {
    closeSwitcherMenu();
  } else {
    openSwitcherMenu();
  }
});

document.addEventListener('click', () => {
  if (menuOpen) closeSwitcherMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuOpen) {
    closeSwitcherMenu();
  }
});

if (!bridge) {
  addButton.disabled = true;
  collapseButton.disabled = true;
  expandButton.disabled = true;
  switcherToggle.disabled = true;
} else {
  bridge.onChanged(renderTabs);
  if (typeof bridge.onThemeChanged === 'function') {
    bridge.onThemeChanged((theme) => applyTheme(theme));
  }
  bridge.list().then(renderTabs).catch(() => {
    addButton.disabled = true;
    collapseButton.disabled = true;
    expandButton.disabled = true;
    switcherToggle.disabled = true;
  });
}
