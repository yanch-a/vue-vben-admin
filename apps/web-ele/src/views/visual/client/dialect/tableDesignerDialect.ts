/**
 * 可视化表设计器的方言定义与 SQL 生成器。
 *
 * <p>数据库产品只在本文件映射一次。组件只操作统一模型，不包含产品判断，后续新增数据库
 * 时只需补充产品类型列表或新增方言族实现。</p>
 *
 * @author yanch
 */
import type { SqlDialectFamily } from './dbTypes';

import { normalizeDbTypeCode, resolveDialectFamily } from './dbTypes';
import { resolveSqlDialect } from './sqlDialect';

export interface TableDesignColumn {
  id: string;
  originalName?: string;
  name: string;
  dataType: string;
  /** 字符长度或数值精度；使用字符串以支持 SQL Server 的 MAX 等原生值。 */
  length: string;
  /** DECIMAL / NUMBER / NUMERIC 的小数位；时间秒精度统一放在 length 输入中。 */
  scale: string;
  nullable: boolean;
  primary: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  /** SQL Server 默认约束名；只用于安全删除旧默认值，不在 UI 中编辑。 */
  defaultConstraintName?: string;
  comment: string;
}

export interface TableDesignIndex {
  id: string;
  originalName?: string;
  name: string;
  unique: boolean;
  type: string;
  columns: string[];
  /** 复合索引中显式指定为 DESC 的字段；未列出的字段使用数据库默认升序。 */
  descendingColumns: string[];
}

