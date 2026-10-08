/** ETL 复用窗口组件，但显隐和最小化不能干扰原客户端 Dock。 @author yanch */
import { describe, it, expect } from 'vitest';
import { useAiWindowState } from './useAiWindowState';
describe('AI window isolation', () => {
  it('keeps the original singleton while isolating ETL window actions', () => {
    const original = useAiWindowState();
    const dock = useAiWindowState();
    const etl = useAiWindowState(true);
    original.close();
    etl.open();
    etl.toggleMax();
    etl.minimize();
    expect(original.state.visible).toBe(false);
    expect(original.state.maximized).toBe(false);
    expect(etl.state.minimized).toBe(true);
    original.open();
    etl.close();
    expect(dock.state.visible).toBe(true);
    expect(etl.state.visible).toBe(false);
    original.close();
  });
});
