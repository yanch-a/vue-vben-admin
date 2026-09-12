# Lemon Electron 客户端

这套桌面入口与原 Web 入口共用 `apps/web-ele/src`，但构建参数完全隔离：Web 生产包仍使用 `/lmdb/view/`，Electron 包使用相对静态资源并由主进程代理 `/lmdb` 请求。

## 开发与测试

在仓库根目录执行：

```bash
# Electron 配置、URL 映射单元测试
pnpm desktop:test:ele

# 已构建桌面资源的选择器与 Vue 挂载冒烟测试
pnpm -F @vben/web-ele run desktop:smoke
pnpm -F @vben/web-ele run desktop:smoke:renderer

# 构建桌面渲染包并启动 Electron
pnpm desktop:dev:ele

# 原 Web 端构建（行为保持不变）
pnpm build:ele
```

首次使用或当前服务端未登录时，客户端会显示服务端选择器；上次选中的服务端仍处于登录状态时，下次启动直接进入主程序。服务端地址需要填写完整 API 根地址并包含 context-path，例如 `http://localhost:7806/lmdb`。多个地址及其登录状态会保存到 Electron 的 `userData/server-config.json`：

- Windows：`%APPDATA%/Lemon DB Client/server-config.json`
- macOS：`~/Library/Application Support/Lemon DB Client/server-config.json`
- Linux：`~/.config/Lemon DB Client/server-config.json`

运行中也可以通过“服务端 → 选择或配置服务端…”（快捷键 `Ctrl/Cmd + ,`）切换环境。每个“配置 ID + 服务端 URL”使用独立的前端 Store 和 SQL 会话缓存，避免登录令牌、打开的数据库连接、SQL Tab、后台任务和 AI 模型选择串用。

## 打包

```bash
pnpm desktop:package:ele:win
pnpm desktop:package:ele:mac
pnpm desktop:package:ele:linux
```

产物位于 `apps/web-ele/release`。三个系统的安装包应分别在对应系统的构建机上生成；正式发布时通过 electron-builder 标准的签名环境变量注入 Windows/macOS 证书。
