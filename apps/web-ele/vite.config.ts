import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, viteCssLayerPlugin } from '@vben/vite-config';

import ElementPlus from 'unplugin-element-plus/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const logicflowCoreEntry = require.resolve('@logicflow/core');

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      plugins: [
        // element-plus 的 css 包进 @layer el，使 Tailwind 工具类可覆盖组件样式
        viteCssLayerPlugin({ layerName: 'el', packageName: 'element-plus' }),
        ElementPlus({ format: 'esm' }),
      ],
      resolve: {
        alias: {
          // 兼容从 admin-plus 拷贝过来的 `@/` 路径
          '@': path.resolve(rootDir, 'src'),
          // $ 精确匹配，避免把 @logicflow/core/dist/style 也指到 entry.js
          // package.json "module" 指向 UMD，Vite 当 ESM 导入会导致 default 不是构造函数；强制走 CJS entry
          '@logicflow/core$': logicflowCoreEntry,
          // monaco 0.56 exports 只映射到 esm/vs，CSS 仍在 min/vs，需旁路
          'monaco-editor/min': path.resolve(
            rootDir,
            'node_modules/monaco-editor/min',
          ),
        },
      },
      optimizeDeps: {
        include: [
          '@logicflow/core',
          '@logicflow/extension',
          'monaco-editor',
        ],
      },
      server: {
        proxy: {
          '/lemon': {
            changeOrigin: true,
            // lemon 本地默认端口，见 lemon-main application-dev.yml
            target: 'http://localhost:7806',
            ws: true,
          },
        },
      },
    },
  };
});
