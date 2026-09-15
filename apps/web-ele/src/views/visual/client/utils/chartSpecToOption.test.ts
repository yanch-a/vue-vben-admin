/** 图表布局、JSON 安全性和 SQL 数据合并回归测试。@author yanch */
import { describe, expect, it } from 'vitest';

import {
  chartSpecToOption,
  mergeChartOption,
  parseOptionOverrides,
  type ChartSpec,
} from './chartSpecToOption';

const spec: ChartSpec = {
  chartType: 'bar',
  xField: 'category',
  yFields: ['amount'],
};
const rows = [
  { category: 'A', amount: 10 },
  { category: 'B', amount: 20 },
];

describe('图表自适应布局', () => {
  it('单系列默认隐藏图例，留出更多绘图区', () => {
    const option = chartSpecToOption(spec, [], rows, {
      width: 420,
      height: 230,
    });
    expect(option.legend.show).toBe(false);
    expect(option.grid.top).toBe(8);
    expect(option.series[0].data).toEqual([10, 20]);
  });

  it('小组件自动收紧字号并隐藏多系列图例', () => {
    const option = chartSpecToOption(
      { ...spec, yFields: ['amount', 'count'] },
      [],
      rows,
      { width: 200, height: 100 },
    );
    expect(option.textStyle.fontSize).toBe(10);
    expect(option.legend.show).toBe(false);
    expect(option.grid.bottom).toBe(6);
  });

  it('宽组件默认显示多系列图例', () => {
    const option = chartSpecToOption(
      { ...spec, yFields: ['amount', 'count'] },
      [],
      rows,
      { width: 420, height: 230 },
    );
    expect(option.legend.show).toBe(true);
  });

  it('用户设置优先于自动布局', () => {
    const option = chartSpecToOption(
      {
        ...spec,
        appearance: {
          legend: 'bottom',
          fontSize: 16,
          grid: { left: 2, top: 5 },
          showLabels: true,
          colors: ['#38bdf8', '#34d399'],
        },
      },
      [],
      rows,
      { width: 200, height: 100 },
    );
    expect(option.legend.show).toBe(true);
    expect(option.legend.bottom).toBe(0);
    expect(option.grid).toMatchObject({ left: 2, top: 5, bottom: 34 });
    expect(option.color).toEqual(['#38bdf8', '#34d399']);
    expect(option.series[0].label.show).toBe(true);
  });

  it('饼图尺寸及标签位置不挤占外围空间', () => {
    const option = chartSpecToOption(
      {
        ...spec,
        chartType: 'pie',
        appearance: { pieRadius: 90, legend: 'hidden' },
      },
      [],
      rows,
    );
    expect(option.series[0]).toMatchObject({
      radius: '90%',
      label: { position: 'inside' },
      labelLine: { show: false },
    });
  });

  it('散点图也使用紧凑 grid，覆盖配置不会删除数据', () => {
    const option = chartSpecToOption(
      {
        ...spec,
        chartType: 'scatter',
        xField: 'amount',
        optionOverrides: {
          grid: { left: 1 },
          series: [{ symbolSize: 8 }],
        },
      },
      [],
      rows,
    );
    expect(option.grid.left).toBe(1);
    expect(option.series[0]).toMatchObject({
      type: 'scatter',
      symbolSize: 8,
      data: [
        [10, 10],
        [20, 20],
      ],
    });
  });
});

describe('option 覆盖与 SQL 数据互通', () => {
  it('覆盖系列样式时保留 SQL 数据并继续随 SQL 结果更新', () => {
    const customSpec = {
      ...spec,
      optionOverrides: {
        series: [{ itemStyle: { color: '#ff0000' } }],
        legend: { show: false },
      },
    };
    const first = chartSpecToOption(customSpec, [], rows);
    const updated = chartSpecToOption(
      customSpec,
      [],
      [{ category: 'A', amount: 99 }],
    );
    expect(first.series[0]).toMatchObject({
      type: 'bar',
      data: [10, 20],
      itemStyle: { color: '#ff0000' },
    });
    expect(updated.series[0].data).toEqual([99]);
  });

  it('series 对象等价于覆盖第一个系列，其他系列不会丢失', () => {
    const option = chartSpecToOption(
      {
        ...spec,
        yFields: ['amount', 'count'],
        optionOverrides: { series: { barWidth: 10 } },
      },
      [],
      rows,
    );
    expect(option.series).toHaveLength(2);
    expect(option.series[0].barWidth).toBe(10);
    expect(option.series[1].name).toBe('count');
  });

  it('显式覆盖 data 时允许用户完全替换数据数组', () => {
    const option = chartSpecToOption(
      { ...spec, optionOverrides: { series: [{ data: [7] }] } },
      [],
      rows,
    );
    expect(option.series[0].data).toEqual([7]);
  });

  it('普通数组完整替换，且不修改原配置对象', () => {
    const base = { color: ['red', 'blue'], grid: { left: 8, right: 8 } };
    expect(
      mergeChartOption(base, { color: ['green'], grid: { left: 1 } }),
    ).toEqual({
      color: ['green'],
      grid: { left: 1, right: 8 },
    });
    expect(base.grid.left).toBe(8);
  });

  it('高级设置优先于常用外观，序列化后仍然有效', () => {
    const restored = JSON.parse(
      JSON.stringify({
        ...spec,
        appearance: { legend: 'top' },
        optionOverrides: { legend: { show: false } },
      }),
    );
    expect(chartSpecToOption(restored, [], rows).legend.show).toBe(false);
  });
});

describe('option JSON 校验', () => {
  it('空文本恢复默认，合法对象可用于覆盖', () => {
    expect(parseOptionOverrides('')).toEqual({});
    expect(parseOptionOverrides('{"grid":{"top":4}}')).toEqual({
      grid: { top: 4 },
    });
  });

  it.each([
    '[]',
    'null',
    '123',
    '"hello"',
    '{broken',
    '{"formatter": function() {}}',
  ])('拒绝无效对象或 JavaScript：%s', (text) => {
    expect(() => parseOptionOverrides(text)).toThrow();
  });

  it('递归拒绝原型污染属性，导入的规格也同样校验', () => {
    expect(() =>
      parseOptionOverrides('{"series":[{"__proto__":{"polluted":true}}]}'),
    ).toThrow();
    expect(() =>
      mergeChartOption(
        {},
        JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
      ),
    ).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
});
