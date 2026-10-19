import { describe, expect, it } from 'vitest';

import {
  applyJdbcParams,
  buildJdbcUrl,
  DB_TYPE_REGISTRY,
  instanceLabelOf,
  jdbcParamsError,
} from './dbTypes';

const SUPPORTED_DB_TYPES = [
  'MY_SQL',
  'ORACLE',
  'POSTGRE_SQL',
  'SQL_SERVER',
  'DM',
  'KINGBASE',
  'HIGHGO',
  'OCEANBASE',
  'OCEANBASE_MYSQL',
  'OCEANBASE_ORACLE',
  'GAUSSDB',
  'TDSQL',
  'POLARDB',
  'POLARDB_MYSQL',
  'POLARDB_PG',
  'SQLITE',
  'H2',
  'MONGODB',
] as const;

describe('18 个数据库产品注册', () => {
  it('每个产品都有完整的前端描述，并与连接 URL 语义一致', () => {
    expect(Object.keys(DB_TYPE_REGISTRY).sort()).toEqual(
      [...SUPPORTED_DB_TYPES].sort(),
    );

    for (const code of SUPPORTED_DB_TYPES) {
      const descriptor = DB_TYPE_REGISTRY[code]!;
      expect(descriptor.code).toBe(code);
      expect(descriptor.family).toBeTruthy();
      expect(descriptor.urlTemplate).toContain('{database}');
      const url = buildJdbcUrl(code, { host: 'db-host', database: 'app_db' });
      expect(url).toContain('app_db');
      if (descriptor.connectionForm !== 'FILE') {
        expect(url).toContain('db-host');
      }
    }
  });

  it('区分 Oracle 服务数据库、达梦/H2 Schema 和 SQLite 文件库', () => {
    expect(DB_TYPE_REGISTRY.ORACLE!.instanceKind).toBe('DATABASE');
    expect(DB_TYPE_REGISTRY.OCEANBASE_ORACLE!.instanceKind).toBe('DATABASE');
    expect(DB_TYPE_REGISTRY.DM!.instanceKind).toBe('SCHEMA');
    expect(DB_TYPE_REGISTRY.H2!.instanceKind).toBe('SCHEMA');
    expect(DB_TYPE_REGISTRY.SQLITE!.connectionForm).toBe('FILE');
    expect(instanceLabelOf('ORACLE')).toBe('数据库');
    expect(instanceLabelOf('DM')).toBe('模式');
  });

  it('额外参数覆盖 MySQL 默认 useSSL 和编码，并保留其它默认项', () => {
    const base = buildJdbcUrl('MY_SQL', {
      host: '127.0.0.1',
      port: 3306,
      database: 'app',
    });
    const merged = applyJdbcParams(
      base,
      'useSSL=true&characterEncoding=utf8mb4',
      'MY_SQL',
    );
    expect(merged).toContain('useSSL=true');
    expect(merged).not.toContain('useSSL=false');
    expect(merged).toContain('characterEncoding=utf8mb4');
    expect(merged).toContain('serverTimezone=Asia/Shanghai');
    expect(jdbcParamsError('useSSL')).toContain('key=value');
  });

  it('SQL Server 参数使用分号，并覆盖 encrypt', () => {
    const merged = applyJdbcParams(
      'jdbc:sqlserver://10.0.0.8:1433;databaseName=app;encrypt=false',
      'encrypt=true;trustServerCertificate=true',
      'SQL_SERVER',
    );
    expect(merged).toBe(
      'jdbc:sqlserver://10.0.0.8:1433;databaseName=app;encrypt=true;trustServerCertificate=true',
    );
  });
});
