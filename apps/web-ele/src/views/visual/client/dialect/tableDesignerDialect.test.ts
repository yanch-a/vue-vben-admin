import type { TableDesignModel } from './tableDesignerDialect';

/**
 * 表设计器方言回归测试：确保已登记的每一种数据库产品都能生成可预览、可执行的建表语句。
 *
 * @author yanch
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';

import { DB_TYPE_REGISTRY } from './dbTypes';
import {
  generateTableDesignSql,
  resolveTableDesignerProfile,
  splitColumnType,
  normalizeColumnTypeSelection,
  validateColumnParameters,
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
  /** 全量菜单项生成合法模型；可导出同一批 SQL 交给隔离测试库实际执行。 @author yanch */
  it('所有类型菜单项都能生成可校验的模型，并可导出实际 DDL 样本', () => {
    const samples: { dbType: string; type: string; statements: string[] }[] = [];
    for (const dbType of ['MY_SQL', 'POSTGRE_SQL', 'ORACLE', 'DM', 'SQL_SERVER', 'H2', 'SQLITE', 'MONGODB']) {
      const profile = resolveTableDesignerProfile(dbType);
      for (const type of profile.types) {
        const model = createModel(dbType); model.comment = ''; model.columns[0]!.comment = '';
        model.tableName = `designer_${samples.length}`;
        const column = { ...model.columns[0]!, id: 'value', name: 'value', dataType: type, primary: false, autoIncrement: false, nullable: true };
        normalizeColumnTypeSelection(column, profile);
        if (['ENUM', 'SET'].includes(type)) column.length = "'a','b'";
        if (type === 'VECTOR') column.length = '1536';
        model.columns.push(column);
        const result = generateTableDesignSql({ dbType, mode: 'create', model, schema: ['MY_SQL', 'POSTGRE_SQL'].includes(dbType) ? 'designer_fixture' : '' });
        expect(result.errors, `${dbType} ${type}`).toEqual([]);
        samples.push({ dbType, type, statements: result.statements });
      }
    }
    for (const [dbType, type, length, scale] of [
      ['MY_SQL', 'CHAR', '0', ''], ['MY_SQL', 'VARCHAR', '0', ''],
      ['MY_SQL', 'DATETIME', '6', ''], ['MY_SQL', 'BIT', '64', ''],
      ['POSTGRE_SQL', 'NUMERIC', '3', '5'], ['POSTGRE_SQL', 'NUMERIC', '4', '-2'],
      ['POSTGRE_SQL', 'NUMERIC[]', '18', '4'], ['POSTGRE_SQL', 'TIMESTAMP WITH TIME ZONE[]', '3', ''],
      ['H2', 'VARCHAR ARRAY', '100', ''], ['H2', 'NUMERIC', '18', '4'],
    ]) {
      const model = createModel(dbType!); model.comment = ''; model.columns[0]!.comment = '';
      model.tableName = `designer_${samples.length}`;
      model.columns.push({ ...model.columns[0]!, id: 'value', name: 'value', dataType: type!, length: length!, scale: scale!, autoIncrement: false, primary: false });
      const result = generateTableDesignSql({ dbType, mode: 'create', model, schema: ['MY_SQL', 'POSTGRE_SQL'].includes(dbType!) ? 'designer_fixture' : '' });
      expect(result.errors).toEqual([]); samples.push({ dbType: dbType!, type: `${type}(${length},${scale})`, statements: result.statements });
    }
    if (process.env.LEMON_DESIGNER_DDL_FILE) writeFileSync(process.env.LEMON_DESIGNER_DDL_FILE, JSON.stringify(samples, null, 2), 'utf8');
  });
  /** 验证过去下拉框遗漏的类型族，而不是只测试默认 BIGINT 主键。 @author yanch */
  it.each([
    ['MY_SQL', ['BIT', 'TINYTEXT', 'LONGBLOB', 'POLYGON', 'BIGINT UNSIGNED']],
    ['POSTGRE_SQL', ['MACADDR', 'INT4RANGE', 'INT4MULTIRANGE', 'UUID[]', 'PATH']],
    ['ORACLE', ['BFILE', 'LONG RAW', 'ROWID', 'UROWID', 'BOOLEAN']],
    ['DM', ['NUMBER', 'NCHAR', 'NCLOB', 'IMAGE', 'INTERVAL DAY TO SECOND']],
    ['SQL_SERVER', ['SQL_VARIANT', 'TEXT', 'NTEXT', 'IMAGE']],
    ['H2', ['ENUM', 'DECFLOAT', 'JAVA_OBJECT', 'INTEGER ARRAY', 'INTERVAL DAY TO SECOND']],
    ['SQLITE', ['INT', 'ANY']],
    ['MONGODB', ['undefined', 'dbPointer', 'symbol']],
  ])('%s 下拉框覆盖遗漏的原生类型', (dbType, expected) => {
    expect(resolveTableDesignerProfile(dbType as string).types).toEqual(expect.arrayContaining(expected as string[]));
  });

  it('类型切换重置参数，完整声明正确拆分，未知类型不追加 JDBC 存储长度', () => {
    const column = createModel('MY_SQL').columns[0]!;
    column.dataType = 'VARCHAR'; column.length = '1000'; column.scale = '5';
    normalizeColumnTypeSelection(column, resolveTableDesignerProfile('MY_SQL'));
    expect(column).toMatchObject({ length: '255', scale: '', autoIncrement: false });
    column.dataType = 'FLOAT'; normalizeColumnTypeSelection(column, resolveTableDesignerProfile('MY_SQL'));
    expect(column.length).toBe('');
    column.dataType = 'DECIMAL(20,6)'; normalizeColumnTypeSelection(column, resolveTableDesignerProfile('MY_SQL'));
    expect(column).toMatchObject({ dataType: 'DECIMAL', length: '20', scale: '6' });
    expect(splitColumnType('INTERVAL DAY(3) TO SECOND(6)', 12, 6, 'ORACLE_LIKE')).toEqual({ dataType: 'INTERVAL DAY(3) TO SECOND(6)', length: '', scale: '' });
    expect(splitColumnType('public.custom_enum', 255, 0, 'POSTGRES_LIKE').length).toBe('');
  });

  it.each([
    ['MY_SQL', 'VARCHAR', '', '', '必须填写长度'],
    ['MY_SQL', 'BIT', '65', '', '64'],
    ['MY_SQL', 'DECIMAL', '66', '2', '65'],
    ['MY_SQL', 'DECIMAL', '', '2', '同时填写精度'],
    ['MY_SQL', 'TIMESTAMP', '7', '', '0–6'],
    ['MY_SQL', 'ENUM', 'a,b', '', '单引号'],
    ['ORACLE', 'NVARCHAR2', '30 CHAR', '', '格式无效'],
    ['SQL_SERVER', 'CHAR', 'MAX', '', '格式无效'],
    ['SQL_SERVER', 'NVARCHAR', '4001', '', '4000'],
    ['SQL_SERVER', 'DATETIME2', '8', '', '0–7'],
    ['DM', 'TIMESTAMP', '7', '', '0–6'],
    ['MONGODB', 'String', '', '', 'BSON'],
  ])('%s %s 阻止无效参数', (dbType, dataType, length, scale, error) => {
    const column = { ...createModel(dbType).columns[0]!, dataType, length, scale, autoIncrement: false, primary: false };
    expect(validateColumnParameters(column, resolveTableDesignerProfile(dbType)).join('')).toContain(error);
  });

  it.each([
    ['POSTGRE_SQL', 'NUMERIC', '3', '5', 'NUMERIC(3,5)'],
    ['POSTGRE_SQL', 'NUMERIC', '4', '-2', 'NUMERIC(4,-2)'],
    ['ORACLE', 'NUMBER', '4', '-2', 'NUMBER(4,-2)'],
    ['ORACLE', 'NUMBER', '3', '5', 'NUMBER(3,5)'],
    ['ORACLE', 'NUMBER', '*', '4', 'NUMBER(*,4)'],
    ['POSTGRE_SQL', 'NUMERIC[]', '18', '4', 'NUMERIC(18,4)[]'],
    ['POSTGRE_SQL', 'TIMESTAMP WITH TIME ZONE[]', '3', '', 'TIMESTAMP(3) WITH TIME ZONE[]'],
    ['H2', 'VARCHAR ARRAY', '100', '', 'VARCHAR(100) ARRAY'],
    ['MY_SQL', 'ENUM', "'a','b(b)'", '', "ENUM('a','b(b)')"],
    ['SQL_SERVER', 'VARBINARY', 'MAX', '', 'VARBINARY(MAX)'],
  ])('%s 合法边界声明 %s', (dbType, dataType, length, scale, expected) => {
    const model = createModel(dbType);
    model.columns.push({ ...model.columns[0]!, id: 'value', name: 'value', dataType, length, scale, autoIncrement: false, primary: false, comment: '' });
    const result = generateTableDesignSql({ dbType, mode: 'create', model, schema: '' });
    expect(result.errors).toEqual([]); expect(result.sql).toContain(expected);
  });

  it('SQLite 阻止复合主键自增、WITHOUT ROWID 自增及 STRICT NUMERIC', () => {
    const model = createModel('SQLITE');
    model.columns.push({ ...model.columns[0]!, name: 'part', id: 'part', autoIncrement: false });
    expect(generateTableDesignSql({ dbType: 'SQLITE', mode: 'create', model, schema: '' }).errors.join('')).toContain('单列');
    model.columns.pop(); model.options.withoutRowid = true;
    expect(generateTableDesignSql({ dbType: 'SQLITE', mode: 'create', model, schema: '' }).errors.join('')).toContain('WITHOUT ROWID');
    model.options = { strict: true }; model.columns[0]!.autoIncrement = false; model.columns[0]!.dataType = 'NUMERIC';
    expect(generateTableDesignSql({ dbType: 'SQLITE', mode: 'create', model, schema: '' }).errors.join('')).toContain('STRICT');
  });

  it('达梦使用 IDENTITY，PostgreSQL 小整数使用 SMALLSERIAL，PostgreSQL 允许多序列列', () => {
    const dm = generateTableDesignSql({ dbType: 'DM', mode: 'create', model: createModel('DM'), schema: '' });
    expect(dm.sql).toContain('IDENTITY(1,1)'); expect(dm.sql).not.toContain('GENERATED BY');
    const model = createModel('POSTGRE_SQL'); model.columns[0]!.dataType = 'SMALLINT';
    model.columns.push({ ...model.columns[0]!, id: 'second', name: 'second', primary: false });
    const result = generateTableDesignSql({ dbType: 'POSTGRE_SQL', mode: 'create', model, schema: '' });
    expect(result.errors).toEqual([]); expect(result.sql).toContain('SMALLSERIAL');
  });

  it('字段改名保留自增主键，显式聚集索引使用非聚集主键，MongoDB 保留 _id 及特殊字段名', () => {
    const original = createModel('MY_SQL'); original.columns[0]!.originalName = 'id';
    const changed: TableDesignModel = JSON.parse(JSON.stringify(original)); changed.columns[0]!.name = 'order_id';
    const mysql = generateTableDesignSql({ dbType: 'MY_SQL', mode: 'alter', model: changed, original, schema: '' });
    expect(mysql.errors).toEqual([]); expect(mysql.sql).not.toContain('DROP PRIMARY KEY');
    const sqlServer = createModel('SQL_SERVER'); sqlServer.indexes.push({ columns: ['id'], descendingColumns: [], id: 'cluster', name: 'idx_cluster', type: 'CLUSTERED', unique: false });
    expect(generateTableDesignSql({ dbType: 'SQL_SERVER', mode: 'create', model: sqlServer, schema: '' }).sql).toContain('PRIMARY KEY NONCLUSTERED');
    const mongo = createModel('MONGODB'); mongo.columns[0]!.dataType = 'string';
    mongo.columns.push({ ...mongo.columns[0]!, name: '__proto__', id: 'proto', primary: false });
    const result = generateTableDesignSql({ dbType: 'MONGODB', mode: 'create', model: mongo, schema: '' });
    expect(result.sql).toContain('"_id":{"bsonType":"string"'); expect(result.sql).toContain('"__proto__":{"bsonType":"string"');
  });

  it('阻止悬空索引、重名索引及必填字段 SET NULL 外键', () => {
    const model = createModel('MY_SQL');
    model.indexes = [{ id: 'a', name: 'idx', type: 'BTREE', unique: false, columns: ['missing'], descendingColumns: [] }, { id: 'b', name: 'idx', type: 'BTREE', unique: false, columns: ['id'], descendingColumns: [] }];
    model.foreignKeys = [{ id: 'fk', name: 'fk', columns: ['id'], referencedSchema: '', referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'SET NULL', onUpdate: 'NO ACTION' }];
    const result = generateTableDesignSql({ dbType: 'MY_SQL', mode: 'create', model, schema: '' });
    expect(result.errors.join('')).toContain('不存在'); expect(result.errors.join('')).toContain('名称重复'); expect(result.errors.join('')).toContain('允许空值');
  });

  it('SQL Server geometry 空间索引验证边界和聚集主键，生成真实 BOUNDING_BOX 参数', () => {
    const model = createModel('SQL_SERVER');
    model.columns.push({ ...model.columns[0]!, id: 'shape', name: 'shape', dataType: 'GEOMETRY', primary: false, autoIncrement: false });
    const index = { id: 'spatial', name: 'idx_shape', type: 'SPATIAL', unique: false, columns: ['shape'], descendingColumns: [], boundingBox: '' };
    model.indexes.push(index);
    expect(generateTableDesignSql({ dbType: 'SQL_SERVER', mode: 'create', model, schema: 'dbo' }).errors.join('')).toContain('边界');
    index.boundingBox = '-180,-90,180,90';
    const valid = generateTableDesignSql({ dbType: 'SQL_SERVER', mode: 'create', model, schema: 'dbo' });
    expect(valid.errors).toEqual([]); expect(valid.sql).toContain('USING GEOMETRY_GRID WITH (BOUNDING_BOX = (-180,-90,180,90))');
    model.columns[0]!.primary = false;
    expect(generateTableDesignSql({ dbType: 'SQL_SERVER', mode: 'create', model, schema: 'dbo' }).errors.join('')).toContain('聚集主键');
  });
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
    expect(changedResult.sql).toContain('"required":["_id","code"]');
  });
});
