import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeServerUrl } from './server-url.mjs';

const CONFIG_VERSION = 1;

/**
 * 清理磁盘中的单条服务端记录，忽略旧版本或手工修改产生的非法数据。
 */
function sanitizeServer(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  try {
    const url = normalizeServerUrl(value.url);
    const id = String(value.id ?? '').trim();
    if (!id) {
      return null;
    }
    return {
      authenticated: value.authenticated === true,
      id,
      name:
        String(value.name ?? '')
          .trim()
          .slice(0, 80) || new URL(url).host,
      url,
      updatedAt: Number(value.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * 将服务端列表持久化到 Electron userData 下的 JSON 文件。
 * 写入时先生成临时文件再替换，避免应用异常退出留下半截配置。
 *
 * @author yanch
 */
export class ServerConfigStore {
  constructor(configFile) {
    this.configFile = path.resolve(configFile);
  }

  /** 读取并校验完整配置；文件不存在或损坏时返回空配置。 */
  async read() {
    try {
      const raw = JSON.parse(await readFile(this.configFile, 'utf8'));
      const servers = Array.isArray(raw.servers)
        ? raw.servers.map(sanitizeServer).filter(Boolean)
        : [];
      const selectedServerId = servers.some((item) => item.id === raw.selectedServerId)
        ? raw.selectedServerId
        : null;
      return { version: CONFIG_VERSION, selectedServerId, servers };
    } catch {
      return { version: CONFIG_VERSION, selectedServerId: null, servers: [] };
    }
  }

  /** 原子写入配置文件。 */
  async write(config) {
    const parentDirectory = path.dirname(this.configFile);
    const temporaryFile = `${this.configFile}.${process.pid}.tmp`;
    await mkdir(parentDirectory, { recursive: true });
    await writeFile(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, this.configFile);
  }

  /** 新建或更新服务端记录，并将其设置为当前选中项。 */
  async upsert(input) {
    const config = await this.read();
    const normalizedUrl = normalizeServerUrl(input?.url);
    const requestedId = String(input?.id ?? '').trim();
    const existing = config.servers.find((item) => item.id === requestedId);
    const duplicate = config.servers.find((item) => item.url === normalizedUrl);
    const id = existing?.id || duplicate?.id || randomUUID();
    const server = {
      // 修改同一配置的 URL 等同切换后台，必须清除旧地址的登录直达标记。
      authenticated:
        (existing ?? duplicate)?.url === normalizedUrl
          ? (existing ?? duplicate).authenticated === true
          : false,
      id,
      name:
        String(input?.name ?? '')
          .trim()
          .slice(0, 80) || new URL(normalizedUrl).host,
      url: normalizedUrl,
      updatedAt: Date.now(),
    };
    const servers = config.servers.filter((item) => item.id !== id);
    servers.unshift(server);
    await this.write({
      version: CONFIG_VERSION,
      selectedServerId: id,
      servers,
    });
    return server;
  }

  /** 更新指定服务端的登录状态，返回更新后的记录。 */
  async setAuthenticated(id, authenticated) {
    const config = await this.read();
    let updatedServer = null;
    const servers = config.servers.map((server) => {
      if (server.id !== id) return server;
      updatedServer = { ...server, authenticated: authenticated === true };
      return updatedServer;
    });
    if (!updatedServer) return null;
    await this.write({ ...config, servers });
    return updatedServer;
  }

  /** 删除指定服务端；如果它正被选中，同时清空选中状态。 */
  async remove(id) {
    const config = await this.read();
    const servers = config.servers.filter((item) => item.id !== id);
    const selectedServerId = config.selectedServerId === id ? null : config.selectedServerId;
    const next = { version: CONFIG_VERSION, selectedServerId, servers };
    await this.write(next);
    return next;
  }
}
