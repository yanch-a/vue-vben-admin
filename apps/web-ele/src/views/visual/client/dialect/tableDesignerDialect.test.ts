import type { TableDesignModel } from './tableDesignerDialect';

/**
 * 表设计器方言回归测试：确保已登记的每一种数据库产品都能生成可预览、可执行的建表语句。
 *
 * @author yanch
 */
import { describe, expect, it } from 'vitest';

import { DB_TYPE_REGISTRY } from './dbTypes';
import {
  generateTableDesignSql,
  resolveTableDesignerProfile,
  splitColumnType,
} from './tableDesignerDialect';

function createModel(dbType: string): TableDesignModel {
  const profile = resolveTableDesignerProfile(dbType);
  return {
    columns: [
      {
        autoIncrement: profile.family !== 'MONGODB_LIKE',
        comment: '主键',
        dataType:
          profile.family === 'MONGODB_LIKE'
            ? 'objectId'
            : profile.defaultType,
        length: '',
        scale: '',
        defaultValue: '',
        id: 'column-id',
        name: profile.family === 'MONGODB_LIKE' ? '_id' : 'id',
        nullable: false,
        primary: true,
      },
    ],
    comment: '测试表',
    foreignKeys: [],
    indexes: [],
    options: {},
    tableName: 'designer_test',
  };
}

