const bridge = window.lemonServerTabs;
const tabsElement = document.querySelector('#tabs');
const addButton = document.querySelector('#add-server');

const messages = {
  'en-US': {
    add: 'Connect server',
    close: 'Close',
  },
  'zh-CN': {
    add: '连接服务端',
    close: '关闭',
  },
};

/** 按主进程下发的语言刷新标签栏文案。 */
function applyLocale(locale) {
  const text = messages[locale] ?? messages['zh-CN'];
  document.documentElement.lang = locale === 'en-US' ? 'en' : 'zh-CN';
  addButton.title = text.add;
  addButton.setAttribute('aria-label', text.add);
  return text;
}

/** 用当前已连接的服务端重绘标签，不销毁正在后台运行的业务页面。 */
function renderTabs(payload) {
  const text = applyLocale(payload?.locale);
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

addButton.addEventListener('click', () => {
  void bridge.add();
});

if (!bridge) {
  addButton.disabled = true;
} else {
  bridge.onChanged(renderTabs);
  bridge.list().then(renderTabs).catch(() => {
    addButton.disabled = true;
  });
}
