import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  owned: vi.fn(),
  probe: vi.fn(),
}));

vi.mock('#/api/visual/vq', () => ({
  getOwnedDbConfigs: api.owned,
}));

vi.mock('#/api/visual/database', () => ({
  probeOwnedDbConfig: api.probe,
}));

import { probeOwnedConnections, probeSummaryText } from './probeOwnedConnections';

/**
 * 一键探测按拥有者列表逐条执行，单条失败继续后面的连接。
 * @author yanch
 */
describe('probeOwnedConnections', () => {
  beforeEach(() => {
    api.owned.mockReset();
    api.probe.mockReset();
  });

  it('没有自有连接时不发起探测', async () => {
    api.owned.mockResolvedValue({ data: [] });
    const result = await probeOwnedConnections();
    expect(result).toEqual({ total: 0, online: 0, offline: 0 });
    expect(api.probe).not.toHaveBeenCalled();
    expect(probeSummaryText(result)).toBe('没有可探测的连接');
  });

  it('按顺序探测，失败和异常都记为离线', async () => {
    api.owned.mockResolvedValue({
      data: [
        { id: 1, dbName: '在线库' },
        { id: 2, dbName: '离线库' },
        { id: 3, dbName: '异常库' },
      ],
    });
    const order: Array<number | string> = [];
    api.probe.mockImplementation(async (id: number) => {
      order.push(id);
      if (id === 1) return { data: { success: true } };
      if (id === 2) return { data: { success: false } };
      throw new Error('timeout');
    });
    const finished: number[] = [];
    const result = await probeOwnedConnections((progress) => {
      if (progress.connectionStatus != null) finished.push(progress.connectionStatus);
    });
    expect(order).toEqual([1, 2, 3]);
    expect(finished).toEqual([1, 0, 0]);
    expect(result).toEqual({ total: 3, online: 1, offline: 2 });
    expect(probeSummaryText(result)).toBe('探测完成：在线 1，离线 2');
  });
});