describe('表设计器数据库适配', () => {
  it('全部已登记数据库产品都能生成创建语句', () => {
    for (const dbType of Object.keys(DB_TYPE_REGISTRY)) {
      const result = generateTableDesignSql({
        dbType,
        mode: 'create',
        model: createModel(dbType),
        schema: '',
      });
      expect(result.errors, dbType).toEqual([]);
      expect(result.statements.length, dbType).toBeGreaterThan(0);
      expect(result.sql, dbType).toContain('designer_test');
    }
  });

  it('字段类型与长度、精度、小数位独立生成', () => {
    const model = createModel('MY_SQL');
    model.columns.push({
      autoIncrement: false,
      comment: '',
      dataType: 'VARCHAR',
      defaultValue: '',
      id: 'column-name',
      length: '120',
      name: 'name',
      nullable: false,
      primary: false,
      scale: '',
    });
    model.columns.push({
      autoIncrement: false,
      comment: '',
      dataType: 'DECIMAL',
      defaultValue: '0',
      id: 'column-amount',
      length: '18',
      name: 'amount',
      nullable: false,
      primary: false,
      scale: '4',
    });
    const result = generateTableDesignSql({
      dbType: 'MY_SQL', mode: 'create', model, schema: 'demo',
    });
    expect(result.sql).toContain('VARCHAR(120)');
    expect(result.sql).toContain('DECIMAL(18,4)');
    expect(resolveTableDesignerProfile('MY_SQL').types).not.toContain('VARCHAR(255)');
    expect(splitColumnType('nvarchar(max)', -1, 0, 'SQLSERVER_LIKE'))
      .toEqual({ dataType: 'nvarchar', length: 'max', scale: '' });
    expect(splitColumnType('VARCHAR2(30 CHAR)', 30, 0, 'ORACLE_LIKE'))
      .toEqual({ dataType: 'VARCHAR2', length: '30 CHAR', scale: '' });
  });

  it('只修改表名时不重新校验未修改字段的历史长度表达式', () => {
    const original = createModel('ORACLE');
    original.tableName = 'OLD_TABLE';
    original.columns[0]!.name = 'CUSTOM_ORDER';
    original.columns[0]!.originalName = 'CUSTOM_ORDER';
    original.columns[0]!.dataType = 'VARCHAR2';
    original.columns[0]!.length = 'legacy native length';
    original.columns[0]!.autoIncrement = false;
    const changed: TableDesignModel = JSON.parse(JSON.stringify(original));
    changed.tableName = 'NEW_TABLE';
    const result = generateTableDesignSql({
      dbType: 'ORACLE', mode: 'alter', model: changed, original, schema: 'DEMO',
    });
    expect(result.errors).toEqual([]);
    expect(result.sql).toContain('RENAME TO "NEW_TABLE"');
  });

  it('SQL Server 修改默认值会使用元数据中的默认约束名', () => {
    const original = createModel('SQL_SERVER');
    original.columns[0]!.originalName = 'id';
    original.columns[0]!.defaultValue = '((0))';
    original.columns[0]!.defaultConstraintName = 'DF_demo_id';
    const changed: TableDesignModel = JSON.parse(JSON.stringify(original));
    changed.columns[0]!.defaultValue = '1';
    const result = generateTableDesignSql({
      dbType: 'SQL_SERVER', mode: 'alter', model: changed, original, schema: 'dbo',
    });
    expect(result.errors).toEqual([]);
    expect(result.sql).toContain('DROP CONSTRAINT [DF_demo_id]');
    expect(result.sql).toContain('DEFAULT 1 FOR [id]');
  });

  it('PostgreSQL 修改自增字段类型不会生成非法 SERIAL 类型变更', () => {
    const original = createModel('POSTGRE_SQL');
    original.columns[0]!.originalName = 'id';
    const changed: TableDesignModel = JSON.parse(JSON.stringify(original));
    changed.columns[0]!.dataType = 'INTEGER';
    const result = generateTableDesignSql({
      dbType: 'POSTGRE_SQL', mode: 'alter', model: changed, original, schema: 'public',
    });
    expect(result.errors).toEqual([]);
    expect(result.sql).toContain('TYPE INTEGER');
    expect(result.sql).not.toContain('TYPE SERIAL');
  });

  it('各方言暴露真实索引类型并生成对应语法', () => {
    const cases = [
      ['MY_SQL', 'FULLTEXT', 'CREATE FULLTEXT INDEX', 'VARCHAR'],
      ['POSTGRE_SQL', 'GIN', 'USING GIN', 'JSONB'],
      ['ORACLE', 'BITMAP', 'CREATE BITMAP INDEX', 'NUMBER'],
      ['SQL_SERVER', 'NONCLUSTERED COLUMNSTORE', 'CREATE NONCLUSTERED COLUMNSTORE INDEX', 'BIGINT'],
      ['H2', 'SPATIAL', 'CREATE SPATIAL INDEX', 'GEOMETRY'],
    ] as const;
    for (const [dbType, type, expected, dataType] of cases) {
      const model = createModel(dbType);
      model.columns[0]!.dataType = dataType;
      model.columns[0]!.autoIncrement = ['BIGINT', 'NUMBER'].includes(dataType);
      model.indexes.push({
        columns: ['id'], descendingColumns: [], id: `index-${dbType}`, name: 'idx_test', type, unique: false,
      });
      const result = generateTableDesignSql({ dbType, mode: 'create', model, schema: 'demo' });
      expect(result.sql, dbType).toContain(expected);
    }
    expect(resolveTableDesignerProfile('POSTGRE_SQL').indexTypes)
      .toEqual(expect.arrayContaining(['BTREE', 'HASH', 'GIN', 'GIST', 'SPGIST', 'BRIN']));
  });

  it('不合法的数据库专属索引组合会阻止保存', () => {
    const oracle = createModel('ORACLE');
    oracle.indexes.push({
      columns: ['id'], descendingColumns: [], id: 'bitmap', name: 'idx_bitmap', type: 'BITMAP', unique: true,
    });
    const oracleResult = generateTableDesignSql({
      dbType: 'ORACLE', mode: 'create', model: oracle, schema: 'DEMO',
    });
    expect(oracleResult.errors.join('')).toContain('不能设置 UNIQUE');

    const mongo = createModel('MONGODB');
    mongo.indexes.push({
      columns: ['$**'], descendingColumns: [], id: 'wildcard', name: 'idx_wildcard', type: 'WILDCARD', unique: false,
    });
    const mongoResult = generateTableDesignSql({
      dbType: 'MONGODB', mode: 'create', model: mongo, schema: '',
    });
    expect(mongoResult.sql).toContain('"$**": 1');
  });

  it('MySQL 创建表包含字段、索引、外键和表属性', () => {
    const model = createModel('MY_SQL');
    model.options = { charset: 'utf8mb4', engine: 'InnoDB' };
    model.columns.push({
      autoIncrement: false,
      comment: '租户',
      dataType: 'BIGINT',
      length: '',
      scale: '',
      defaultValue: '',
      id: 'column-tenant',
      name: 'tenant_id',
      nullable: false,
      primary: false,
    });
    model.indexes.push({
      columns: ['tenant_id'],
      descendingColumns: ['tenant_id'],
      id: 'index-tenant',
      name: 'idx_designer_tenant',
      type: 'BTREE',
      unique: false,
    });
    model.foreignKeys.push({
      columns: ['tenant_id'],
      id: 'fk-tenant',
      name: 'fk_designer_tenant',
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
      referencedColumns: ['id'],
      referencedSchema: 'demo',
      referencedTable: 'tenant',
    });
    const result = generateTableDesignSql({
      dbType: 'MY_SQL',
      mode: 'create',
      model,
      schema: 'demo',
    });
    expect(result.sql).toContain('FOREIGN KEY');
    expect(result.sql).toContain('CREATE INDEX');
    expect(result.sql).toContain('ENGINE=InnoDB');
    expect(result.sql).toContain('DEFAULT CHARSET=utf8mb4');
    expect(result.sql).toContain('`tenant_id` DESC');
  });

  it('SQLite 对不能直接完成的字段修改给出阻断错误', () => {
    const original = createModel('SQLITE');
    original.columns[0]!.originalName = 'id';
    const changed: TableDesignModel = JSON.parse(JSON.stringify(original));
    changed.columns[0]!.dataType = 'TEXT';
    const result = generateTableDesignSql({
      dbType: 'SQLITE',
      mode: 'alter',
      model: changed,
      original,
      schema: '',
    });
    expect(result.errors.join('')).toContain('SQLite');
  });

  it('MongoDB 字段生成 jsonSchema，索引生成独立命令', () => {
    const model = createModel('MONGODB');
    model.columns.push({
      autoIncrement: false,
      comment: '用户名',
      dataType: 'string',
      length: '',
      scale: '',
      defaultValue: '',
      id: 'column-name',
      name: 'name',
      nullable: false,
      primary: false,
    });
    model.indexes.push({
      columns: ['name'],
      descendingColumns: [],
      id: 'index-name',
      name: 'idx_name',
      type: 'STANDARD',
      unique: true,
    });
    const result = generateTableDesignSql({
      dbType: 'MONGODB',
      mode: 'create',
      model,
      schema: '',
    });
    expect(result.statements).toHaveLength(2);
    expect(result.sql).toContain('$jsonSchema');
    expect(result.sql).toContain('createIndex');
  });

  it('MongoDB 未修改时不生成 collMod，并保留高级校验规则', () => {
    const original = createModel('MONGODB');
    original.columns.push({
      autoIncrement: false,
      comment: '',
      dataType: 'string | null',
      defaultValue: '',
      id: 'column-code',
      length: '',
      name: 'code',
      nullable: true,
      originalName: 'code',
      primary: false,
      scale: '',
    });
    original.options = {
      jsonSchema: JSON.stringify({
        bsonType: 'object',
        properties: { code: { bsonType: ['string', 'null'], pattern: '^[A-Z]+$' } },
      }),
      validationAction: 'error',
      validationLevel: 'strict',
    };
    const unchanged: TableDesignModel = JSON.parse(JSON.stringify(original));
    const noChangeResult = generateTableDesignSql({
      dbType: 'MONGODB', mode: 'alter', model: unchanged, original, schema: '',
    });
    expect(noChangeResult.statements).toEqual([]);

    unchanged.columns[1]!.nullable = false;
    const changedResult = generateTableDesignSql({
      dbType: 'MONGODB', mode: 'alter', model: unchanged, original, schema: '',
    });
    expect(changedResult.sql).toContain('collMod');
    expect(changedResult.sql).toContain('^[A-Z]+$');
    expect(changedResult.sql).toContain('"required":["code"]');
  });
});
