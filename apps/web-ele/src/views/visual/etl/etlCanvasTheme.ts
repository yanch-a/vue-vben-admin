/**
 * ETL 画布的主题色板和单元格样式（纯函数，便于单测）。
 * 设计原则：几乎不用线条。分组 = 无边框的浅色区域 + 纯文字标题；节点 = 无边框卡片 + 柔和阴影 + 类型小圆点；
 * 只有选中（主色环）和搜索命中（暖色底 + 细环）才出现描边。
 */

export interface EtlCanvasTheme {
  background: string;
  edge: string;
  edgeDisabled: string;
  edgeSelected: string;
  edgeTask: string;
  grid: string;
  groupActiveBorder: string;
  groupActiveFill: string;
  groupBorder: string;
  groupFill: string;
  groupHitFill: string;
  hit: string;
  hitFill: string;
  labelFill: string;
  muted: string;
  danger: string;
  nodeBase: string;
  primary: string;
  shadow: string;
  shadowHover: string;
  text: string;
}

export const ETL_CANVAS_THEMES: Record<'dark' | 'light', EtlCanvasTheme> = {
  light: {
    background: '#fafafa',
    grid: '#e6e8eb',
    nodeBase: '#ffffff',
    shadow: 'rgba(16,24,40,0.08)',
    shadowHover: 'rgba(16,24,40,0.14)',
    text: '#303133',
    muted: '#909399',
    danger: '#f56c6c',
    primary: '#409eff',
    groupFill: 'rgba(0,0,0,0.022)',
    groupBorder: '#e4e7ec',
    groupActiveBorder: 'rgba(64,158,255,0.35)',
    groupActiveFill: 'rgba(64,158,255,0.06)',
    groupHitFill: 'rgba(230,162,60,0.1)',
    hit: '#e6a23c',
    hitFill: '#fdf6ec',
    labelFill: '#f0f2f5',
    edge: '#cdd0d6',
    edgeDisabled: '#e4e7ed',
    edgeSelected: '#409eff',
    edgeTask: '#a0cfff',
  },
  dark: {
    background: '#141414',
    grid: '#262727',
    nodeBase: '#232427',
    shadow: 'rgba(0,0,0,0.35)',
    shadowHover: 'rgba(0,0,0,0.55)',
    text: '#e5eaf3',
    muted: '#8d9095',
    danger: '#f56c6c',
    primary: '#409eff',
    groupFill: 'rgba(255,255,255,0.025)',
    groupBorder: '#2e3034',
    groupActiveBorder: 'rgba(64,158,255,0.4)',
    groupActiveFill: 'rgba(64,158,255,0.07)',
    groupHitFill: 'rgba(230,162,60,0.1)',
    hit: '#e6a23c',
    hitFill: '#33291b',
    labelFill: '#1d1e1f',
    edge: '#414245',
    edgeDisabled: '#2e2f31',
    edgeSelected: '#409eff',
    edgeTask: '#2a598a',
  },
};

/** 类型色只用在小圆点 / 端口上，卡片本身保持中性。 */
export const ETL_CANVAS_TYPE_ACCENTS = { source: '#409eff', transform: '#67c23a', write: '#e6a23c' } as const;

export function etlCanvasTheme(dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')): EtlCanvasTheme {
  return ETL_CANVAS_THEMES[dark ? 'dark' : 'light'];
}

export function etlCardShadow(color: string, blur = 3) {
  return { name: 'dropShadow', args: { dx: 0, dy: 1, blur, color, opacity: 1 } };
}

/** 粗略估算文字宽度（中文按字号，西文约 0.58 倍），用于标题省略和步骤数定位。 */
export function etlTextWidth(text: string, fontSize: number) {
  let width = 0;
  for (const char of text) width += /[\u0000-\u00FF]/.test(char) ? fontSize * 0.58 : fontSize;
  return width;
}

/** 节点标题可用宽度：节点宽 148 - 左边圆点区 20 - 右边内边距 8 */
export const ETL_CANVAS_NODE_TITLE_MAX = 120;

