/**
 * AI 输入框辅助：@表名 补全、显式引用提取、快捷指令按上下文排序。
 * 全部为纯函数，便于单测；组件只负责事件与渲染。
 * @author yanch
 */

import type { AgentScene } from '#/api/ai/agent';

/** 输入框里正在输入的 @ 片段 */
export interface MentionToken {
  /** '@' 在文本中的下标 */
  start: number;
  /** '@' 之后到光标前的查询串（可为空） */
  query: string;
}

/** 允许出现在 @ 查询串中的字符：标识符字符与 schema 分隔点 */
const MENTION_QUERY_RE = /^[\w$.]*$/;

/**
 * 找出光标前正在输入的 @token。
 * 规则：'@' 前必须是行首或空白（避免把邮箱 / MySQL 变量 @@x 当成引用），'@' 与光标之间不能有空白。
 */
export function findMentionToken(
  text: string,
  cursor: number,
): MentionToken | null {
  const s = String(text || '');
  const pos = Math.max(0, Math.min(cursor, s.length));
  const at = s.lastIndexOf('@', pos - 1);
  if (at < 0) return null;
  // '@' 之前必须是边界
  if (at > 0 && !/\s|[(（,，、]/.test(s[at - 1]!)) return null;
  // '@@' 是数据库变量
  if (s[at + 1] === '@') return null;
  const query = s.slice(at + 1, pos);
  if (!MENTION_QUERY_RE.test(query)) return null;
  return { start: at, query };
}

/**
 * 用选中的表名替换 @query，表名用反引号包裹（PromptBuilder 以反引号识别显式引用）。
 * 返回新文本与新光标位置。
 */
export function applyMention(
  text: string,
  token: MentionToken,
  cursor: number,
  tableName: string,
): { text: string; cursor: number } {
  const s = String(text || '');
  const insert = `\`${tableName}\` `;
  const next = s.slice(0, token.start) + insert + s.slice(cursor);
  return { text: next, cursor: token.start + insert.length };
}

/**
 * 表名候选：前缀命中优先，其次包含；同级按长度与字典序。
 */
export function matchTableMentions(
  tables: string[],
  query: string,
  limit = 8,
): string[] {
  const q = String(query || '').toLowerCase();
  const seen = new Set<string>();
  const scored: { name: string; score: number }[] = [];
  for (const raw of tables || []) {
    const name = String(raw || '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!q) {
      scored.push({ name, score: 2 });
      continue;
    }
    if (key.startsWith(q)) scored.push({ name, score: 0 });
    else if (key.includes(q)) scored.push({ name, score: 1 });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.name.length - b.name.length ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return scored.slice(0, limit).map((x) => x.name);
}

/**
 * 从消息文本中提取用反引号显式引用、且确实存在于当前实例的表名（大小写不敏感，保留库中原名）。
 */
export function extractMentionedTables(text: string, tables: string[]): string[] {
  const s = String(text || '');
  if (!s.includes('`') || !tables?.length) return [];
  const byLower = new Map<string, string>();
  for (const t of tables) {
    if (t) byLower.set(String(t).toLowerCase(), String(t));
  }
  const out: string[] = [];
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const hit = byLower.get(m[1]!.trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** 快捷指令定义 */
export interface ComposerChip {
  label: string;
  scene: AgentScene;
  tpl: string;
  /** 需要先有选中 SQL 才有意义（无选中时降权） */
  needsSelection?: boolean;
  /** 报错场景专用 */
  forError?: boolean;
}

/** 模板中的光标占位符；填入后光标停在此处（通常紧跟 @ 以便直接弹出表名补全） */
export const CURSOR_MARK = '\u2038';

/**
 * 去掉模板中的光标占位符并返回光标位置；无占位符时光标在末尾。
 */
export function resolveTemplate(tpl: string): { text: string; cursor: number } {
  const s = String(tpl || '');
  const idx = s.indexOf(CURSOR_MARK);
  if (idx < 0) return { text: s, cursor: s.length };
  return { text: s.slice(0, idx) + s.slice(idx + CURSOR_MARK.length), cursor: idx };
}

/** SQL 客户端场景的全部快捷指令（源文案中文，展示时走 translateUiText） */
export const SQL_CHIPS: ComposerChip[] = [
  { label: '生成 SQL', scene: 'sql', tpl: '请根据需求编写 SQL：' },
  {
    label: '修复报错',
    scene: 'sql',
    tpl: '请根据报错修复 SQL。',
    forError: true,
    needsSelection: true,
  },
  {
    label: '优化这段 SQL',
    scene: 'sql',
    tpl: '请优化这段 SQL：先 explain_sql 原 SQL 定位瓶颈，改写后再 explain_sql 对比，并给出建议的索引。',
    needsSelection: true,
  },
  {
    label: '解释这段 SQL',
    scene: 'sql',
    tpl: '请逐段解释这段 SQL 在做什么，涉及哪些表和关联，不要改写。',
    needsSelection: true,
  },
  {
    label: '检查索引与计划',
    scene: 'sql',
    tpl: '请用 explain_sql 分析这段 SQL 的执行计划，结合 get_table_schema 的现有索引，指出全表扫描、缺索引、排序/临时表等问题并给出索引 DDL。',
    needsSelection: true,
  },
  {
    label: '表数据画像',
    scene: 'sql',
    tpl: `请用 profile_table 分析表 @${CURSOR_MARK} 的数据分布，指出空值率高、取值倾斜以及适合建索引的列。`,
  },
  {
    label: '生成测试数据',
    scene: 'sql',
    tpl: `请为表 @${CURSOR_MARK} 生成 20 行贴近业务的测试数据 INSERT，外键取库中真实存在的值。`,
  },
  {
    label: '转换方言',
    scene: 'sql',
    tpl: '请把这段 SQL 转换为 MySQL / PostgreSQL / Oracle / SQL Server（请改成目标方言）的写法，保持语义一致，并逐项说明差异。',
    needsSelection: true,
  },
  { label: '生成图表', scene: 'chart', tpl: '请根据需求生成统计图表：' },
  {
    label: '写表说明文档',
    scene: 'schema_doc',
    tpl: '请为相关表补充结构说明文档。',
  },
];

/** ETL 场景快捷指令 */
export const ETL_CHIPS: ComposerChip[] = [
  {
    label: '创建数据同步',
    scene: 'etl',
    tpl: '请根据工作区的真实表结构创建数据同步：',
  },
  {
    label: '先取条件再同步',
    scene: 'etl',
    tpl: '从 B 获取水位，作为 A 多表关联查询的条件，再更新插入 B，请先检查源和目标字段。',
  },
  {
    label: '解释配置',
    scene: 'etl',
    tpl: '请解释当前 ETL 配置及操作方法，不要修改配置。',
  },
  {
    label: '排查和优化',
    scene: 'etl',
    tpl: '请检查当前 ETL 的依赖、权限、字段映射及性能风险。',
  },
];

/**
 * 按当前上下文给快捷指令排序：
 * 有报错 → 「修复报错」置顶；有选中 SQL → 依赖选中的指令靠前；否则依赖选中的指令靠后。
 * 返回 [主行展示, 折叠到「更多」] 两段。
 */
export function arrangeChips(
  chips: ComposerChip[],
  ctx: { hasError?: boolean; hasSelection?: boolean },
  primaryCount = 5,
): { primary: ComposerChip[]; more: ComposerChip[] } {
  const rank = (c: ComposerChip) => {
    if (c.forError) return ctx.hasError ? -2 : 3;
    if (c.needsSelection) return ctx.hasSelection ? -1 : 2;
    return 0;
  };
  const sorted = chips
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
  return {
    primary: sorted.slice(0, primaryCount),
    more: sorted.slice(primaryCount),
  };
}
