import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vben/vite-config';

import ElementPlus from 'unplugin-element-plus/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const logicflowCoreEntry = require.resolve('@logicflow/core');

export default defineConfig(async ({ command }) => {
  return {
    application: {},
    vite: {
      // 仅生产打包挂 /lmdb/view/；开发仍用 /
      base: command === 'build' ? '/lmdb/view/' : '/',
      plugins: [
        // 注意：不要使用 viteCssLayerPlugin 包装 element-plus。
        // 生产构建下异步 CSS chunk 会抢先声明 @layer el，层序变成 el < base，
        // Tailwind preflight 压过 EP → 按钮/表格无边框、高度异常。
        // 参见 https://github.com/vbenjs/vue-vben-admin/issues/8224
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
          '/lmdb': {
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
