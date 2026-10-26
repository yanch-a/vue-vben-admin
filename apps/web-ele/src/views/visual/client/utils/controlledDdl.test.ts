import { describe, expect, it } from 'vitest';

import { isFlushPrivileges, looksLikeControlledDdl } from './controlledDdl';
import { describeSqlWriteRisk, isWriteOrDangerousSql } from './sqlWriteGuard';

describe('FLUSH PRIVILEGES', () => {
  it('只把重新加载权限表识别为受控语句', () => {
    expect(isFlushPrivileges('flush privileges;')).toBe(true);
    expect(isFlushPrivileges('/* reload */ FLUSH LOCAL PRIVILEGES')).toBe(true);
    expect(isFlushPrivileges('FLUSH NO_WRITE_TO_BINLOG PRIVILEGES')).toBe(true);
    expect(looksLikeControlledDdl('FLUSH PRIVILEGES')).toBe(true);
    expect(isWriteOrDangerousSql('FLUSH PRIVILEGES')).toBe(true);
    expect(describeSqlWriteRisk('FLUSH PRIVILEGES')).toContain('刷新权限');
  });

  it('不放行会锁表或轮转日志的 FLUSH', () => {
    expect(isFlushPrivileges('FLUSH TABLES')).toBe(false);
    expect(isFlushPrivileges('FLUSH TABLES WITH READ LOCK')).toBe(false);
    expect(isFlushPrivileges('FLUSH PRIVILEGES, TABLES')).toBe(false);
    expect(isFlushPrivileges('FLUSH LOGS')).toBe(false);
    expect(looksLikeControlledDdl('FLUSH TABLES')).toBe(false);
    expect(looksLikeControlledDdl('GRANT SELECT ON t TO u')).toBe(true);
  });
});
