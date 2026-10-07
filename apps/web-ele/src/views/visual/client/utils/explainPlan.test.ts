import type { ExplainPlanNode, ExplainPlanResult } from './explainPlan';

import { describe, expect, it } from 'vitest';

import enUiText from '../../../../locales/langs/en-US/ui-text.json';
import {
  ACCESS_TYPE_TEXT,
  accessTypeTagType,
  accessTypeText,
  ancestorIds,
  buildAiOptimizePrompt,
  flattenPlan,
  formatPlanMs,
  formatPlanNumber,
  indexPlanNodes,
  planBarPercent,
  planNodeDetailFields,
  planNodeLabel,
  planTreeText,
  supportsExplain,
  supportsExplainAnalyze,
  PLAN_WARNING_TEXT,
  warningLevelText,
  warningSuggestion,
  warningTagType,
  warningTitle,
} from './explainPlan';

function tree(): ExplainPlanNode {
  return {
    id: 'n1',
    depth: 0,
    operation: 'Hash Join',
    accessType: 'JOIN',
    estCost: 100,
    costShare: 0.2,
    children: [
      {
        id: 'n2',
        depth: 1,
        operation: 'Seq Scan',
        objectName: 'orders',
        alias: 'o',
        accessType: 'FULL_SCAN',
        estRows: 120_000,
        estCost: 70,
        costShare: 0.7,
        timeShare: 0.9,
        condition: 'Filter: (status = 1)',
        children: [],
      },
      {
        id: 'n3',
        depth: 1,
        operation: 'Hash',
        accessType: 'TEMP',
        children: [
          {
            id: 'n4',
            depth: 2,
            operation: 'Index Scan',
            objectName: 'users',
            indexName: 'users_pkey',
            accessType: 'INDEX_RANGE',
            estRows: 80,
            actualRows: 8000,
            actualTimeMs: 0.3,
            children: [],
          },
        ],
      },
    ],
  };
}

