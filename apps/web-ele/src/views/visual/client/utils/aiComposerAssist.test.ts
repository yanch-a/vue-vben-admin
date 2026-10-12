/**
 * AI 输入框辅助函数：@ 识别、替换、候选匹配、显式引用提取、指令排序。
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import {
  applyMention,
  arrangeChips,
  CURSOR_MARK,
  extractMentionedTables,
  findMentionToken,
  matchTableMentions,
  resolveTemplate,
  SQL_CHIPS,
  type ComposerChip,
} from './aiComposerAssist';

describe('findMentionToken', () => {
  it('识别行首与空白后的 @ 片段', () => {
    expect(findMentionToken('@t_us', 5)).toEqual({ start: 0, query: 't_us' });
    expect(findMentionToken('查一下 @ord', 8)).toEqual({ start: 4, query: 'ord' });
    expect(findMentionToken('查一下 @', 5)).toEqual({ start: 4, query: '' });
  });

  it('忽略邮箱、MySQL 变量和含空白的片段', () => {
    expect(findMentionToken('a@b.com', 7)).toBeNull();
    expect(findMentionToken('select @@version', 16)).toBeNull();
    expect(findMentionToken('@t_user 的数据', 10)).toBeNull();
  });
});

describe('applyMention', () => {
  it('用反引号表名替换 @ 片段并把光标放到其后', () => {
    // 光标在 "@t_u" 之后（下标 7）
    const token = findMentionToken('分析 @t_u 的分布', 7)!;
    expect(token).toEqual({ start: 3, query: 't_u' });
    const res = applyMention('分析 @t_u 的分布', token, 7, 't_user');
    expect(res.text).toBe('分析 `t_user`  的分布');
    expect(res.cursor).toBe('分析 `t_user` '.length);
  });
});

describe('matchTableMentions', () => {
  it('前缀优先、其次包含、去重且限量', () => {
    const tables = ['sys_user', 't_user', 't_user_role', 'order', 'T_USER', 'user'];
    // 前缀命中 user 在前；包含命中按长度排序；T_USER 与 t_user 去重
    expect(matchTableMentions(tables, 'user')).toEqual(['user', 't_user', 'sys_user', 't_user_role']);
    expect(matchTableMentions(tables, '', 2)).toHaveLength(2);
    expect(matchTableMentions(tables, 'zzz')).toEqual([]);
  });
});

describe('extractMentionedTables', () => {
  it('只提取真实存在的表，大小写不敏感并保留库中原名', () => {
    const tables = ['T_User', 't_order'];
    expect(
      extractMentionedTables('对比 `t_user` 与 `t_order`，还有 `not_a_table`', tables),
    ).toEqual(['T_User', 't_order']);
    expect(extractMentionedTables('没有引用', tables)).toEqual([]);
  });
});

describe('resolveTemplate', () => {
  it('去掉光标占位符并返回位置', () => {
    expect(resolveTemplate(`分析表 @${CURSOR_MARK} 的分布`)).toEqual({
      text: '分析表 @ 的分布',
      cursor: 5,
    });
    expect(resolveTemplate('无占位')).toEqual({ text: '无占位', cursor: 3 });
  });
});

describe('arrangeChips', () => {
  const chips: ComposerChip[] = [
    { label: 'A', scene: 'sql', tpl: '' },
    { label: 'Fix', scene: 'sql', tpl: '', forError: true, needsSelection: true },
    { label: 'Opt', scene: 'sql', tpl: '', needsSelection: true },
    { label: 'B', scene: 'sql', tpl: '' },
  ];

  it('有报错时修复置顶，有选中时依赖选中的指令靠前', () => {
    expect(arrangeChips(chips, { hasError: true, hasSelection: true }, 4).primary.map((c) => c.label)).toEqual([
      'Fix',
      'Opt',
      'A',
      'B',
    ]);
    expect(arrangeChips(chips, { hasSelection: true }, 4).primary.map((c) => c.label)).toEqual([
      'Opt',
      'A',
      'B',
      'Fix',
    ]);
  });

  it('无上下文时依赖选中的指令靠后并折叠到更多', () => {
    const res = arrangeChips(chips, {}, 2);
    expect(res.primary.map((c) => c.label)).toEqual(['A', 'B']);
    expect(res.more.map((c) => c.label)).toEqual(['Opt', 'Fix']);
  });

  it('SQL 预置指令首行默认不超过 5 个且包含生成 SQL', () => {
    const res = arrangeChips(SQL_CHIPS, {});
    expect(res.primary).toHaveLength(5);
    expect(res.primary[0]!.label).toBe('生成 SQL');
    expect(res.primary.length + res.more.length).toBe(SQL_CHIPS.length);
  });
});
