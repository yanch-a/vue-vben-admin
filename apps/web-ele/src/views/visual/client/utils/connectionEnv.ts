/**
 * 连接环境标签与变更窗口状态的展示规则（SQL 客户端、连接表单、工单页共用）。
 *
 * <p>生产识别优先看连接上的 env 字段；env 为空（历史数据）时才回退到旧的名称/描述关键词
 * （生产 / prod / 正式 / production），与后端 DbEnvironment 保持一致。显式标记为非 PROD 的连接
 * 不再按名称推断，可借此修正 product_xxx 之类的误判。</p>
 *
 * @author yanch
 */

export type ConnectionEnv = 'DEV' | 'PROD' | 'TEST' | 'UAT';

export type ConnectionEnvSource = 'FIELD' | 'LEGACY_NAME' | 'NONE';

export interface ResolvedConnectionEnv {
  env: ConnectionEnv | null;
  source: ConnectionEnvSource;
  /** 标签文字：优先连接上的自定义显示名，其次环境码 */
  text: string;
}

export type EnvTagType = 'danger' | 'info' | 'primary' | 'success' | 'warning';

/** 下拉选项：label 为中文，展示时用 $tr 翻译 */
export const ENV_OPTIONS: Array<{ label: string; value: ConnectionEnv }> = [
  { label: '开发', value: 'DEV' },
  { label: '测试', value: 'TEST' },
  { label: '预发/UAT', value: 'UAT' },
  { label: '生产', value: 'PROD' },
];

const LEGACY_PROD_RE = /生产|prod|正式|production/i;

const ENV_ALIASES: Record<string, ConnectionEnv> = {
  DEV: 'DEV',
  DEVELOP: 'DEV',
  DEVELOPMENT: 'DEV',
  开发: 'DEV',
  TEST: 'TEST',
  QA: 'TEST',
  SIT: 'TEST',
  测试: 'TEST',
  UAT: 'UAT',
  STAGING: 'UAT',
  STAGE: 'UAT',
  PRE: 'UAT',
  'PRE-PROD': 'UAT',
  PREPROD: 'UAT',
  预发: 'UAT',
  PROD: 'PROD',
  PRD: 'PROD',
  PRODUCTION: 'PROD',
  生产: 'PROD',
  正式: 'PROD',
};

/** 规范化环境码（兼容 STAGING / PRD / 生产 等别名），无法识别返回 null。 */
export function normalizeEnv(raw: unknown): ConnectionEnv | null {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toUpperCase();
  if (!key) return null;
  return ENV_ALIASES[key] ?? null;
}

function legacyLooksProd(row: Record<string, any>): boolean {
  if (row.isProd === true || row.isProd === 1 || row.isProd === '1') return true;
  const legacyEnv = normalizeEnv(row.envTag ?? row.envType ?? row.environment);
  if (legacyEnv === 'PROD') return true;
  const hay = [row.dbName, row.description, row.remark, row.tag, row.tags]
    .filter(Boolean)
    .join(' ');
  return LEGACY_PROD_RE.test(hay);
}

/** 解析连接的有效环境。 */
export function resolveConnectionEnv(row: unknown): ResolvedConnectionEnv {
  if (!row || typeof row !== 'object') {
    return { env: null, source: 'NONE', text: '' };
  }
  const r = row as Record<string, any>;
  const label = typeof r.envLabel === 'string' ? r.envLabel.trim() : '';
  const env = normalizeEnv(r.env);
  if (env) {
    return { env, source: 'FIELD', text: label || env };
  }
  if (legacyLooksProd(r)) {
    return { env: 'PROD', source: 'LEGACY_NAME', text: label || 'PROD' };
  }
  return { env: null, source: 'NONE', text: label };
}

/** 是否生产连接（env == PROD；env 为空时按旧关键词兜底）。 */
export function isProdEnv(row: unknown): boolean {
  return resolveConnectionEnv(row).env === 'PROD';
}

/** 标签颜色：PROD 红、UAT 橙、TEST 蓝、DEV 绿。 */
export function envTagType(env: ConnectionEnv | null | undefined): EnvTagType {
  switch (env) {
    case 'DEV': {
      return 'success';
    }
    case 'PROD': {
      return 'danger';
    }
    case 'TEST': {
      return 'primary';
    }
    case 'UAT': {
      return 'warning';
    }
    default: {
      return 'info';
    }
  }
}

