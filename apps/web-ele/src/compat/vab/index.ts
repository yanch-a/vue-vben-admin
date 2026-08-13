import type { App } from 'vue';

import VabCard from './VabCard.vue';
import VabIcon from './VabIcon.vue';
import VabQueryForm from './VabQueryForm.vue';
import VabQueryFormLeftPanel from './VabQueryFormLeftPanel.vue';
import VabQueryFormRightPanel from './VabQueryFormRightPanel.vue';
import VabQueryFormTopPanel from './VabQueryFormTopPanel.vue';

export function registerVabComponents(app: App) {
  app.component('VabQueryForm', VabQueryForm);
  app.component('VabQueryFormLeftPanel', VabQueryFormLeftPanel);
  app.component('VabQueryFormRightPanel', VabQueryFormRightPanel);
  app.component('VabQueryFormTopPanel', VabQueryFormTopPanel);
  app.component('VabCard', VabCard);
  app.component('VabIcon', VabIcon);
  // kebab-case 模板写法兼容
  app.component('VabQueryForm', VabQueryForm);
  app.component('VabQueryFormLeftPanel', VabQueryFormLeftPanel);
  app.component('VabQueryFormRightPanel', VabQueryFormRightPanel);
  app.component('VabQueryFormTopPanel', VabQueryFormTopPanel);
  app.component('VabCard', VabCard);
  app.component('VabIcon', VabIcon);
}