export interface TableDesignForeignKey {
  id: string;
  originalName?: string;
  name: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface TableDesignModel {
  originalTableName?: string;
  tableName: string;
  comment: string;
  columns: TableDesignColumn[];
  indexes: TableDesignIndex[];
  foreignKeys: TableDesignForeignKey[];
  options: Record<string, boolean | number | string>;
}

export interface TableDesignerOption {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'boolean' | 'select' | 'text';
  values?: string[];
}

export interface TableDesignerProfile {
  family: SqlDialectFamily;
  productCode: string;
  label: string;
  types: string[];
  defaultType: string;
  indexTypes: string[];
  defaultIndexType: string;
  foreignKeyDeleteActions: string[];
  foreignKeyUpdateActions: string[];
  supportsForeignKeys: boolean;
  supportsColumnComments: boolean;
  options: TableDesignerOption[];
}

export interface TableDesignSqlResult {
  statements: string[];
  sql: string;
  warnings: string[];
  errors: string[];
}

const FAMILY_TYPES: Record<SqlDialectFamily, string[]> = {
  MYSQL_LIKE: [
    'BIGINT', 'INT', 'MEDIUMINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC',
    'FLOAT', 'DOUBLE', 'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR', 'BOOLEAN', 'JSON', 'ENUM',
    'SET', 'BINARY', 'VARBINARY', 'BLOB', 'GEOMETRY', 'POINT',
  ],
  POSTGRES_LIKE: [
    'BIGINT', 'BIGSERIAL', 'INTEGER', 'SERIAL', 'SMALLINT', 'SMALLSERIAL',
    'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION', 'VARCHAR',
    'CHARACTER VARYING', 'CHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIME',
    'TIME WITH TIME ZONE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE',
    'JSON', 'JSONB', 'UUID', 'BYTEA', 'BIT', 'BIT VARYING', 'MONEY', 'INTERVAL',
    'INET', 'CIDR', 'XML', 'TSVECTOR', 'TSQUERY',
  ],
  ORACLE_LIKE: [
    'NUMBER', 'INTEGER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'VARCHAR2', 'NVARCHAR2',
    'CHAR', 'NCHAR', 'CLOB', 'NCLOB', 'DATE', 'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE', 'INTERVAL YEAR TO MONTH',
    'INTERVAL DAY TO SECOND', 'RAW', 'BLOB', 'JSON', 'XMLTYPE',
  ],
  SQLSERVER_LIKE: [
    'BIGINT', 'INT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'MONEY',
    'SMALLMONEY', 'FLOAT', 'REAL', 'NVARCHAR', 'VARCHAR', 'NCHAR', 'CHAR',
    'VARBINARY', 'BINARY', 'BIT', 'DATE', 'TIME', 'DATETIME', 'DATETIME2',
    'DATETIMEOFFSET', 'SMALLDATETIME', 'UNIQUEIDENTIFIER', 'ROWVERSION', 'XML', 'GEOMETRY', 'GEOGRAPHY',
  ],
  SQLITE_LIKE: ['INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC'],
  H2_LIKE: [
    'BIGINT', 'INTEGER', 'SMALLINT', 'TINYINT', 'NUMERIC', 'DECIMAL', 'DOUBLE',
    'REAL', 'VARCHAR', 'CHARACTER VARYING', 'CHAR', 'CLOB', 'BOOLEAN', 'DATE',
    'TIME', 'TIME WITH TIME ZONE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE',
    'UUID', 'JSON', 'BINARY', 'BINARY VARYING', 'BLOB', 'GEOMETRY',
  ],
  MONGODB_LIKE: [
    'objectId', 'string', 'bool', 'int', 'long', 'double', 'decimal', 'date',
    'timestamp', 'object', 'array', 'binData', 'regex', 'javascript',
    'javascriptWithScope', 'minKey', 'maxKey', 'null',
  ],
};

const DM_TYPES = [
  'BIGINT', 'INT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'DOUBLE', 'REAL',
  'VARCHAR', 'VARCHAR2', 'NVARCHAR2', 'CHAR', 'TEXT', 'CLOB', 'DATE', 'TIME',
  'TIMESTAMP', 'BIT', 'BINARY', 'VARBINARY', 'BLOB',
];

/** 返回当前产品的字段、索引及表选项配置。 */
export function resolveTableDesignerProfile(dbType?: null | string): TableDesignerProfile {
  const productCode = normalizeDbTypeCode(dbType);
  const family = resolveDialectFamily(dbType);
  const mysqlOptions: TableDesignerOption[] = [
    { key: 'engine', label: '存储引擎', type: 'select', values: ['InnoDB', 'MyISAM'], placeholder: 'InnoDB' },
    { key: 'charset', label: '字符集', type: 'select', values: ['utf8mb4', 'utf8', 'latin1'], placeholder: 'utf8mb4' },
    { key: 'collation', label: '排序规则', placeholder: 'utf8mb4_general_ci' },
  ];
  const profile: TableDesignerProfile = {
    family,
    productCode,
    label: resolveSqlDialect(dbType).label,
    types: [...FAMILY_TYPES[family]],
    defaultType: FAMILY_TYPES[family][0] || 'VARCHAR(255)',
    indexTypes: ['BTREE'],
    defaultIndexType: 'BTREE',
    foreignKeyDeleteActions: ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT'],
    foreignKeyUpdateActions: ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT'],
    supportsForeignKeys: family !== 'MONGODB_LIKE',
    supportsColumnComments: !['MONGODB_LIKE', 'SQLITE_LIKE'].includes(family),
    options: [],
  };
  if (family === 'MYSQL_LIKE') {
    profile.indexTypes = ['BTREE', 'HASH', 'FULLTEXT', 'SPATIAL'];
    profile.foreignKeyDeleteActions = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'];
    profile.foreignKeyUpdateActions = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'];
    profile.options = mysqlOptions;
  }
  if (family === 'POSTGRES_LIKE') {
    profile.indexTypes = ['BTREE', 'HASH', 'GIN', 'GIST', 'SPGIST', 'BRIN'];
    profile.options = [{ key: 'tablespace', label: '表空间', placeholder: '默认表空间' }];
  }
  if (family === 'ORACLE_LIKE') {
    profile.indexTypes = ['NORMAL', 'BITMAP'];
    profile.defaultIndexType = 'NORMAL';
    profile.foreignKeyDeleteActions = ['NO ACTION', 'CASCADE', 'SET NULL'];
    profile.foreignKeyUpdateActions = ['NO ACTION'];
    profile.options = [{ key: 'tablespace', label: '表空间', placeholder: '默认表空间' }];
  }
  if (family === 'SQLSERVER_LIKE') {
    profile.indexTypes = [
      'NONCLUSTERED', 'CLUSTERED', 'NONCLUSTERED COLUMNSTORE',
      'CLUSTERED COLUMNSTORE', 'SPATIAL', 'PRIMARY XML',
    ];
    profile.defaultIndexType = 'NONCLUSTERED';
    profile.foreignKeyDeleteActions = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
    profile.foreignKeyUpdateActions = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
    profile.options = [{ key: 'filegroup', label: '文件组', placeholder: 'PRIMARY' }];
  }
  if (family === 'SQLITE_LIKE') {
    profile.indexTypes = ['DEFAULT'];
    profile.defaultIndexType = 'DEFAULT';
    profile.options = [
      { key: 'withoutRowid', label: 'WITHOUT ROWID', type: 'boolean' },
      { key: 'strict', label: 'STRICT 表', type: 'boolean' },
    ];
  }
  if (family === 'H2_LIKE') profile.indexTypes = ['BTREE', 'SPATIAL'];
  if (family === 'MONGODB_LIKE') {
    profile.indexTypes = ['STANDARD', 'TEXT', 'HASHED', '2DSPHERE', '2D', 'WILDCARD'];
    profile.defaultIndexType = 'STANDARD';
    profile.foreignKeyDeleteActions = [];
    profile.foreignKeyUpdateActions = [];
    profile.options = [
      { key: 'validationLevel', label: '校验级别', type: 'select', values: ['strict', 'moderate', 'off'] },
      { key: 'validationAction', label: '校验失败动作', type: 'select', values: ['error', 'warn'] },
    ];
  }
  if (productCode === 'DM') {
    profile.types = DM_TYPES;
    profile.defaultType = 'BIGINT';
  }
  return profile;
}

export type ColumnParameterMode = 'fractional' | 'free' | 'length' | 'none' | 'precision-scale';

/** 各方言允许独立填写长度/精度的原生类型，避免把 VARCHAR(255) 固化成一个类型选项。 */
const COLUMN_PARAMETER_TYPES: Record<SqlDialectFamily, {
  fractional: string[];
  length: string[];
  precisionScale: string[];
}> = {
  MYSQL_LIKE: {
    fractional: ['DATETIME', 'TIME', 'TIMESTAMP'],
    length: ['BINARY', 'BIT', 'CHAR', 'VARBINARY', 'VARCHAR'],
    precisionScale: ['DECIMAL', 'NUMERIC'],
  },
  POSTGRES_LIKE: {
    fractional: ['TIME', 'TIME WITH TIME ZONE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ'],
    length: ['BIT', 'BIT VARYING', 'CHAR', 'CHARACTER', 'CHARACTER VARYING', 'VARCHAR'],
    precisionScale: ['DECIMAL', 'NUMERIC'],
  },
  ORACLE_LIKE: {
    fractional: ['TIMESTAMP', 'TIMESTAMP WITH LOCAL TIME ZONE', 'TIMESTAMP WITH TIME ZONE'],
    length: ['CHAR', 'FLOAT', 'NCHAR', 'NVARCHAR2', 'RAW', 'VARCHAR', 'VARCHAR2'],
    precisionScale: ['DECIMAL', 'NUMBER', 'NUMERIC'],
  },
  SQLSERVER_LIKE: {
    fractional: ['DATETIME2', 'DATETIMEOFFSET', 'TIME'],
    length: ['BINARY', 'CHAR', 'FLOAT', 'NCHAR', 'NVARCHAR', 'VARBINARY', 'VARCHAR'],
    precisionScale: ['DECIMAL', 'NUMERIC'],
  },
  SQLITE_LIKE: { fractional: [], length: [], precisionScale: [] },
  H2_LIKE: {
    fractional: ['TIME', 'TIME WITH TIME ZONE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE'],
    length: ['BINARY', 'BINARY VARYING', 'CHAR', 'CHARACTER VARYING', 'VARCHAR'],
    precisionScale: ['DECIMAL', 'NUMERIC'],
  },
  MONGODB_LIKE: { fractional: [], length: [], precisionScale: [] },
};

function normalizedTypeName(dataType: string): string {
  return String(dataType || '').trim().replaceAll(/\s+/g, ' ').toUpperCase();
}

/** 自增/Identity 只开放给各产品能稳定支持的数值类型，避免生成必然失败的 DDL。 */
function supportsAutoIncrementType(column: TableDesignColumn, profile: TableDesignerProfile): boolean {
  const type = normalizedTypeName(column.dataType);
  const family = profile.family;
  if (family === 'MYSQL_LIKE') {
    return ['BIGINT', 'INT', 'INTEGER', 'MEDIUMINT', 'SMALLINT', 'TINYINT'].includes(type);
  }
  if (family === 'POSTGRES_LIKE') {
    return ['BIGINT', 'BIGSERIAL', 'INT', 'INTEGER', 'SERIAL', 'SMALLINT', 'SMALLSERIAL'].includes(type);
  }
  if (family === 'ORACLE_LIKE') {
    const types = profile.productCode === 'DM'
      ? ['BIGINT', 'DECIMAL', 'INT', 'INTEGER', 'NUMBER', 'NUMERIC', 'SMALLINT', 'TINYINT']
      : ['DECIMAL', 'INT', 'INTEGER', 'NUMBER', 'NUMERIC', 'SMALLINT'];
    return types.includes(type)
      && (!column.scale || Number(column.scale) === 0);
  }
  if (family === 'SQLSERVER_LIKE' || family === 'H2_LIKE') {
    return ['BIGINT', 'DECIMAL', 'INT', 'INTEGER', 'NUMERIC', 'SMALLINT', 'TINYINT'].includes(type)
      && (!column.scale || Number(column.scale) === 0);
  }
  return family === 'SQLITE_LIKE' && type === 'INTEGER';
}

/** 返回当前类型应展示的参数输入方式；未知原生类型保留自由参数入口。 */
export function resolveColumnParameterMode(
  dataType: string,
  family: SqlDialectFamily,
): ColumnParameterMode {
  if (family === 'MONGODB_LIKE' || family === 'SQLITE_LIKE') return 'none';
  const type = normalizedTypeName(dataType)
    .replace(/\s+(?:UNSIGNED(?:\s+ZEROFILL)?|ZEROFILL)$/i, '');
  if (family === 'MYSQL_LIKE' && ['ENUM', 'SET'].includes(type)) return 'free';
  const config = COLUMN_PARAMETER_TYPES[family];
  if (config.precisionScale.includes(type)) return 'precision-scale';
  if (config.fractional.includes(type)) return 'fractional';
  if (config.length.includes(type)) return 'length';
  const known = FAMILY_TYPES[family].some((item) => normalizedTypeName(item) === type)
    || (family === 'ORACLE_LIKE' && DM_TYPES.some((item) => normalizedTypeName(item) === type));
  return known ? 'none' : 'free';
}

/**
 * 将元数据中的 VARCHAR(255) / DECIMAL(18,2) 拆回“类型、长度/精度、小数位”。
 * JDBC 已单独返回长度时优先补齐，但不会给 TEXT、INTEGER 等无参数类型制造伪长度。
 */
export function splitColumnType(
  rawType: string,
  dbLength: null | number | string | undefined,
  dbScale: null | number | string | undefined,
  family: SqlDialectFamily,
): Pick<TableDesignColumn, 'dataType' | 'length' | 'scale'> {
  const raw = String(rawType || '').trim();
  let dataType = raw;
  let length = '';
  let scale = '';
  const match = raw.match(/^([^()]+?)\s*\((.*)\)\s*(.*)$/);
  if (match) {
    const base = String(match[1] || '').trim();
    const suffix = String(match[3] || '').trim();
    dataType = suffix ? `${base} ${suffix}` : base;
    const mode = resolveColumnParameterMode(dataType, family);
    const args = String(match[2] || '').trim();
    if (mode === 'precision-scale') {
      const comma = args.indexOf(',');
      length = (comma < 0 ? args : args.slice(0, comma)).trim();
      scale = comma < 0 ? '' : args.slice(comma + 1).trim();
    } else if (mode !== 'none') {
      length = args;
    }
  }
  const mode = resolveColumnParameterMode(dataType, family);
  if (!length && mode === 'fractional' && dbScale !== null && dbScale !== undefined) {
    length = String(dbScale);
  } else if (!length && ['free', 'length', 'precision-scale'].includes(mode)
    && dbLength !== null && dbLength !== undefined && Number(dbLength) > 0) {
    length = String(dbLength);
  }
  if (!scale && mode === 'precision-scale' && dbScale !== null && dbScale !== undefined) {
    scale = String(dbScale);
  }
  return { dataType: dataType || rawType, length, scale };
}

/** 按数据库语法把独立的类型参数重新组合，时间带时区类型的精度放在 TIMESTAMP/TIME 后。 */
function composeColumnType(column: TableDesignColumn, family: SqlDialectFamily): string {
  const raw = column.dataType.trim();
  const mode = resolveColumnParameterMode(raw, family);
  const length = String(column.length || '').trim();
  const scale = String(column.scale || '').trim();
  if (mode === 'none' || !length) return raw;
  const args = mode === 'precision-scale' && scale ? `${length},${scale}` : length;
  const timeZone = raw.match(/^(TIME(?:STAMP)?)(\s+WITH(?:\s+LOCAL)?\s+TIME\s+ZONE)$/i);
  if (timeZone) return `${timeZone[1]}(${args})${timeZone[2]}`;
  const attributes = raw.match(/^(.+?)(\s+(?:UNSIGNED(?:\s+ZEROFILL)?|ZEROFILL))$/i);
  if (attributes) return `${attributes[1]}(${args})${attributes[2]}`;
  return `${raw}(${args})`;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function sameColumn(a: TableDesignColumn, b: TableDesignColumn): boolean {
  return stable({ ...a, id: '', originalName: '' }) === stable({ ...b, id: '', originalName: '' });
}

function sameIndex(a: TableDesignIndex, b: TableDesignIndex): boolean {
  return stable({ ...a, id: '', originalName: '' }) === stable({ ...b, id: '', originalName: '' });
}

function sameForeignKey(a: TableDesignForeignKey, b: TableDesignForeignKey): boolean {
  return stable({ ...a, id: '', originalName: '' }) === stable({ ...b, id: '', originalName: '' });
}

function terminate(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

function csv(values: string[], quote: (name: string) => string): string {
  return values.map((value) => quote(value.trim())).join(', ');
}

/** 当前索引方法是否允许为各字段设置 ASC / DESC。 */
export function supportsIndexSort(typeValue: string, family: SqlDialectFamily): boolean {
  const type = normalizedTypeName(typeValue).replaceAll('_', ' ');
  if (family === 'MONGODB_LIKE') return type === 'STANDARD';
  if (family === 'MYSQL_LIKE') return ['BTREE', 'HASH'].includes(type);
  if (family === 'POSTGRES_LIKE') return type === 'BTREE';
  if (family === 'ORACLE_LIKE') return type === 'NORMAL';
  if (family === 'SQLSERVER_LIKE') return ['CLUSTERED', 'NONCLUSTERED'].includes(type);
  if (family === 'SQLITE_LIKE') return true;
  return family === 'H2_LIKE' && type === 'BTREE';
}

/** 生成带字段排序方向的索引列清单。 */
function indexColumnsSql(index: TableDesignIndex, quote: (name: string) => string): string {
  const descending = new Set((index.descendingColumns || []).map((name) => name.toLowerCase()));
  return index.columns
    .map((value) => `${quote(value.trim())}${descending.has(value.trim().toLowerCase()) ? ' DESC' : ''}`)
    .join(', ');
}

function tableNameSql(dbType: null | string | undefined, schema: string, table: string): string {
  return resolveSqlDialect(dbType).qualifyTable(schema, table);
}

function columnType(column: TableDesignColumn, family: SqlDialectFamily): string {
  const raw = composeColumnType(column, family);
  if (!column.autoIncrement) return raw;
  if (family === 'POSTGRES_LIKE') {
    if (/\bBIGINT\b/i.test(raw)) return 'BIGSERIAL';
    if (/\b(SMALLINT|INT|INTEGER)\b/i.test(raw)) return 'SERIAL';
  }
  return raw;
}

/** 生成一列的完整定义；defaultValue 按高级用户输入的 SQL 表达式原样保留。 */
function columnDefinition(
  column: TableDesignColumn,
  family: SqlDialectFamily,
  quote: (name: string) => string,
  includeName = true,
): string {
  const parts: string[] = [];
  if (includeName) parts.push(quote(column.name));
  parts.push(columnType(column, family));
  if (column.autoIncrement) {
    if (family === 'MYSQL_LIKE') parts.push('AUTO_INCREMENT');
    if (family === 'SQLSERVER_LIKE') parts.push('IDENTITY(1,1)');
    if (family === 'ORACLE_LIKE') parts.push('GENERATED BY DEFAULT AS IDENTITY');
    if (family === 'H2_LIKE') parts.push('GENERATED BY DEFAULT AS IDENTITY');
    if (family === 'SQLITE_LIKE' && column.primary && /^INTEGER$/i.test(column.dataType.trim())) {
      parts.push('PRIMARY KEY AUTOINCREMENT');
    }
  }
  if (column.defaultValue.trim()) parts.push(`DEFAULT ${column.defaultValue.trim()}`);
  if (!column.nullable || column.primary) parts.push('NOT NULL');
  if (family === 'MYSQL_LIKE' && column.comment.trim()) {
    parts.push(`COMMENT ${resolveSqlDialect('MY_SQL').literal(column.comment.trim())}`);
  }
  return parts.join(' ');
}

function fkClause(
  fk: TableDesignForeignKey,
  dbType: null | string | undefined,
  defaultSchema: string,
): string {
  const dialect = resolveSqlDialect(dbType);
  const ref = dialect.qualifyTable(fk.referencedSchema.trim() || defaultSchema, fk.referencedTable);
  const family = resolveDialectFamily(dbType);
  const deleteAction = family === 'ORACLE_LIKE' && fk.onDelete === 'RESTRICT' ? 'NO ACTION' : fk.onDelete;
  const updateAction = family === 'ORACLE_LIKE' ? 'NO ACTION'
    : family === 'SQLSERVER_LIKE' && fk.onUpdate === 'RESTRICT' ? 'NO ACTION' : fk.onUpdate;
  const actions = [
    deleteAction && deleteAction !== 'NO ACTION' ? `ON DELETE ${deleteAction}` : '',
    updateAction && updateAction !== 'NO ACTION' ? `ON UPDATE ${updateAction}` : '',
  ].filter(Boolean);
  return `CONSTRAINT ${dialect.quoteIdent(fk.name)} FOREIGN KEY (${csv(fk.columns, dialect.quoteIdent)}) REFERENCES ${ref} (${csv(fk.referencedColumns, dialect.quoteIdent)})${actions.length ? ` ${actions.join(' ')}` : ''}`;
}

function indexCreateSql(
  index: TableDesignIndex,
  dbType: null | string | undefined,
  schema: string,
  table: string,
): string {
  const dialect = resolveSqlDialect(dbType);
  const unique = index.unique ? 'UNIQUE ' : '';
  const type = normalizedTypeName(index.type).replaceAll('_', ' ');
  if (resolveDialectFamily(dbType) === 'MONGODB_LIKE') {
    const direction = type === 'HASHED' ? '"hashed"'
      : type === 'TEXT' ? '"text"'
        : type === '2DSPHERE' ? '"2dsphere"'
          : type === '2D' ? '"2d"' : '1';
    const keys = index.columns.map((name) => {
      const key = type === 'WILDCARD' && name !== '$**' && !name.endsWith('.$**')
        ? `${name}.$**` : name;
      const standardDirection = (index.descendingColumns || []).includes(name) ? '-1' : '1';
      return `${JSON.stringify(key)}: ${type === 'STANDARD' ? standardDirection : direction}`;
    }).join(', ');
    return `db.getCollection(${JSON.stringify(table)}).createIndex({ ${keys} }, { name: ${JSON.stringify(index.name)}, unique: ${index.unique} });`;
  }
  const family = resolveDialectFamily(dbType);
  if (family === 'SQLSERVER_LIKE') {
    const target = tableNameSql(dbType, schema, table);
    if (type === 'CLUSTERED COLUMNSTORE') {
      return `CREATE CLUSTERED COLUMNSTORE INDEX ${dialect.quoteIdent(index.name)} ON ${target};`;
    }
    if (type === 'NONCLUSTERED COLUMNSTORE') {
      return `CREATE NONCLUSTERED COLUMNSTORE INDEX ${dialect.quoteIdent(index.name)} ON ${target} (${csv(index.columns, dialect.quoteIdent)});`;
    }
    if (type === 'SPATIAL') {
      return `CREATE SPATIAL INDEX ${dialect.quoteIdent(index.name)} ON ${target} (${csv(index.columns, dialect.quoteIdent)});`;
    }
    if (type === 'PRIMARY XML') {
      return `CREATE PRIMARY XML INDEX ${dialect.quoteIdent(index.name)} ON ${target} (${csv(index.columns, dialect.quoteIdent)});`;
    }
    const kind = type === 'CLUSTERED' ? 'CLUSTERED ' : 'NONCLUSTERED ';
    return `CREATE ${unique}${kind}INDEX ${dialect.quoteIdent(index.name)} ON ${target} (${indexColumnsSql(index, dialect.quoteIdent)});`;
  }
  if (family === 'ORACLE_LIKE' && type.includes('BITMAP')) {
    return `CREATE BITMAP INDEX ${dialect.quoteIdent(index.name)} ON ${tableNameSql(dbType, schema, table)} (${csv(index.columns, dialect.quoteIdent)});`;
  }
  if (family === 'MYSQL_LIKE') {
    const category = ['FULLTEXT', 'SPATIAL'].includes(type) ? `${type} ` : '';
    const using = ['BTREE', 'HASH'].includes(type)
      ? ` USING ${type}`
      : '';
    const columns = ['BTREE', 'HASH'].includes(type)
      ? indexColumnsSql(index, dialect.quoteIdent) : csv(index.columns, dialect.quoteIdent);
    return `CREATE ${unique}${category}INDEX ${dialect.quoteIdent(index.name)}${using} ON ${tableNameSql(dbType, schema, table)} (${columns});`;
  }
  if (family === 'H2_LIKE' && type === 'SPATIAL') {
    return `CREATE SPATIAL INDEX ${dialect.quoteIdent(index.name)} ON ${tableNameSql(dbType, schema, table)} (${csv(index.columns, dialect.quoteIdent)});`;
  }
  const using = type && type !== 'BTREE' && family === 'POSTGRES_LIKE'
    ? ` USING ${type}` : '';
  const columns = supportsIndexSort(type, family)
    ? indexColumnsSql(index, dialect.quoteIdent) : csv(index.columns, dialect.quoteIdent);
  return `CREATE ${unique}INDEX ${dialect.quoteIdent(index.name)} ON ${tableNameSql(dbType, schema, table)}${using} (${columns});`;
}

function indexDropSql(indexName: string, dbType: null | string | undefined, schema: string, table: string): string {
  const dialect = resolveSqlDialect(dbType);
  const family = resolveDialectFamily(dbType);
  if (family === 'MYSQL_LIKE') return `ALTER TABLE ${tableNameSql(dbType, schema, table)} DROP INDEX ${dialect.quoteIdent(indexName)};`;
  if (family === 'SQLSERVER_LIKE') return `DROP INDEX ${dialect.quoteIdent(indexName)} ON ${tableNameSql(dbType, schema, table)};`;
  if (family === 'MONGODB_LIKE') return `db.getCollection(${JSON.stringify(table)}).dropIndex(${JSON.stringify(indexName)});`;
  return `DROP INDEX ${family === 'POSTGRES_LIKE' && schema ? `${dialect.quoteIdent(schema)}.` : ''}${dialect.quoteIdent(indexName)};`;
}

/** SQL Server 使用扩展属性保存表与字段备注。 */
function sqlServerCommentSql(
  action: 'add' | 'drop' | 'update',
  schema: string,
  table: string,
  value: string,
  column?: string,
): string {
  const literal = resolveSqlDialect('SQL_SERVER').literal;
  const procedure = `sys.sp_${action}extendedproperty`;
  const valueArg = action === 'drop' ? '' : `, @value=${literal(value)}`;
  const columnArgs = column
    ? `, @level2type=N'COLUMN', @level2name=${literal(column)}`
    : '';
  return `EXEC ${procedure} @name=N'MS_Description'${valueArg}, @level0type=N'SCHEMA', @level0name=${literal(schema || 'dbo')}, @level1type=N'TABLE', @level1name=${literal(table)}${columnArgs};`;
}

function tableCommentStatements(dbType: null | string | undefined, schema: string, model: TableDesignModel): string[] {
  const family = resolveDialectFamily(dbType);
  const dialect = resolveSqlDialect(dbType);
  const table = tableNameSql(dbType, schema, model.tableName);
  const result: string[] = [];
  if (family === 'POSTGRES_LIKE' || family === 'ORACLE_LIKE' || family === 'H2_LIKE') {
    if (model.comment.trim()) result.push(`COMMENT ON TABLE ${table} IS ${dialect.literal(model.comment.trim())};`);
    for (const column of model.columns) {
      if (column.comment.trim()) result.push(`COMMENT ON COLUMN ${table}.${dialect.quoteIdent(column.name)} IS ${dialect.literal(column.comment.trim())};`);
    }
  }
  if (family === 'SQLSERVER_LIKE') {
    if (model.comment.trim()) result.push(sqlServerCommentSql('add', schema, model.tableName, model.comment.trim()));
    for (const column of model.columns) {
      if (column.comment.trim()) result.push(sqlServerCommentSql('add', schema, model.tableName, column.comment.trim(), column.name));
    }
  }
  return result;
}

function tableSuffix(profile: TableDesignerProfile, model: TableDesignModel): string {
  const o = model.options || {};
  if (profile.family === 'MYSQL_LIKE') {
    return [o.engine ? `ENGINE=${o.engine}` : '', o.charset ? `DEFAULT CHARSET=${o.charset}` : '', o.collation ? `COLLATE=${o.collation}` : '', model.comment.trim() ? `COMMENT=${resolveSqlDialect('MY_SQL').literal(model.comment.trim())}` : ''].filter(Boolean).join(' ');
  }
  if (profile.family === 'POSTGRES_LIKE' && o.tablespace) return `TABLESPACE ${resolveSqlDialect('POSTGRE_SQL').quoteIdent(String(o.tablespace))}`;
  if (profile.family === 'ORACLE_LIKE' && o.tablespace) return `TABLESPACE ${resolveSqlDialect('ORACLE').quoteIdent(String(o.tablespace))}`;
  if (profile.family === 'SQLSERVER_LIKE' && o.filegroup) return `ON ${resolveSqlDialect('SQL_SERVER').quoteIdent(String(o.filegroup))}`;
  if (profile.family === 'SQLITE_LIKE') return [o.withoutRowid ? 'WITHOUT ROWID' : '', o.strict ? 'STRICT' : ''].filter(Boolean).join(', ');
  return '';
}

/**
 * 生成 MongoDB JSON Schema。读取表详情时保存的原始 Schema 作为底稿，字段级 UI 只覆盖
 * bsonType、description 和 required，避免误删 minimum、pattern、items 等高级校验规则。
 */
function mongoValidator(model: TableDesignModel): Record<string, unknown> {
  let base: Record<string, any> = {};
  try {
    const raw = String(model.options.jsonSchema || '').trim();
    if (raw) base = JSON.parse(raw);
  } catch {
    // 元数据中的原始 Schema 理论上一定合法；解析失败时退回最小可用 Schema。
    base = {};
  }
  const baseProperties = base.properties && typeof base.properties === 'object'
    ? base.properties as Record<string, Record<string, unknown>>
    : {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const column of model.columns.filter((item) => item.name && item.name !== '_id')) {
    const bsonTypes = String(column.dataType || 'string')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
    const property: Record<string, unknown> = {
      ...(baseProperties[column.originalName || column.name] || {}),
      bsonType: bsonTypes.length > 1 ? bsonTypes : bsonTypes[0] || 'string',
    };
    if (column.comment) property.description = column.comment;
    else delete property.description;
    properties[column.name] = property;
    if (!column.nullable) required.push(column.name);
  }
  const result: Record<string, unknown> = { ...base, bsonType: 'object', properties };
  if (required.length) result.required = required;
  else delete result.required;
  return result;
}

/**
 * 校验不能只靠 SQL 语法表达的产品限制，错误会阻止保存，提示不会阻止用户预览。
 * 规则集中在方言层，避免组件随着数据库产品增加而堆积判断。
 */
function validateModelCompatibility(
  dbType: null | string | undefined,
  model: TableDesignModel,
  original: null | TableDesignModel | undefined,
  profile: TableDesignerProfile,
  warnings: string[],
  errors: string[],
): void {
  for (const column of model.columns) {
    const originalColumn = column.originalName
      ? original?.columns.find((item) => item.name === column.originalName)
      : undefined;
    const definitionChanged = !originalColumn || stable({
      autoIncrement: originalColumn.autoIncrement,
      dataType: originalColumn.dataType,
      length: originalColumn.length,
      scale: originalColumn.scale,
    }) !== stable({
      autoIncrement: column.autoIncrement,
      dataType: column.dataType,
      length: column.length,
      scale: column.scale,
    });
    // 修改表名、备注或可空性时，不用新规则重新否定数据库中已经存在的合法原生类型。
    if (!definitionChanged) continue;
    const mode = resolveColumnParameterMode(column.dataType, profile.family);
    const length = String(column.length || '').trim();
    const scale = String(column.scale || '').trim();
    const nativeLength = profile.family === 'ORACLE_LIKE'
      && mode === 'length' && /^\d+\s+(?:BYTE|CHAR)$/i.test(length);
    if (length && mode !== 'free' && !/^\d+$/.test(length) && !nativeLength
      && !(profile.family === 'SQLSERVER_LIKE' && mode === 'length' && /^MAX$/i.test(length))) {
      errors.push(`字段「${column.name}」的长度/精度格式不受支持，请输入非负整数${profile.family === 'ORACLE_LIKE' ? '、数字加 CHAR/BYTE' : ''}${profile.family === 'SQLSERVER_LIKE' ? '或 MAX' : ''}。`);
    }
    if (scale && (!/^\d+$/.test(scale) || mode !== 'precision-scale')) {
      errors.push(`字段「${column.name}」的小数位只适用于 DECIMAL / NUMERIC / NUMBER，且必须是非负整数。`);
    }
    if (/^\d+$/.test(length) && /^\d+$/.test(scale) && Number(scale) > Number(length)) {
      errors.push(`字段「${column.name}」的小数位不能大于精度。`);
    }
    if (column.autoIncrement && !supportsAutoIncrementType(column, profile)) {
      errors.push(`${profile.label} 的字段「${column.name}」不能在 ${column.dataType} 类型上设置自增。`);
    }
  }

  const clustered = model.indexes.filter((item) => normalizedTypeName(item.type).startsWith('CLUSTERED'));
  if (profile.family === 'SQLSERVER_LIKE' && clustered.length > 1) {
    errors.push('SQL Server 一张表只能有一个聚集索引或聚集列存储索引。');
  }
  for (const index of model.indexes) {
    const type = normalizedTypeName(index.type).replaceAll('_', ' ');
    const originalIndex = index.originalName
      ? original?.indexes.find((item) => item.name === index.originalName)
      : undefined;
    const supportedTypes = profile.indexTypes.map((item) => normalizedTypeName(item).replaceAll('_', ' '));
    const indexChanged = !originalIndex || !sameIndex(originalIndex, index);
    if (!supportedTypes.includes(type) && indexChanged) {
      errors.push(`${profile.label} 的可视化设计器暂不支持创建索引类型「${index.type}」。`);
    }
    // 未修改的历史索引无需重新创建，也不应阻止仅修改表名或备注。
    if (!indexChanged) continue;
    if ((index.descendingColumns || []).length && !supportsIndexSort(type, profile.family)) {
      errors.push(`索引「${index.name}」的 ${type} 类型不支持字段降序设置。`);
    }
    if (index.unique) {
      if (profile.family === 'MYSQL_LIKE' && ['FULLTEXT', 'SPATIAL'].includes(type)) {
        errors.push(`MySQL 的 ${type} 索引「${index.name}」不能设置 UNIQUE。`);
      }
      if (profile.family === 'POSTGRES_LIKE' && type !== 'BTREE') {
        errors.push(`PostgreSQL 方言族只有 B-tree 索引可直接设置 UNIQUE：${index.name}。`);
      }
      if (profile.family === 'ORACLE_LIKE' && type.includes('BITMAP')) {
        errors.push(`Oracle 方言族的位图索引「${index.name}」不能设置 UNIQUE。`);
      }
      if (profile.family === 'SQLSERVER_LIKE'
        && !['CLUSTERED', 'NONCLUSTERED'].includes(type)) {
        errors.push(`SQL Server 的 ${type} 索引「${index.name}」不支持 UNIQUE 选项。`);
      }
      if (profile.family === 'H2_LIKE' && type === 'SPATIAL') {
        errors.push(`H2 空间索引「${index.name}」不能设置 UNIQUE。`);
      }
      if (profile.family === 'MONGODB_LIKE' && type !== 'STANDARD') {
        errors.push(`MongoDB 的 ${type} 索引「${index.name}」不支持唯一选项。`);
      }
    }
    if (['PRIMARY XML', 'SPATIAL'].includes(type) && index.columns.length !== 1) {
      errors.push(`索引「${index.name}」的 ${type} 类型只能选择一个字段。`);
    }
    if (profile.family === 'H2_LIKE' && type === 'SPATIAL' && index.columns.length !== 1) {
      errors.push(`H2 空间索引「${index.name}」只能选择一个 GEOMETRY 字段。`);
    }
    if (profile.family === 'MONGODB_LIKE' && ['HASHED', 'WILDCARD'].includes(type)
      && index.columns.length !== 1 && (!originalIndex || !sameIndex(originalIndex, index))) {
      errors.push(`MongoDB ${type} 索引「${index.name}」在当前简化编辑器中只能指定一个字段。`);
    }
    if (profile.family === 'MYSQL_LIKE' && type === 'HASH'
      && !['MEMORY', 'NDB', 'NDBCLUSTER'].includes(String(model.options.engine || '').toUpperCase())) {
      warnings.push(`MySQL HASH 索引「${index.name}」通常只适用于 MEMORY/NDB 引擎，当前引擎可能回退或拒绝。`);
    }
    if (profile.family === 'MYSQL_LIKE' && type === 'SPATIAL') {
      const nullable = index.columns.some((name) => model.columns.find((item) => item.name === name)?.nullable);
      if (nullable) errors.push(`MySQL SPATIAL 索引「${index.name}」的字段必须设置为必填。`);
    }
    const indexedTypes = index.columns.map((name) => normalizedTypeName(
      model.columns.find((item) => item.name === name)?.dataType || '',
    ));
    if (profile.family === 'MYSQL_LIKE' && type === 'FULLTEXT'
      && indexedTypes.some((item) => !/(CHAR|TEXT)$/.test(item))) {
      errors.push(`MySQL FULLTEXT 索引「${index.name}」只能使用字符或文本字段。`);
    }
    if (profile.family === 'MYSQL_LIKE' && type === 'SPATIAL'
      && indexedTypes.some((item) => !['GEOMETRY', 'POINT'].includes(item))) {
      errors.push(`MySQL SPATIAL 索引「${index.name}」只能使用空间字段。`);
    }
    if (profile.family === 'H2_LIKE' && type === 'SPATIAL'
      && indexedTypes.some((item) => item !== 'GEOMETRY')) {
      errors.push(`H2 SPATIAL 索引「${index.name}」只能使用 GEOMETRY 字段。`);
    }
    if (profile.family === 'SQLSERVER_LIKE' && type === 'SPATIAL'
      && indexedTypes.some((item) => !['GEOGRAPHY', 'GEOMETRY'].includes(item))) {
      errors.push(`SQL Server SPATIAL 索引「${index.name}」只能使用 geometry/geography 字段。`);
    }
    if (profile.family === 'SQLSERVER_LIKE' && type === 'PRIMARY XML'
      && indexedTypes.some((item) => item !== 'XML')) {
      errors.push(`SQL Server PRIMARY XML 索引「${index.name}」只能使用 XML 字段。`);
    }
  }

  for (const fk of model.foreignKeys) {
    const originalForeignKey = fk.originalName
      ? original?.foreignKeys.find((item) => item.name === fk.originalName)
      : undefined;
    if (originalForeignKey && sameForeignKey(originalForeignKey, fk)) continue;
    if (!profile.foreignKeyDeleteActions.includes(fk.onDelete)) {
      errors.push(`${profile.label} 不支持外键「${fk.name}」的 ON DELETE ${fk.onDelete}。`);
    }
    if (!profile.foreignKeyUpdateActions.includes(fk.onUpdate)) {
      errors.push(`${profile.label} 不支持外键「${fk.name}」的 ON UPDATE ${fk.onUpdate}。`);
    }
  }

  if (original && ['POSTGRES_LIKE', 'SQLSERVER_LIKE'].includes(profile.family)) {
    for (const before of original.columns) {
      const after = model.columns.find((item) => item.originalName === before.name);
      if (after && before.autoIncrement !== after.autoIncrement) {
        const feature = profile.family === 'SQLSERVER_LIKE' ? 'IDENTITY' : 'SERIAL/自增序列';
        errors.push(`${profile.label} 不能通过当前安全 ALTER 流程修改字段「${before.name}」的 ${feature} 属性，请重建字段。`);
      }
    }
  }
  if (normalizeDbTypeCode(dbType) === 'DM' && model.columns.some((item) => normalizedTypeName(item.dataType) === 'JSON')) {
    warnings.push('达梦不同版本对 JSON 类型支持不同，如目标版本不支持请改用 CLOB。');
  }
}

function generateCreate(
  dbType: null | string | undefined,
  schema: string,
  model: TableDesignModel,
  profile: TableDesignerProfile,
): string[] {
  if (profile.family === 'MONGODB_LIKE') {
    const validator = mongoValidator(model);
    const options = model.columns.length
      ? `, { validator: { "$jsonSchema": ${JSON.stringify(validator)} }, validationLevel: ${JSON.stringify(model.options.validationLevel || 'strict')}, validationAction: ${JSON.stringify(model.options.validationAction || 'error')} }`
      : '';
    return [
      `db.createCollection(${JSON.stringify(model.tableName)}${options});`,
      ...model.indexes.map((index) => indexCreateSql(index, dbType, schema, model.tableName)),
    ];
  }
  const dialect = resolveSqlDialect(dbType);
  const definitions = model.columns.map((column) => `  ${columnDefinition(column, profile.family, dialect.quoteIdent)}`);
  const primary = model.columns.filter((column) => column.primary);
  const sqliteInlinePrimary = profile.family === 'SQLITE_LIKE' && primary.length === 1
    && primary[0]?.autoIncrement && /^INTEGER$/i.test(primary[0].dataType.trim());
  if (primary.length && !sqliteInlinePrimary) definitions.push(`  PRIMARY KEY (${csv(primary.map((column) => column.name), dialect.quoteIdent)})`);
  if (profile.supportsForeignKeys) {
    definitions.push(...model.foreignKeys.map((fk) => `  ${fkClause(fk, dbType, schema)}`));
  }
  const suffix = tableSuffix(profile, model);
  const create = `CREATE TABLE ${tableNameSql(dbType, schema, model.tableName)} (\n${definitions.join(',\n')}\n)${suffix ? ` ${suffix}` : ''};`;
  return [create, ...model.indexes.map((index) => indexCreateSql(index, dbType, schema, model.tableName)), ...tableCommentStatements(dbType, schema, model)];
}

function generateAlterColumn(
  dbType: null | string | undefined,
  schema: string,
  table: string,
  before: TableDesignColumn,
  after: TableDesignColumn,
  errors: string[],
): string[] {
  const family = resolveDialectFamily(dbType);
  const dialect = resolveSqlDialect(dbType);
  const target = tableNameSql(dbType, schema, table);
  const oldName = before.originalName || before.name;
  const out: string[] = [];
  // SERIAL 是建表简写，不是 PostgreSQL ALTER COLUMN TYPE 可接受的真实类型。
  const typeChanged = composeColumnType(before, family) !== composeColumnType(after, family);
  const nullabilityChanged = before.nullable !== after.nullable || before.primary !== after.primary;
  const defaultChanged = before.defaultValue !== after.defaultValue;
  if (family === 'MYSQL_LIKE') {
    const verb = oldName !== after.name ? `CHANGE COLUMN ${dialect.quoteIdent(oldName)} ${columnDefinition(after, family, dialect.quoteIdent)}` : `MODIFY COLUMN ${columnDefinition(after, family, dialect.quoteIdent)}`;
    return [`ALTER TABLE ${target} ${verb};`];
  }
  if (family === 'SQLITE_LIKE') {
    if (oldName !== after.name && sameColumn({ ...before, name: after.name }, after)) {
      return [`ALTER TABLE ${target} RENAME COLUMN ${dialect.quoteIdent(oldName)} TO ${dialect.quoteIdent(after.name)};`];
    }
    errors.push(`SQLite 不能直接修改字段「${oldName}」的类型/默认值/可空性；请新建字段迁移数据，或使用重建表工具。`);
    return out;
  }
  if (oldName !== after.name) {
    if (family === 'SQLSERVER_LIKE') out.push(`EXEC sp_rename N'${schema || 'dbo'}.${table}.${oldName}', N'${after.name}', 'COLUMN';`);
    else out.push(`ALTER TABLE ${target} RENAME COLUMN ${dialect.quoteIdent(oldName)} TO ${dialect.quoteIdent(after.name)};`);
  }
  const name = dialect.quoteIdent(after.name);
  if (family === 'POSTGRES_LIKE') {
    if (typeChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} TYPE ${composeColumnType(after, family)};`);
    if (nullabilityChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${after.nullable && !after.primary ? 'DROP' : 'SET'} NOT NULL;`);
    if (defaultChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${after.defaultValue.trim() ? `SET DEFAULT ${after.defaultValue.trim()}` : 'DROP DEFAULT'};`);
    if (before.comment !== after.comment) out.push(`COMMENT ON COLUMN ${target}.${name} IS ${dialect.literal(after.comment || '')};`);
    return out;
  }
  if (family === 'ORACLE_LIKE') {
    if (typeChanged || nullabilityChanged || defaultChanged || before.autoIncrement !== after.autoIncrement) {
      out.push(`ALTER TABLE ${target} MODIFY (${columnDefinition(after, family, dialect.quoteIdent)});`);
    }
    if (before.comment !== after.comment) out.push(`COMMENT ON COLUMN ${target}.${name} IS ${dialect.literal(after.comment || '')};`);
    return out;
  }
  if (family === 'SQLSERVER_LIKE') {
    if (typeChanged || nullabilityChanged) {
      out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${columnType(after, family)} ${after.nullable && !after.primary ? 'NULL' : 'NOT NULL'};`);
    }
    if (defaultChanged) {
      if (before.defaultValue.trim()) {
        if (before.defaultConstraintName?.trim()) {
          out.push(`ALTER TABLE ${target} DROP CONSTRAINT ${dialect.quoteIdent(before.defaultConstraintName.trim())};`);
        } else {
          errors.push(`未读取到 SQL Server 字段「${after.name}」的默认约束名，不能安全删除旧默认值。`);
        }
      }
      if (after.defaultValue.trim()) {
        const constraintName = `DF_${table}_${after.name}`.slice(0, 128);
        out.push(`ALTER TABLE ${target} ADD CONSTRAINT ${dialect.quoteIdent(constraintName)} DEFAULT ${after.defaultValue.trim()} FOR ${name};`);
      }
    }
    if (before.comment !== after.comment) {
      const action = before.comment ? (after.comment ? 'update' : 'drop') : 'add';
      out.push(sqlServerCommentSql(action, schema, table, after.comment || '', after.name));
    }
    return out;
  }
  if (family === 'H2_LIKE') {
    if (typeChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} SET DATA TYPE ${columnType(after, family)};`);
    if (nullabilityChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${after.nullable && !after.primary ? 'DROP' : 'SET'} NOT NULL;`);
    if (defaultChanged) out.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${after.defaultValue.trim() ? `SET DEFAULT ${after.defaultValue.trim()}` : 'DROP DEFAULT'};`);
  }
  return out;
}

function generateAlter(
  dbType: null | string | undefined,
  schema: string,
  model: TableDesignModel,
  original: TableDesignModel,
  profile: TableDesignerProfile,
  warnings: string[],
  errors: string[],
): string[] {
  const dialect = resolveSqlDialect(dbType);
  const family = profile.family;
  const oldTable = original.tableName;
  const table = oldTable;
  const out: string[] = [];
  let renameTableSql = '';
  if (oldTable !== model.tableName) {
    const oldTarget = tableNameSql(dbType, schema, oldTable);
    if (family === 'MYSQL_LIKE') renameTableSql = `RENAME TABLE ${oldTarget} TO ${tableNameSql(dbType, schema, model.tableName)};`;
    else if (family === 'SQLSERVER_LIKE') renameTableSql = `EXEC sp_rename ${dialect.literal(`${schema || 'dbo'}.${oldTable}`)}, ${dialect.literal(model.tableName)};`;
    else if (family === 'MONGODB_LIKE') errors.push('MongoDB 集合重命名未纳入受控命令，请新建集合后迁移文档。');
    else renameTableSql = `ALTER TABLE ${oldTarget} RENAME TO ${dialect.quoteIdent(model.tableName)};`;
  }
  if (family === 'MONGODB_LIKE') {
    const validatorChanged = stable(mongoValidator(original)) !== stable(mongoValidator(model))
      || original.options.validationLevel !== model.options.validationLevel
      || original.options.validationAction !== model.options.validationAction;
    if (validatorChanged) {
      const validator = mongoValidator(model);
      out.push(`db.runCommand({ collMod: ${JSON.stringify(table)}, validator: { "$jsonSchema": ${JSON.stringify(validator)} }, validationLevel: ${JSON.stringify(model.options.validationLevel || 'strict')}, validationAction: ${JSON.stringify(model.options.validationAction || 'error')} });`);
    }
  } else {
    const beforePrimary = original.columns.filter((item) => item.primary).map((item) => item.name);
    const afterPrimary = model.columns.filter((item) => item.primary).map((item) => item.name);
    const primaryChanged = stable(beforePrimary) !== stable(afterPrimary);
    if (primaryChanged) {
      if (family === 'SQLITE_LIKE') {
        errors.push('SQLite 不能通过 ALTER TABLE 修改主键，请重建表后迁移数据。');
      } else if (beforePrimary.length) {
        if (family === 'MYSQL_LIKE') {
          out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} DROP PRIMARY KEY;`);
        } else {
          const primaryKeyName = String(original.options.primaryKeyName || '').trim();
          if (!primaryKeyName) errors.push('未读取到原主键约束名，无法安全删除主键。');
          else out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} DROP CONSTRAINT ${dialect.quoteIdent(primaryKeyName)};`);
        }
      }
    }
    const currentByOriginal = new Map(model.columns.filter((item) => item.originalName).map((item) => [item.originalName!, item]));
    for (const before of original.columns) {
      const after = currentByOriginal.get(before.name);
      if (!after) out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} DROP COLUMN ${dialect.quoteIdent(before.name)};`);
      else if (!sameColumn(before, after)) out.push(...generateAlterColumn(dbType, schema, table, before, after, errors));
    }
    for (const column of model.columns.filter((item) => !item.originalName)) {
      const definition = columnDefinition(column, family, dialect.quoteIdent);
      if (family === 'ORACLE_LIKE') out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ADD (${definition});`);
      else if (family === 'SQLSERVER_LIKE') out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ADD ${definition};`);
      else out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ADD COLUMN ${definition};`);
      if (column.comment && family === 'SQLSERVER_LIKE') {
        out.push(sqlServerCommentSql('add', schema, table, column.comment, column.name));
      } else if (column.comment && ['H2_LIKE', 'ORACLE_LIKE', 'POSTGRES_LIKE'].includes(family)) {
        out.push(`COMMENT ON COLUMN ${tableNameSql(dbType, schema, table)}.${dialect.quoteIdent(column.name)} IS ${dialect.literal(column.comment)};`);
      }
    }
    if (primaryChanged && !errors.length && afterPrimary.length) {
      const constraintName = `PK_${table}`;
      out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ADD CONSTRAINT ${dialect.quoteIdent(constraintName)} PRIMARY KEY (${csv(afterPrimary, dialect.quoteIdent)});`);
    }
  }
  const indexesByOriginal = new Map(model.indexes.filter((item) => item.originalName).map((item) => [item.originalName!, item]));
  for (const before of original.indexes) {
    const after = indexesByOriginal.get(before.name);
    if (!after || !sameIndex(before, after)) out.push(indexDropSql(before.name, dbType, schema, table));
  }
  for (const index of model.indexes) {
    const before = index.originalName ? original.indexes.find((item) => item.name === index.originalName) : undefined;
    if (!before || !sameIndex(before, index)) out.push(indexCreateSql(index, dbType, schema, table));
  }
  if (profile.supportsForeignKeys) {
    if (family === 'SQLITE_LIKE') {
      if (stable(original.foreignKeys) !== stable(model.foreignKeys)) errors.push('SQLite 不能通过 ALTER TABLE 增删外键，请重建表后迁移数据。');
    } else {
      const currentByOriginal = new Map(model.foreignKeys.filter((item) => item.originalName).map((item) => [item.originalName!, item]));
      for (const before of original.foreignKeys) {
        const after = currentByOriginal.get(before.name);
        if (!after || !sameForeignKey(before, after)) {
          const drop = family === 'MYSQL_LIKE' ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT';
          out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ${drop} ${dialect.quoteIdent(before.name)};`);
        }
      }
      for (const fk of model.foreignKeys) {
        const before = fk.originalName ? original.foreignKeys.find((item) => item.name === fk.originalName) : undefined;
        if (!before || !sameForeignKey(before, fk)) out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} ADD ${fkClause(fk, dbType, schema)};`);
      }
    }
  }
  if (original.comment !== model.comment) {
    if (family === 'MYSQL_LIKE') out.push(`ALTER TABLE ${tableNameSql(dbType, schema, table)} COMMENT = ${dialect.literal(model.comment || '')};`);
    else if (['H2_LIKE', 'ORACLE_LIKE', 'POSTGRES_LIKE'].includes(family)) out.push(`COMMENT ON TABLE ${tableNameSql(dbType, schema, table)} IS ${dialect.literal(model.comment || '')};`);
    else if (family === 'SQLSERVER_LIKE') {
      const action = original.comment ? (model.comment ? 'update' : 'drop') : 'add';
      out.push(sqlServerCommentSql(action, schema, table, model.comment || ''));
    } else if (model.comment) warnings.push('当前数据库的表备注不支持通用 ALTER 语法，未自动修改。');
  }
  const optionChanged = profile.options.some(
    (option) => stable(original.options[option.key]) !== stable(model.options[option.key]),
  );
  if (optionChanged) {
    const target = tableNameSql(dbType, schema, table);
    if (family === 'MYSQL_LIKE') {
      const clauses = [
        model.options.engine ? `ENGINE=${model.options.engine}` : '',
        model.options.charset ? `DEFAULT CHARACTER SET ${model.options.charset}` : '',
        model.options.collation ? `COLLATE ${model.options.collation}` : '',
      ].filter(Boolean);
      if (clauses.length) out.push(`ALTER TABLE ${target} ${clauses.join(' ')};`);
    } else if (family === 'POSTGRES_LIKE' && model.options.tablespace) {
      out.push(`ALTER TABLE ${target} SET TABLESPACE ${dialect.quoteIdent(String(model.options.tablespace))};`);
    } else if (family === 'ORACLE_LIKE' && model.options.tablespace) {
      out.push(`ALTER TABLE ${target} MOVE TABLESPACE ${dialect.quoteIdent(String(model.options.tablespace))};`);
    } else if (family === 'SQLITE_LIKE') {
      errors.push('SQLite 的 STRICT / WITHOUT ROWID 属性不能直接修改，请重建表后迁移数据。');
    } else if (family === 'SQLSERVER_LIKE') {
      warnings.push('SQL Server 不能通过普通 ALTER TABLE 移动文件组，未自动修改文件组。');
    }
  }
  // 表重命名最后执行，前面的结构语句仍可按原表名完成表级权限校验。
  if (renameTableSql) out.push(renameTableSql);
  return out;
}

/**
 * 生成创建或修改表 SQL。返回逐条 statements，保存时按顺序执行；sql 用于用户预览。
 */
export function generateTableDesignSql(args: {
  dbType?: null | string;
  mode: 'alter' | 'create';
  model: TableDesignModel;
  original?: null | TableDesignModel;
  schema: string;
}): TableDesignSqlResult {
  const profile = resolveTableDesignerProfile(args.dbType);
  const warnings: string[] = [];
  const errors: string[] = [];
  validateModelCompatibility(
    args.dbType,
    args.model,
    args.original,
    profile,
    warnings,
    errors,
  );
  const statements = args.mode === 'create'
    ? generateCreate(args.dbType, args.schema, args.model, profile)
    : generateAlter(args.dbType, args.schema, args.model, args.original || args.model, profile, warnings, errors);
  const normalized = statements.map(terminate).filter((item) => item.replace(/;$/, '').trim());
  const notices = [
    ...warnings.map((item) => `-- 注意：${item}`),
    ...errors.map((item) => `-- 无法自动执行：${item}`),
  ];
  return {
    statements: normalized,
    sql: [...notices, ...normalized].join('\n\n'),
    warnings,
    errors,
  };
}