describe('explainPlan helpers', () => {
  it('flattens tree and respects collapsed nodes', () => {
    const root = tree();
    expect(flattenPlan(root).map((r) => r.node.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
    const rows = flattenPlan(root, new Set(['n3']));
    expect(rows.map((r) => r.node.id)).toEqual(['n1', 'n2', 'n3']);
    expect(rows[2]).toMatchObject({ depth: 1, hasChildren: true, expanded: false });
    expect(flattenPlan(null)).toEqual([]);
  });

  it('indexes nodes and finds ancestors', () => {
    const root = tree();
    expect(indexPlanNodes(root).get('n4')?.indexName).toBe('users_pkey');
    expect(ancestorIds(root, 'n4')).toEqual(['n1', 'n3']);
    expect(ancestorIds(root, 'n1')).toEqual([]);
    expect(ancestorIds(root, 'missing')).toEqual([]);
  });

  it('computes bar percent by cost or time', () => {
    const scan = tree().children![0]!;
    expect(planBarPercent(scan)).toBe(70);
    expect(planBarPercent(scan, true)).toBe(90);
    expect(planBarPercent({ id: 'x', depth: 0 })).toBeNull();
    expect(planBarPercent({ id: 'x', depth: 0, costShare: 1.4 })).toBe(100);
  });

  it('formats numbers and durations', () => {
    expect(formatPlanNumber(null)).toBe('-');
    expect(formatPlanNumber(42)).toBe('42');
    expect(formatPlanNumber(3.14159)).toBe('3.14');
    expect(formatPlanNumber(12_500)).toBe('12.5K');
    expect(formatPlanNumber(2_000_000)).toBe('2M');
    expect(formatPlanMs(0.0123)).toBe('0.012 ms');
    expect(formatPlanMs(85.31)).toBe('85.3 ms');
    expect(formatPlanMs(1500)).toBe('1.5 s');
    expect(formatPlanMs(undefined)).toBe('-');
  });

  it('labels nodes and access types', () => {
    const scan = tree().children![0]!;
    expect(planNodeLabel(scan)).toBe('Seq Scan · orders o');
    expect(planNodeLabel({ id: 'a', depth: 0, operation: 'Table scan on o', objectName: 'o' })).toBe(
      'Table scan on o',
    );
    expect(accessTypeText('FULL_SCAN')).toBe('全表扫描');
    expect(accessTypeText('CUSTOM')).toBe('CUSTOM');
    expect(accessTypeTagType('FULL_SCAN')).toBe('danger');
    expect(accessTypeTagType('INDEX_LOOKUP')).toBe('success');
    expect(accessTypeTagType('SORT')).toBe('warning');
    expect(accessTypeTagType(undefined)).toBe('info');
  });

  it('maps warnings to catalog text with backend fallback', () => {
    expect(warningTitle({ code: 'FILESORT', level: 'MEDIUM' })).toBe('额外排序（filesort）');
    expect(warningSuggestion({ code: 'MISSING_INDEX', level: 'HIGH' })).toContain('联合索引');
    expect(warningTitle({ code: 'NEW_CODE', level: 'LOW', message: 'backend msg' })).toBe('backend msg');
    expect(warningSuggestion({ code: 'NEW_CODE', level: 'LOW', suggestion: 's' })).toBe('s');
    expect(warningTagType('HIGH')).toBe('danger');
    expect(warningTagType('MEDIUM')).toBe('warning');
    expect(warningTagType('LOW')).toBe('info');
    expect(warningLevelText('HIGH')).toBe('高危');
    expect(warningLevelText('MEDIUM')).toBe('中危');
    expect(warningLevelText(undefined)).toBe('低危');
  });

  it('has English UI text for every dynamic plan label', () => {
    const catalog = enUiText as Record<string, string>;
    const keys = [
      ...Object.values(ACCESS_TYPE_TEXT),
      ...Object.values(PLAN_WARNING_TEXT).flatMap((w) => [w.title, w.suggestion]),
      ...['HIGH', 'MEDIUM', 'LOW'].map((l) => warningLevelText(l)),
    ];
    const node: ExplainPlanNode = {
      id: 'n1',
      depth: 0,
      operation: 'Seq Scan',
      objectName: 't',
      alias: 'a',
      indexName: 'i',
      accessType: 'FULL_SCAN',
      estRows: 1,
      estCost: 1,
      selfCost: 1,
      costShare: 1,
      actualRows: 1,
      loops: 1,
      actualTimeMs: 1,
      selfTimeMs: 1,
      timeShare: 1,
      condition: 'x',
      detail: 'd',
    };
    keys.push(...planNodeDetailFields(node).map((f) => f.label));
    expect(keys.filter((k) => !catalog[k])).toEqual([]);
  });

  it('knows which engines support explain / analyze', () => {
    expect(supportsExplainAnalyze('MY_SQL')).toBe(true);
    expect(supportsExplainAnalyze('POSTGRE_SQL')).toBe(true);
    expect(supportsExplainAnalyze('GAUSSDB')).toBe(true);
    expect(supportsExplainAnalyze('H2')).toBe(true);
    expect(supportsExplainAnalyze('ORACLE')).toBe(true);
    expect(supportsExplainAnalyze('SQLITE')).toBe(true);
    expect(supportsExplainAnalyze('SQL_SERVER')).toBe(true);
    expect(supportsExplainAnalyze('MONGODB')).toBe(false);
    expect(supportsExplain('MONGODB')).toBe(false);
    expect(supportsExplain('DM')).toBe(true);
  });

  it('renders tree text and AI prompt', () => {
    const plan: ExplainPlanResult = {
      supported: true,
      structured: true,
      analyzed: true,
      engine: 'PostgreSQL 15.4',
      root: tree(),
      warnings: [
        { code: 'MISSING_INDEX', level: 'MEDIUM', message: '表 orders 全表扫描后再过滤' },
      ],
    };
    const text = planTreeText(plan.root);
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toContain('  - Seq Scan · orders o | access=FULL_SCAN | rows≈120K | cost=70');
    expect(text).toContain('index=users_pkey');
    const prompt = buildAiOptimizePrompt('SELECT * FROM orders o JOIN users u ON u.id = o.user_id', plan);
    expect(prompt).toContain('PostgreSQL 15.4');
    expect(prompt).toContain('EXPLAIN ANALYZE');
    expect(prompt).toContain('[MEDIUM] 表 orders 全表扫描后再过滤');
    expect(prompt).toContain('SELECT * FROM orders o');
    expect(buildAiOptimizePrompt('SELECT 1', { ...plan, structured: false, rawText: 'RAW PLAN' })).toContain(
      'RAW PLAN',
    );
    expect(buildAiOptimizePrompt('SELECT 1', plan, 50).length).toBeLessThanOrEqual(54);
  });

  it('builds node detail fields without empty values', () => {
    const fields = planNodeDetailFields(tree().children![1]!.children![0]!);
    const labels = fields.map((f) => f.label);
    expect(labels).toContain('索引');
    expect(labels).toContain('实际行数');
    expect(labels).not.toContain('条件');
    expect(fields.find((f) => f.label === '实际耗时')?.value).toBe('0.3 ms');
  });
});
