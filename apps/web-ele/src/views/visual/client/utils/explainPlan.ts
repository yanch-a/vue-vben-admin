/**
 * 可视化执行计划：类型定义与展示辅助（树展开、代价条、告警文案、AI 优化提示词）。
 *
 * <p>后端把各数据库的原始计划归一化为同一棵树（见 com.lemon.vq.explain.PlanNode），
 * 这里只负责展示规则。中文文案在模板中经 $tr 翻译。</p>
 *
 * @author yanch
 */
import { resolveDialectFamily } from '../dialect/dbTypes';

export type PlanAccessType =
  | 'AGGREGATE'
  | 'CONST'
  | 'FULL_SCAN'
  | 'INDEX_FULL_SCAN'
  | 'INDEX_LOOKUP'
  | 'INDEX_ONLY'
  | 'INDEX_RANGE'
  | 'JOIN'
  | 'OTHER'
  | 'SORT'
  | 'TEMP';

export type PlanWarningLevel = 'HIGH' | 'LOW' | 'MEDIUM';

export interface ExplainPlanNode {
  id: string;
  depth: number;
  operation?: string;
  detail?: string;
  objectName?: string;
  alias?: string;
  indexName?: string;
  accessType?: PlanAccessType | string;
  rawAccessType?: string;
  estRows?: number | null;
  estCost?: number | null;
  selfCost?: number | null;
  costShare?: number | null;
  actualRows?: number | null;
  actualTimeMs?: number | null;
  selfTimeMs?: number | null;
  timeShare?: number | null;
  loops?: number | null;
  condition?: string;
  hotspot?: boolean;
  flags?: string[];
  warningCodes?: string[];
  attributes?: Record<string, unknown>;
  children?: ExplainPlanNode[];
}

export interface ExplainPlanWarning {
  code: string;
  level: PlanWarningLevel | string;
  nodeId?: string;
  objectName?: string;
  rows?: number | null;
  message?: string;
  suggestion?: string;
}

export interface ExplainPlanResult {
  dbType?: string;
  family?: string;
  engine?: string;
  supported: boolean;
  analyzed?: boolean;
  structured?: boolean;
  requireProdConfirm?: boolean;
  format?: string;
  statementKind?: string;
  sql?: string;
  explainCommand?: string;
  root?: ExplainPlanNode | null;
  nodeCount?: number;
  totalCost?: number | null;
  estRows?: number | null;
  planningTimeMs?: number | null;
  executionTimeMs?: number | null;
  elapsedMs?: number | null;
  warnings?: ExplainPlanWarning[];
  rawText?: string;
  rawFormat?: string;
  message?: string;
  notes?: string[];
  env?: string;
  prod?: boolean;
  timeoutSeconds?: number | null;
}

/** 编辑器页签上保存的计划状态 */
export interface ExplainPlanState {
  /** 请求中的 SQL（用于“重新分析”与 AI 优化） */
  sql: string;
  loading: boolean;
  analyze: boolean;
  result: ExplainPlanResult | null;
  error?: string;
}

