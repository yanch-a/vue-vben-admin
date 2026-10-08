/**
 * 挂载真实 ETL 页面用于浏览器隔离验收，不使用应用登录或用户数据库。
 * 必须使用 VITE_GLOB_API_URL=http://127.0.0.1:7807 和独立 5778 端口。
 * @author yanch
 */
import { createApp, h } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import ElementPlus from 'element-plus';
import { initPreferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import { unmountGlobalLoading } from '@vben/utils';
import { useElementPlusDesignTokens } from '@vben/hooks';
import '@vben/styles';
import '@vben/styles/ele';
import 'element-plus/dist/index.css';
import { setupI18n } from '#/locales';
import { translateUiText } from '#/locales/ui-text';

/** 测试页面只加载真实 ETL 组件，路由与存储命名空间和用户工作台隔离。 */
async function mountSmoke() {
  if (
    import.meta.env.PROD ||
    import.meta.env.VITE_GLOB_API_URL !== 'http://127.0.0.1:7807'
  ) {
    document.body.textContent =
      '隔离验收页仅允许开发模式和指定本机 H2 验收服务。';
    return;
  }
  await initPreferences({ namespace: 'lemon-etl-isolated-smoke' });
  const app = createApp({
    setup() {
      useElementPlusDesignTokens();
      return () =>
        h('div', [
          h(
            'div',
            {
              style:
                'padding:8px 20px;background:#fff5da;color:#76570b;font-size:13px',
            },
            '隔离验收环境 · H2 内存库 · 不访问用户数据库 · AI 使用模拟响应',
          ),
          h(RouterView),
        ]);
    },
  });
  await initStores(app, { namespace: 'lemon-etl-isolated-smoke' });
  await setupI18n(app);
  app.config.globalProperties.$tr = translateUiText;
  app.use(ElementPlus);
  app.use(
    createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/:pathMatch(.*)*',
          component: () => import('#/views/visual/etl/index.vue'),
        },
      ],
    }),
  );
  app.mount('#app');
  unmountGlobalLoading();
}
void mountSmoke();