export function etlFitText(text: string, fontSize: number, maxWidth: number) {
  if (etlTextWidth(text, fontSize) <= maxWidth) return text;
  let result = '';
  for (const char of text) {
    if (etlTextWidth(`${result}${char}…`, fontSize) > maxWidth) break;
    result += char;
  }
  return `${result}…`;
}

export interface EtlGroupStyleState {
  active: boolean;
  count: string;
  current: boolean;
  dim: boolean;
  disabled: boolean;
  hit: boolean;
  name: string;
  /** 停用等状态文案；单独渲染为红色，不拼进 name，避免超长被截掉 */
  status?: string;
  width: number;
}

const GROUP_LABEL_X = 10;

/** 分组：无边框浅色区域；标题是纯文字（名称 + 灰色步骤数），活动任务名称前加主色小圆点。 */
export function etlGroupAttrs(theme: EtlCanvasTheme, state: EtlGroupStyleState) {
  const nameX = state.active ? GROUP_LABEL_X + 10 : GROUP_LABEL_X;
  const status = state.status || (state.disabled ? '停用' : '');
  const statusGap = status ? 6 : 0;
  const statusWidth = status ? etlTextWidth(status, 11) + statusGap : 0;
  const countWidth = etlTextWidth(state.count, 11) + 6;
  const name = etlFitText(state.name, 12, Math.max(24, state.width - nameX - GROUP_LABEL_X - countWidth - statusWidth));
  const nameEnd = nameX + etlTextWidth(name, 12);
  const ring = state.current || state.hit;
  const opacity = state.dim ? 0.35 : 1;
  return {
    body: {
      fill: state.hit ? theme.groupHitFill : state.active ? theme.groupActiveFill : theme.groupFill,
      stroke: ring ? theme.hit : state.active ? theme.groupActiveBorder : theme.groupBorder,
      strokeWidth: 1,
      opacity,
    },
    dot: { fill: theme.primary, r: state.active ? 3 : 0, opacity },
    label: {
      text: name,
      refX: nameX,
      fill: state.hit ? theme.hit : state.active ? theme.primary : theme.text,
      fontStyle: 'normal',
      opacity,
    },
    status: {
      text: status,
      refX: status ? nameEnd + statusGap : nameEnd,
      fill: theme.danger,
      fontSize: 11,
      fontWeight: 500,
      opacity,
    },
    count: { text: state.count, refX: nameEnd + statusWidth + 6, fill: theme.muted, opacity },
  };
}

export interface EtlNodeStyleState {
  accent: string;
  current: boolean;
  dim: boolean;
  disabled: boolean;
  hit: boolean;
  selected: boolean;
  title: string;
}

/** 节点：中性无边框卡片 + 柔和阴影；选中才出现 1.5px 主色环，命中为暖色底 + 环。 */
export function etlNodeAttrs(theme: EtlCanvasTheme, state: EtlNodeStyleState) {
  const ring = state.hit || state.current ? theme.hit : state.selected ? theme.primary : 'none';
  // 不用 X6 textWrap：超长标题在 height:16 + ellipsis 下会整段消失；改成预截断保证始终可见。
  const title = etlFitText(state.title || '', 12, ETL_CANVAS_NODE_TITLE_MAX);
  return {
    body: {
      fill: state.hit ? theme.hitFill : theme.nodeBase,
      stroke: ring,
      strokeWidth: ring === 'none' ? 0 : 1.5,
      filter: etlCardShadow(theme.shadow),
      opacity: state.dim ? 0.25 : state.disabled ? 0.5 : 1,
    },
    dot: { fill: state.accent, opacity: state.dim ? 0.25 : state.disabled ? 0.4 : 1 },
    title: { text: title, fill: state.disabled ? theme.muted : theme.text, opacity: state.dim ? 0.35 : 1 },
  };
}

/** 连线标签（参数 / 任务依赖）：小号灰字 + 与画布同色的无边框小底，不再是白框。 */
export function etlEdgeLabel(theme: EtlCanvasTheme, text: string) {
  return {
    attrs: {
      label: { text, fill: theme.muted, fontSize: 10 },
      body: { fill: theme.labelFill, stroke: 'none', strokeWidth: 0, rx: 3, ry: 3, refWidth: '130%', refHeight: '140%', refX: '-15%', refY: '-20%' },
    },
  };
}