export interface PlanRow {
  node: ExplainPlanNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** 访问方式中文名（模板里 $tr） */
export const ACCESS_TYPE_TEXT: Record<string, string> = {
  AGGREGATE: '聚合',
  CONST: '常量',
  FULL_SCAN: '全表扫描',
  INDEX_FULL_SCAN: '全索引扫描',
  INDEX_LOOKUP: '索引查找',
  INDEX_ONLY: '覆盖索引',
  INDEX_RANGE: '索引范围',
  JOIN: '表关联',
  OTHER: '其他',
  SORT: '排序操作',
  TEMP: '临时结果',
};

export function accessTypeText(accessType?: null | string): string {
  if (!accessType) return '';
  return ACCESS_TYPE_TEXT[accessType] ?? accessType;
}

export function accessTypeTagType(
  accessType?: null | string,
): 'danger' | 'info' | 'success' | 'warning' {
  switch (accessType) {
    case 'CONST':
    case 'INDEX_LOOKUP':
    case 'INDEX_ONLY':
    case 'INDEX_RANGE': {
      return 'success';
    }
    case 'FULL_SCAN': {
      return 'danger';
    }
    case 'INDEX_FULL_SCAN':
    case 'SORT':
    case 'TEMP': {
      return 'warning';
    }
    default: {
      return 'info';
    }
  }
}

/** 告警标题与建议（中文，模板里 $tr）；后端 message 带表名等动态信息，作为补充展示 */
export const PLAN_WARNING_TEXT: Record<string, { suggestion: string; title: string }> = {
  CARTESIAN_JOIN: {
    title: '笛卡尔积关联',
    suggestion: '检查是否漏写了 JOIN 条件；确实需要交叉关联时先尽量缩小两侧数据量。',
  },
  DEPENDENT_SUBQUERY: {
    title: '相关子查询逐行执行',
    suggestion: '改写为 JOIN / EXISTS（半连接），或为子查询中引用外层的关联列建立索引。',
  },
  DISK_SORT: {
    title: '排序溢出到磁盘',
    suggestion:
      '为 ORDER BY 列建立与排序方向一致的索引，或减少参与排序的行数；必要时调大排序内存（work_mem / sort_buffer_size）。',
  },
  FILESORT: {
    title: '额外排序（filesort）',
    suggestion:
      '为 ORDER BY / GROUP BY 列建立与排序方向一致的索引，让数据按索引顺序读出，或减少需要排序的行数。',
  },
  FILTER_DISCARD: {
    title: '扫描后丢弃大量行',
    suggestion: '过滤条件没能利用索引：为过滤列建立索引（PostgreSQL 可考虑部分索引 / 表达式索引）。',
  },
  FULL_INDEX_SCAN: {
    title: '全索引扫描',
    suggestion: '全索引扫描仍会读取整棵索引，检查过滤条件是否缺少能用于定位的索引前导列。',
  },
  FULL_TABLE_SCAN: {
    title: '全表扫描',
    suggestion:
      '确认是否需要读取整张表；如只需部分数据，增加过滤条件并为其建立索引，或通过 LIMIT / 分区裁剪缩小范围。',
  },
  JOIN_BUFFER: {
    title: '关联未使用索引',
    suggestion: '为被驱动表的关联列建立索引，让关联走索引查找。',
  },
  MISSING_INDEX: {
    title: '过滤条件缺少可用索引',
    suggestion:
      '为 WHERE / JOIN 中的过滤列建立索引（多列条件考虑联合索引，区分度高的列放前面），并确认列上没有函数或隐式类型转换导致索引失效。',
  },
  NESTED_LOOP_LARGE: {
    title: '大表嵌套循环',
    suggestion: '为内层（被驱动表）的关联列建立索引；让结果集小的一侧做驱动表，或让优化器选择 Hash Join。',
  },
  ROW_ESTIMATE_MISMATCH: {
    title: '估算行数与实际偏差大',
    suggestion:
      '统计信息可能过期：执行 ANALYZE TABLE / ANALYZE / 收集统计信息后再看计划；数据倾斜严重时考虑直方图或扩展统计。',
  },
  TEMP_TABLE: {
    title: '使用临时表',
    suggestion:
      'GROUP BY / DISTINCT / UNION 会产生临时表：可为分组列建索引、UNION 改为 UNION ALL（无需去重时）或减少分组列。',
  },
};

export function warningTitle(w: ExplainPlanWarning): string {
  return PLAN_WARNING_TEXT[w.code]?.title ?? w.message ?? w.code;
}

export function warningSuggestion(w: ExplainPlanWarning): string {
  return PLAN_WARNING_TEXT[w.code]?.suggestion ?? w.suggestion ?? '';
}

export function warningLevelText(level?: null | string): string {
  if (level === 'HIGH') return '高危';
  if (level === 'MEDIUM') return '中危';
  return '低危';
}

export function warningTagType(level?: null | string): 'danger' | 'info' | 'warning' {
  if (level === 'HIGH') return 'danger';
  if (level === 'MEDIUM') return 'warning';
  return 'info';
}

/** 除 MongoDB 外都提供执行计划分析。SQLite 会返回 EXPLAIN QUERY PLAN。 */
export function supportsExplainAnalyze(dbType?: null | string): boolean {
  return resolveDialectFamily(dbType) !== 'MONGODB_LIKE';
}

export function supportsExplain(dbType?: null | string): boolean {
  return resolveDialectFamily(dbType) !== 'MONGODB_LIKE';
}

/** 深度优先拍平；折叠节点的子孙不输出 */
export function flattenPlan(
  root: ExplainPlanNode | null | undefined,
  collapsed: ReadonlySet<string> = new Set(),
): PlanRow[] {
  const rows: PlanRow[] = [];
  const visit = (node: ExplainPlanNode, depth: number) => {
    const children = node.children ?? [];
    const expanded = !collapsed.has(node.id);
    rows.push({ node, depth, hasChildren: children.length > 0, expanded });
    if (!expanded) return;
    for (const child of children) visit(child, depth + 1);
  };
  if (root) visit(root, 0);
  return rows;
}

export function indexPlanNodes(
  root: ExplainPlanNode | null | undefined,
): Map<string, ExplainPlanNode> {
  const map = new Map<string, ExplainPlanNode>();
  const visit = (node: ExplainPlanNode) => {
    map.set(node.id, node);
    for (const child of node.children ?? []) visit(child);
  };
  if (root) visit(root);
  return map;
}

/** 某节点的全部祖先 id（定位告警时自动展开） */
export function ancestorIds(
  root: ExplainPlanNode | null | undefined,
  targetId: string,
): string[] {
  const path: string[] = [];
  const visit = (node: ExplainPlanNode): boolean => {
    if (node.id === targetId) return true;
    path.push(node.id);
    for (const child of node.children ?? []) {
      if (visit(child)) return true;
    }
    path.pop();
    return false;
  };
  if (root && visit(root)) return path;
  return [];
}

/**
 * 代价条宽度百分比：ANALYZE 结果按自身耗时占比，否则按自身代价占比；
 * 都没有（如 SQLite 不给代价）时返回 null，界面不画条。
 */
export function planBarPercent(
  node: ExplainPlanNode,
  analyzed?: boolean,
): null | number {
  const share = analyzed && node.timeShare != null ? node.timeShare : node.costShare;
  if (share == null || Number.isNaN(share)) return null;
  return Math.max(0, Math.min(100, Math.round(share * 1000) / 10));
}

export function formatPlanNumber(value?: null | number): string {
  if (value == null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimFixed(value / 1e9)}G`;
  if (abs >= 1e6) return `${trimFixed(value / 1e6)}M`;
  if (abs >= 1e4) return `${trimFixed(value / 1e3)}K`;
  if (Number.isInteger(value)) return String(value);
  return trimFixed(value, 2);
}

export function formatPlanMs(value?: null | number): string {
  if (value == null || Number.isNaN(value)) return '-';
  if (value >= 1000) return `${trimFixed(value / 1000, 2)} s`;
  return `${trimFixed(value, value < 10 ? 3 : 1)} ms`;
}

function trimFixed(value: number, digits = 1): string {
  const s = value.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 节点主标题：算子 + 对象 */
export function planNodeLabel(node: ExplainPlanNode): string {
  const op = node.operation || node.accessType || '?';
  const obj = node.objectName
    ? `${node.objectName}${node.alias && node.alias !== node.objectName ? ` ${node.alias}` : ''}`
    : '';
  if (obj && !op.includes(node.objectName as string)) return `${op} · ${obj}`;
  return op;
}

/** 计划树的紧凑文本（AI 提示与复制使用） */
export function planTreeText(root: ExplainPlanNode | null | undefined, maxLines = 120): string {
  const lines: string[] = [];
  const visit = (node: ExplainPlanNode, depth: number) => {
    if (lines.length >= maxLines) return;
    const parts = [planNodeLabel(node)];
    if (node.indexName) parts.push(`index=${node.indexName}`);
    if (node.accessType && node.accessType !== 'OTHER') parts.push(`access=${node.accessType}`);
    if (node.estRows != null) parts.push(`rows≈${formatPlanNumber(node.estRows)}`);
    if (node.estCost != null) parts.push(`cost=${formatPlanNumber(node.estCost)}`);
    if (node.actualRows != null) parts.push(`actualRows=${formatPlanNumber(node.actualRows)}`);
    if (node.actualTimeMs != null) parts.push(`time=${formatPlanMs(node.actualTimeMs)}`);
    if (node.loops != null && node.loops > 1) parts.push(`loops=${node.loops}`);
    if (node.condition) parts.push(`cond=${node.condition.replaceAll(/\s+/g, ' ').slice(0, 160)}`);
    lines.push(`${'  '.repeat(depth)}- ${parts.join(' | ')}`);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  if (root) visit(root, 0);
  if (lines.length >= maxLines) lines.push(`${'  '}...`);
  return lines.join('\n');
}

/** 发给 AI 助手的优化请求：SQL + 引擎 + 告警 + 计划树（截断，避免超长） */
export function buildAiOptimizePrompt(
  sql: string,
  plan: ExplainPlanResult,
  maxChars = 6000,
): string {
  const warnings = (plan.warnings ?? [])
    .slice(0, 12)
    .map((w) => `- [${w.level}] ${w.message || warningTitle(w)}`)
    .join('\n');
  const tree = plan.structured ? planTreeText(plan.root) : (plan.rawText ?? '').slice(0, 3000);
  const parts = [
    '请根据下面的执行计划分析这条 SQL 的性能瓶颈，给出具体的优化建议（索引设计、SQL 改写、统计信息等），并给出优化后的 SQL 或建索引语句。',
    `数据库：${plan.engine || plan.dbType || ''}${plan.analyzed ? '（EXPLAIN ANALYZE 实际执行统计）' : ''}`,
    `SQL：\n${sql.trim()}`,
    warnings ? `已识别的问题：\n${warnings}` : '',
    `执行计划：\n${tree}`,
  ].filter(Boolean);
  const text = parts.join('\n\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
}

/** 节点详情面板的字段列表（标签为中文，模板里 $tr） */
export function planNodeDetailFields(
  node: ExplainPlanNode,
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    out.push({ label, value: String(value) });
  };
  push('算子', node.operation);
  push('对象', node.objectName);
  push('别名', node.alias);
  push('索引', node.indexName);
  push('访问方式', node.rawAccessType ? `${node.accessType} (${node.rawAccessType})` : node.accessType);
  push('估算行数', node.estRows == null ? null : formatPlanNumber(node.estRows));
  push('累计代价', node.estCost == null ? null : formatPlanNumber(node.estCost));
  push('自身代价', node.selfCost == null ? null : formatPlanNumber(node.selfCost));
  push('代价占比', node.costShare == null ? null : `${(node.costShare * 100).toFixed(1)}%`);
  push('实际行数', node.actualRows == null ? null : formatPlanNumber(node.actualRows));
  push('循环次数', node.loops);
  push('实际耗时', node.actualTimeMs == null ? null : formatPlanMs(node.actualTimeMs));
  push('自身耗时', node.selfTimeMs == null ? null : formatPlanMs(node.selfTimeMs));
  push('耗时占比', node.timeShare == null ? null : `${(node.timeShare * 100).toFixed(1)}%`);
  push('条件', node.condition);
  push('说明', node.detail);
  return out;
}
