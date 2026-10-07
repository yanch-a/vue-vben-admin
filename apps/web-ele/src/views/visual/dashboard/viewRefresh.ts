/**
 * 大屏查看页自动刷新间隔计算。
 * <p>优先级：URL `?refresh=秒`（0/off 关闭）> 大屏配置 viewRefreshSeconds（0 关闭）
 * > 快照模式跟随后台快照间隔 > 实时模式默认关闭。结果统一夹在 [MIN, MAX] 秒内。</p>
 * @author yanch
 */

/** 实时模式每次刷新都会查库，最短 10 秒，避免投屏墙把数据库打满。 */
export const MIN_VIEW_REFRESH_SECONDS = 10;
export const MAX_VIEW_REFRESH_SECONDS = 86_400;
/** 快照模式缺少间隔时的默认值，与后端 refreshIntervalSeconds 默认一致。 */
export const DEFAULT_SNAPSHOT_REFRESH_SECONDS = 300;

export interface ViewRefreshInput {
  /** URL 查询参数 refresh 的原始值 */
  queryOverride?: null | string;
  /** 大屏配置中的 viewRefreshSeconds；undefined 表示未配置 */
  viewRefreshSeconds?: null | number | string;
  /** LIVE / INTERVAL_SNAPSHOT */
  refreshMode?: null | string;
  /** 快照模式后台刷新间隔（秒） */
  snapshotIntervalSeconds?: null | number | string;
}

function clampSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_VIEW_REFRESH_SECONDS, Math.max(MIN_VIEW_REFRESH_SECONDS, Math.round(value)));
}

function parseSeconds(value: null | number | string | undefined): null | number {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (text === 'off' || text === 'false' || text === 'no') return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** 返回生效的刷新间隔（秒），0 表示不自动刷新。 */
export function resolveViewRefreshSeconds(input: ViewRefreshInput): number {
  const override = parseSeconds(input.queryOverride);
  if (override != null) return clampSeconds(override);
  const configured = parseSeconds(input.viewRefreshSeconds);
  if (configured != null) return clampSeconds(configured);
  if (input.refreshMode === 'INTERVAL_SNAPSHOT') {
    const snapshot = parseSeconds(input.snapshotIntervalSeconds);
    return clampSeconds(snapshot && snapshot > 0 ? snapshot : DEFAULT_SNAPSHOT_REFRESH_SECONDS);
  }
  return 0;
}
