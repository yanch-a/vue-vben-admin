/**
 * 图表类型与 SQL 结果列的字段映射说明，供图表编辑器提示用户填写。
 * @author yanch
 */
import type { ChartType } from '#/api/visual/dashboard';

export interface FieldMappingHint {
  /** 一句话说明该类型如何吃 SQL 列 */
  summary: string;
  /** SQL 示例 */
  sqlExample: string;
  /** 各字段含义 */
  fields: Array<{ name: string; required: boolean; desc: string }>;
}

const HINTS: Record<ChartType, FieldMappingHint> = {
  bar: {
    summary: '柱状图：分类在 X 轴，数值在 Y 轴；可用系列字段拆成多组柱。',
    sqlExample: 'SELECT category AS 分类, SUM(amount) AS 金额 FROM t GROUP BY category',
    fields: [
      { name: 'X 字段', required: true, desc: '分类列名，对应 SQL 别名，如「分类」' },
      { name: 'Y 字段', required: true, desc: '数值列，多个用逗号分隔，如「金额,数量」' },
      { name: '系列字段', required: false, desc: '按该列拆系列，如「区域」' },
    ],
  },
  line: {
    summary: '折线图：X 为横轴分类/时间，Y 为数值；系列字段可画多条线。',
    sqlExample: 'SELECT dt AS 日期, value AS 数值 FROM t ORDER BY dt',
    fields: [
      { name: 'X 字段', required: true, desc: '横轴列，如「日期」' },
      { name: 'Y 字段', required: true, desc: '数值列，多个逗号分隔' },
      { name: '系列字段', required: false, desc: '按该列拆多条折线' },
    ],
  },
  area: {
    summary: '面积图：与折线图相同字段映射，Y 值会填充为面积。',
    sqlExample: 'SELECT dt AS 日期, value AS 数值 FROM t ORDER BY dt',
    fields: [
      { name: 'X 字段', required: true, desc: '横轴列' },
      { name: 'Y 字段', required: true, desc: '数值列，多个逗号分隔' },
      { name: '系列字段', required: false, desc: '按该列拆多块面积' },
    ],
  },
  pie: {
    summary: '饼图：X 为扇区名称，Y 取第一个数值字段作为扇区大小。',
    sqlExample: 'SELECT name AS 名称, cnt AS 数量 FROM t',
    fields: [
      { name: 'X 字段', required: true, desc: '扇区名称列，如「名称」' },
      { name: 'Y 字段', required: true, desc: '只填一个数值列，如「数量」' },
      { name: '系列字段', required: false, desc: '饼图忽略系列字段' },
    ],
  },
  scatter: {
    summary: '散点图：X、Y 均为数值；未填 X 时用 Y 的第一个字段作横轴。',
    sqlExample: 'SELECT x_val AS X值, y_val AS Y值 FROM t',
    fields: [
      { name: 'X 字段', required: false, desc: '横轴数值列；空则用 Y 的第一列' },
      { name: 'Y 字段', required: true, desc: '纵轴数值列；也可写两列「X列,Y列」' },
      { name: '系列字段', required: false, desc: '可选分组（当前按单系列绘制）' },
    ],
  },
  kpi: {
    summary: '指标卡：只取结果第一行的一个数值字段展示。',
    sqlExample: 'SELECT SUM(amount) AS 总金额 FROM t',
    fields: [
      { name: 'X 字段', required: false, desc: '不使用' },
      { name: 'Y 字段', required: true, desc: '恰好一个数值列，如「总金额」' },
      { name: '系列字段', required: false, desc: '不使用' },
    ],
  },
  table: {
    summary: '表格：直接展示 SQL 全部列，无需配置 X/Y 映射（仍需任意占位 Y 字段以通过校验时可填第一列）。',
    sqlExample: 'SELECT id, name, amount FROM t LIMIT 100',
    fields: [
      { name: 'X 字段', required: false, desc: '不使用' },
      { name: 'Y 字段', required: true, desc: '校验用，可填任意存在的列名' },
      { name: '系列字段', required: false, desc: '不使用' },
    ],
  },
  text: {
    summary: '文本组件：不执行 SQL，在大屏上展示自定义文案，可调字号与颜色。',
    sqlExample: '无需 SQL',
    fields: [
      { name: '文本内容', required: true, desc: '显示在大屏上的文案' },
      { name: '字号', required: false, desc: 'appearance.fontSize，默认 24' },
    ],
  },
};

/** 返回指定图表类型的字段映射提示；未知类型时给出通用说明。 */
export function getFieldMappingHint(chartType: string): FieldMappingHint {
  return (
    HINTS[chartType as ChartType] || {
      summary: '请将 X/Y 字段填写为 SQL 结果中的列名（或 AS 别名），大小写需与结果列一致。',
      sqlExample: 'SELECT col_a, col_b FROM t',
      fields: [
        { name: 'X 字段', required: false, desc: '分类/名称列' },
        { name: 'Y 字段', required: true, desc: '数值列，逗号分隔' },
      ],
    }
  );
}

export const CHART_TYPE_OPTIONS: Array<{ label: string; value: ChartType }> = [
  { value: 'bar', label: '柱状图 bar' },
  { value: 'line', label: '折线图 line' },
  { value: 'area', label: '面积图 area' },
  { value: 'pie', label: '饼图 pie' },
  { value: 'scatter', label: '散点图 scatter' },
  { value: 'kpi', label: '指标卡 kpi' },
  { value: 'table', label: '表格 table' },
  { value: 'text', label: '文本 text' },
];
