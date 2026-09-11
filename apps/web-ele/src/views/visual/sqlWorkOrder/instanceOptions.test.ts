import { describe, expect, it } from 'vitest';

import { normalizeInstanceNames } from './instanceOptions';

describe('SQL 工单实例选项', () => {
  it('从实例树提取名称而不是把对象渲染成 JSON', () => {
    const response = {
      data: [{ instances: [{ instanceName: 'app_db' }, { instanceName: 'audit_db' }] }],
    };
    expect(normalizeInstanceNames(response)).toEqual(['app_db', 'audit_db']);
  });

  it('支持多个树节点、字符串兼容值并去重', () => {
    const response = [
      { instances: [{ name: 'public' }, 'tenant_a'] },
      { instances: [{ instanceName: 'public' }, null] },
    ];
    expect(normalizeInstanceNames(response)).toEqual(['public', 'tenant_a']);
  });
});
