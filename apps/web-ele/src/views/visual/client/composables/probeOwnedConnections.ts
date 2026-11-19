import { probeOwnedDbConfig } from '#/api/visual/database';
import { getOwnedDbConfigs } from '#/api/visual/vq';

/** 一条自有连接探测到哪一步。connectionStatus 仅在这一条已经有结果时出现。 */
export interface OwnedProbeProgress {
  id: number | string;
  dbName: string;
  current: number;
  total: number;
  /** 1 在线，0 离线。还在探测时没有这个字段。 */
  connectionStatus?: number;
}

export interface OwnedProbeResult {
  total: number;
  online: number;
  offline: number;
}

/**
 * 按列表顺序逐条探测当前用户拥有的连接。
 * 单条失败记为离线并继续下一条，不中断整批。
 * @author yanch
 */
export async function probeOwnedConnections(
  onProgress?: (progress: OwnedProbeProgress) => void,
): Promise<OwnedProbeResult> {
  const res: any = await getOwnedDbConfigs();
  const list = Array.isArray(res?.data) ? res.data : [];
  let online = 0;
  let offline = 0;
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index] || {};
    const progress: OwnedProbeProgress = {
      id: row.id,
      dbName: row.dbName || '',
      current: index + 1,
      total: list.length,
    };
    onProgress?.(progress);
    let connectionStatus = 0;
    try {
      const result: any = await probeOwnedDbConfig(row.id);
      const data = result?.data ?? result;
      connectionStatus = data?.success ? 1 : 0;
    } catch {
      connectionStatus = 0;
    }
    if (connectionStatus === 1) online += 1;
    else offline += 1;
    onProgress?.({ ...progress, connectionStatus });
  }
  return { total: list.length, online, offline };
}

/** 探测结束后给用户看的一句结果。 */
export function probeSummaryText(result: OwnedProbeResult): string {
  if (result.total === 0) return '没有可探测的连接';
  return `探测完成：在线 ${result.online}，离线 ${result.offline}`;
}
