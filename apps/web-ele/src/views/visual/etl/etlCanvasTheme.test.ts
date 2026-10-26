import { describe, expect, it } from 'vitest';

import { ETL_CANVAS_THEMES, etlEdgeLabel, etlFitText, etlGroupAttrs, etlNodeAttrs } from './etlCanvasTheme';

const group = { active: false, count: '· 2 个步骤', current: false, dim: false, disabled: false, hit: false, name: '数据同步', width: 340 };
const node = { accent: '#e6a23c', current: false, dim: false, disabled: false, hit: false, selected: false, title: '写入目标表' };

describe('画布主题样式', () => {
  for (const [name, theme] of Object.entries(ETL_CANVAS_THEMES)) {
    it(`${name}：分组只有 1px 浅色外边框，没有标题栏`, () => {
      const attrs = etlGroupAttrs(theme, group);
      expect(attrs.body.stroke).toBe(theme.groupBorder);
      expect(attrs.body.strokeWidth).toBe(1);
      expect(attrs).not.toHaveProperty('header');
      expect(attrs.label.text).toBe('数据同步');
      expect(attrs.count.fill).toBe(theme.muted);
      expect(attrs.count.refX).toBeGreaterThan(attrs.label.refX);
      const active = etlGroupAttrs(theme, { ...group, active: true });
      expect(active.body.stroke).toBe(theme.groupActiveBorder);
      expect(active.dot.r).toBeGreaterThan(0);
      expect(active.body.fill).toBe(theme.groupActiveFill);
      expect(etlGroupAttrs(theme, { ...group, hit: true }).body.strokeWidth).toBe(1);
    });

    it(`${name}：节点是无边框中性卡片，选中才有主色环`, () => {
      const plain = etlNodeAttrs(theme, node);
      expect(plain.body.stroke).toBe('none');
      expect(plain.body.strokeWidth).toBe(0);
      expect(plain.body.fill).toBe(theme.nodeBase);
      expect(plain.dot.fill).toBe('#e6a23c');
      const selected = etlNodeAttrs(theme, { ...node, selected: true });
      expect(selected.body.stroke).toBe(theme.primary);
      expect(selected.body.strokeWidth).toBe(1.5);
    });

    it(`${name}：连线标签没有白框`, () => {
      const label = etlEdgeLabel(theme, '参数');
      expect(label.attrs.body.stroke).toBe('none');
      expect(label.attrs.body.fill).not.toBe('#fff');
      expect(label.attrs.label.fontSize).toBe(10);
    });
  }

  it('长标题按宽度省略', () => {
    expect(etlFitText('非常非常非常非常长的任务名称', 12, 60)).toMatch(/…$/);
    expect(etlGroupAttrs(ETL_CANVAS_THEMES.light, { ...group, name: '非常非常非常非常非常非常长的任务名称', width: 120 }).label.text).toMatch(/…$/);
  });

  it('节点长标题预截断而不是整段消失', () => {
    const long = '这是一个特别特别特别特别长的步骤标题用来复现不显示';
    const attrs = etlNodeAttrs(ETL_CANVAS_THEMES.light, { ...node, title: long });
    expect(attrs.title.text.length).toBeGreaterThan(0);
    expect(attrs.title.text).toMatch(/…$/);
    expect(attrs.title.text.length).toBeLessThan(long.length);
  });

  it('停用状态单独标红且不拼进名称', () => {
    const attrs = etlGroupAttrs(ETL_CANVAS_THEMES.light, {
      ...group,
      disabled: true,
      status: '停用',
      name: '数据同步',
      width: 340,
    });
    expect(attrs.label.text).toBe('数据同步');
    expect(attrs.status.text).toBe('停用');
    expect(attrs.status.fill).toBe(ETL_CANVAS_THEMES.light.danger);
    expect(attrs.status.refX).toBeGreaterThan(attrs.label.refX);
    expect(attrs.count.refX).toBeGreaterThan(attrs.status.refX);
    expect(attrs.label.fill).toBe(ETL_CANVAS_THEMES.light.text);
  });
});