/** 环境中文名（用 $tr 翻译后展示）。 */
export function envDisplayName(env: ConnectionEnv | null | undefined): string {
  return ENV_OPTIONS.find((o) => o.value === env)?.label ?? '未标记环境';
}

/** 后端 /dataBaseOperate/changeWindowStatus 返回结构 */
export interface ChangeWindowStatus {
  dbConfigId?: number | string;
  dbName?: string;
  env?: null | string;
  envLabel?: null | string;
  envSource?: string;
  restricted?: boolean;
  scopeType?: null | string;
  windowId?: null | number | string;
  open?: boolean;
  frozen?: boolean;
  freezeReason?: null | string;
  freezeEnd?: null | string;
  invalid?: boolean;
  timezone?: null | string;
  now?: null | string;
  openUntil?: null | string;
  nextOpenAt?: null | string;
  message?: null | string;
}

export type ChangeWindowLevel = 'closed' | 'frozen' | 'invalid' | 'none' | 'open';

export interface ChangeWindowView {
  level: ChangeWindowLevel;
  /** 工具栏短文案（中文，展示时 $tr） */
  text: string;
  /** 悬浮提示 */
  detail: string;
  tagType: EnvTagType;
}

/**
 * 缩短时间文本：与「当前时间」同一天只显示 HH:mm，同年显示 MM-dd HH:mm。
 * 两个参数都是窗口时区下的 yyyy-MM-dd HH:mm。
 */
export function shortWindowTime(target?: null | string, now?: null | string): string {
  if (!target) return '';
  const t = target.trim();
  const n = (now ?? '').trim();
  if (t.length >= 16 && n.length >= 10 && t.slice(0, 10) === n.slice(0, 10)) {
    return t.slice(11, 16);
  }
  if (t.length >= 16 && n.length >= 4 && t.slice(0, 4) === n.slice(0, 4)) {
    return t.slice(5, 16);
  }
  return t;
}

/** 把窗口状态转成工具栏展示文案。未配置窗口时 level=none（不展示）。 */
export function formatChangeWindowStatus(
  status?: ChangeWindowStatus | null,
): ChangeWindowView {
  if (!status || !status.restricted) {
    return { level: 'none', text: '', detail: '', tagType: 'info' };
  }
  const tz = status.timezone ? `（${status.timezone}）` : '';
  if (status.invalid) {
    return {
      level: 'invalid',
      text: '变更窗口配置无效',
      detail: status.message || '变更窗口配置无效，写操作已暂停',
      tagType: 'danger',
    };
  }
  if (status.open) {
    const until = shortWindowTime(status.openUntil, status.now);
    return {
      level: 'open',
      text: until ? `变更窗口开放至 ${until}` : '变更窗口开放中',
      detail: until
        ? `允许执行写操作，至 ${status.openUntil}${tz}`
        : `允许执行写操作${tz}`,
      tagType: 'success',
    };
  }
  const next = shortWindowTime(status.nextOpenAt, status.now);
  if (status.frozen) {
    const end = shortWindowTime(status.freezeEnd, status.now);
    return {
      level: 'frozen',
      text: end ? `封网中，至 ${end}` : '封网中',
      detail: status.message || '',
      tagType: 'danger',
    };
  }
  return {
    level: 'closed',
    text: next ? `当前不在变更窗口，下次开放 ${next}` : '当前不在变更窗口',
    detail: status.message || '',
    tagType: 'warning',
  };
}

/** 后端拦截提示是否来自变更窗口（用于工单页决定是否提示强制执行）。 */
export function isChangeWindowBlockedMessage(message: unknown): boolean {
  const text = String(message ?? '');
  return text.includes('变更窗口') && !text.includes('无权');
}

/** 星期（ISO 1=周一）中文名 */
export const WEEKDAY_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];

export interface ChangeWindowRule {
  days: number[];
  start: string;
  end: string;
}

/** 规则摘要：「周一、周三 22:00-06:00（跨夜）」；start==end 为全天。 */
export function describeRule(rule: ChangeWindowRule): string {
  const days = [...(rule.days || [])]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d));
  const dayText = days.length === 7 ? '每天' : days.join('、');
  if (rule.start === rule.end) return `${dayText} 全天`;
  const overnight = rule.start > rule.end ? '（跨夜）' : '';
  return `${dayText} ${rule.start}-${rule.end}${overnight}`;
}
