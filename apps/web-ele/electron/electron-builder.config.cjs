const path = require('node:path');

const electronExecutable = require('electron');

/**
 * Lemon 桌面端跨平台打包配置。
 * 使用当前系统已安装的 Electron 运行时，避免重复下载，同时确保构建机与目标系统一致。
 *
 * @author yanch
 */
module.exports = {
  appId: 'com.yanch.lemondbclient',
  productName: 'Lemon DB Client',
  copyright: 'Copyright © yanch',
  directories: {
    output: 'release',
  },
  // Electron 主进程只使用内置模块；Vue 依赖已由 Vite 打入 dist，不携带开发 node_modules。
  files: [
    'dist/**/*',
    'electron/**/*.cjs',
    'electron/**/*.mjs',
    'electron/config/**/*',
    'package.json',
    '!electron/tests/**/*',
    '!node_modules/**/*',
  ],
  asar: true,
  npmRebuild: false,
  electronDist: path.dirname(electronExecutable),
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  win: {
    icon: 'public/logo.png',
    target: ['nsis', 'zip'],
  },
  nsis: {
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    oneClick: false,
    perMachine: false,
  },
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'public/logo.png',
    target: ['dmg', 'zip'],
  },
  linux: {
    category: 'Development',
    icon: 'public/logo.png',
    target: ['AppImage', 'deb'],
  },
  // 正式签名由发布环境通过 CSC_LINK / CSC_KEY_PASSWORD 等标准变量注入。
  publish: null,
};
