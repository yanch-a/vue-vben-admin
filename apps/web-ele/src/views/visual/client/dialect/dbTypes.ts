/**
 * 数据库产品注册表（前端）
 *
 * 与后端 `com.lemon.vq.dialect.DbTypeProfiles` 一一对应，是所有「按库类型分支」的唯一出处：
 * - 连接表单渲染哪些字段（主机端口 / 文件路径）、默认端口、JDBC URL 预览
 * - 归属哪个 SQL 方言族（决定引号、限行、DDL 模板，见 sqlDialect.ts）
 * - 对象树展示哪些节点（视图 / 存储过程 / 函数 / 触发器 / 事件）
 *
 * 新增数据库只需在 DB_TYPE_REGISTRY 追加一条，不要再在组件里写 `dbType === 'XXX'`。
 * 运行期还会用服务端返回的档案覆盖驱动可用性等信息（见 applyServerProfiles）。
 *
 * @author yanch
 */

/** 方言族：决定 quote / LIMIT / 布尔字面量等核心语法 */
export type SqlDialectFamily =
  | 'H2_LIKE'
  | 'MYSQL_LIKE'
  | 'ORACLE_LIKE'
  | 'POSTGRES_LIKE'
  | 'SQLITE_LIKE'
  | 'SQLSERVER_LIKE';

/** 连接形态：网络服务 / 嵌入式文件 / 两者皆可 */
export type DbConnectionForm = 'FILE' | 'SERVER' | 'SERVER_OR_FILE';

/** 一级节点语义：库还是模式 */
export type DbInstanceKind = 'DATABASE' | 'SCHEMA';

/** 对象树能力开关：不支持的分类直接不渲染，避免点开永远是空文件夹 */
export interface DbObjectCapabilities {
  views: boolean;
  procedures: boolean;
  functions: boolean;
  triggers: boolean;
  /** 事件调度器，目前只有 MySQL 族有 */
  events: boolean;
  /** 是否允许在对象树右键创建/删除实例 */
  manageInstance: boolean;
}

export interface DbTypeDescriptor {
  code: string;
  label: string;
  family: SqlDialectFamily;
  connectionForm: DbConnectionForm;
  instanceKind: DbInstanceKind;
  defaultPort: number;
  /** 含 {host} {port} {database} 占位符 */
  urlTemplate: string;
  /** 未指定库名时连接的维护库 */
  maintenanceDatabase?: string;
  /** 是否强制要求用户名密码 */
  credentialRequired: boolean;
  capabilities: DbObjectCapabilities;
  /** 文件型库的路径示例 */
  fileExample?: string;
  /** 服务端回填：驱动类名 */
  driverClassName?: string;
  /** 服务端回填：驱动是否已部署 */
  driverAvailable?: boolean;
  /** 服务端回填：驱动缺失提示 */
  driverHint?: string;
}

const FULL_OBJECTS: DbObjectCapabilities = {
  views: true,
  procedures: true,
  functions: true,
  triggers: true,
  events: true,
  manageInstance: true,
};

const NO_EVENT_OBJECTS: DbObjectCapabilities = {
  ...FULL_OBJECTS,
  events: false,
};

/** Oracle / 达梦：一级节点是用户模式，建删由 DBA 操作，不在客户端开放 */
const SCHEMA_OBJECTS: DbObjectCapabilities = {
  ...NO_EVENT_OBJECTS,
  manageInstance: false,
};

const EMBEDDED_OBJECTS: DbObjectCapabilities = {
  views: true,
  procedures: false,
  functions: false,
  triggers: true,
  events: false,
  manageInstance: false,
};

const MYSQL_PARAMS =
  '?useUnicode=true&characterEncoding=utf8&useSSL=false' +
  '&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai';

function mysqlLike(code: string, label: string): DbTypeDescriptor {
  return {
    code,
    label,
    family: 'MYSQL_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'DATABASE',
    defaultPort: 3306,
    urlTemplate: `jdbc:mysql://{host}:{port}/{database}${MYSQL_PARAMS}`,
    credentialRequired: true,
    capabilities: FULL_OBJECTS,
  };
}

function postgresLike(
  code: string,
  label: string,
  overrides: Partial<DbTypeDescriptor> = {},
): DbTypeDescriptor {
  return {
    code,
    label,
    family: 'POSTGRES_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'DATABASE',
    defaultPort: 5432,
    urlTemplate: 'jdbc:postgresql://{host}:{port}/{database}',
    maintenanceDatabase: 'postgres',
    credentialRequired: true,
    capabilities: NO_EVENT_OBJECTS,
    ...overrides,
  };
}

function oracleLike(code: string, label: string): DbTypeDescriptor {
  return {
    code,
    label,
    family: 'ORACLE_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'SCHEMA',
    defaultPort: 1521,
    urlTemplate: 'jdbc:oracle:thin:@{host}:{port}:{database}',
    credentialRequired: true,
    capabilities: SCHEMA_OBJECTS,
  };
}

/**
 * 产品码 → 描述符。键必须与后端 DataBaseType 枚举名一致。
 */
export const DB_TYPE_REGISTRY: Record<string, DbTypeDescriptor> = {
  // MySQL 族
  MY_SQL: mysqlLike('MY_SQL', 'MySQL'),
  OCEANBASE: mysqlLike('OCEANBASE', 'OceanBase'),
  OCEANBASE_MYSQL: mysqlLike('OCEANBASE_MYSQL', 'OceanBase MySQL'),
  TDSQL: mysqlLike('TDSQL', 'TDSQL'),
  POLARDB: mysqlLike('POLARDB', 'PolarDB'),
  POLARDB_MYSQL: mysqlLike('POLARDB_MYSQL', 'PolarDB MySQL'),

  // PostgreSQL 族
  POSTGRE_SQL: postgresLike('POSTGRE_SQL', 'PostgreSQL'),
  POLARDB_PG: postgresLike('POLARDB_PG', 'PolarDB PostgreSQL'),
  KINGBASE: postgresLike('KINGBASE', '人大金仓 KingbaseES', {
    defaultPort: 54_321,
    urlTemplate: 'jdbc:kingbase8://{host}:{port}/{database}',
    maintenanceDatabase: 'test',
  }),
  GAUSSDB: postgresLike('GAUSSDB', '华为 GaussDB / openGauss', {
    urlTemplate: 'jdbc:opengauss://{host}:{port}/{database}',
  }),
  HIGHGO: postgresLike('HIGHGO', '瀚高 HighGo DB', {
    defaultPort: 5866,
  }),

  // Oracle 族
  ORACLE: oracleLike('ORACLE', 'Oracle'),
  OCEANBASE_ORACLE: oracleLike('OCEANBASE_ORACLE', 'OceanBase Oracle'),
  DM: {
    code: 'DM',
    label: '达梦 DM',
    family: 'ORACLE_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'SCHEMA',
    defaultPort: 5236,
    urlTemplate: 'jdbc:dm://{host}:{port}/{database}',
    credentialRequired: true,
    capabilities: SCHEMA_OBJECTS,
  },

  // SQL Server
  SQL_SERVER: {
    code: 'SQL_SERVER',
    label: 'Microsoft SQL Server',
    family: 'SQLSERVER_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'DATABASE',
    defaultPort: 1433,
    urlTemplate:
      'jdbc:sqlserver://{host}:{port};databaseName={database};encrypt=false',
    maintenanceDatabase: 'master',
    credentialRequired: true,
    capabilities: NO_EVENT_OBJECTS,
  },

  // 嵌入式
  SQLITE: {
    code: 'SQLITE',
    label: 'SQLite',
    family: 'SQLITE_LIKE',
    connectionForm: 'FILE',
    instanceKind: 'DATABASE',
    defaultPort: 0,
    urlTemplate: 'jdbc:sqlite:{database}',
    credentialRequired: false,
    capabilities: EMBEDDED_OBJECTS,
    fileExample: 'D:/data/app.db',
  },
  H2: {
    code: 'H2',
    label: 'H2',
    family: 'H2_LIKE',
    connectionForm: 'SERVER_OR_FILE',
    instanceKind: 'SCHEMA',
    defaultPort: 9092,
    urlTemplate: 'jdbc:h2:tcp://{host}:{port}/{database}',
    credentialRequired: false,
    capabilities: { ...EMBEDDED_OBJECTS, functions: true },
    fileExample: 'D:/data/h2/app',
  },
};

const FALLBACK = DB_TYPE_REGISTRY.MY_SQL as DbTypeDescriptor;

/** 归一化 dbType 字符串（兼容历史别名与中文写法） */
export function normalizeDbTypeCode(dbType?: null | string): string {
  const raw = String(dbType || 'MY_SQL')
    .trim()
    .toUpperCase()
    .replaceAll(/[\s-]+/g, '_');
  if (DB_TYPE_REGISTRY[raw]) return raw;
  if (raw.includes('POSTGRES') || raw === 'PG') return 'POSTGRE_SQL';
  if (raw.includes('SQLSERVER') || raw === 'MSSQL') return 'SQL_SERVER';
  if (raw.includes('MARIA')) return 'MY_SQL';
  if (raw.includes('达梦') || raw.includes('DAMENG')) return 'DM';
  if (raw.includes('KINGBASE') || raw.includes('金仓')) return 'KINGBASE';
  if (raw.includes('HIGHGO') || raw.includes('瀚高')) return 'HIGHGO';
  if (raw.includes('OCEANBASE') && raw.includes('ORACLE')) {
    return 'OCEANBASE_ORACLE';
  }
  if (raw.includes('OCEANBASE')) return 'OCEANBASE';
  if (raw.includes('GAUSS')) return 'GAUSSDB';
  if (raw.includes('TDSQL')) return 'TDSQL';
  if (raw.includes('POLAR') && (raw.includes('PG') || raw.includes('POSTGRE'))) {
    return 'POLARDB_PG';
  }
  if (raw.includes('POLAR')) return 'POLARDB_MYSQL';
  if (raw.includes('SQLITE')) return 'SQLITE';
  return raw;
}

/** 解析产品描述符；未登记的类型退回 MySQL，保证界面可用 */
export function resolveDbType(dbType?: null | string): DbTypeDescriptor {
  return DB_TYPE_REGISTRY[normalizeDbTypeCode(dbType)] || FALLBACK;
}

export function resolveDialectFamily(dbType?: null | string): SqlDialectFamily {
  return resolveDbType(dbType).family;
}

export function resolveCapabilities(
  dbType?: null | string,
): DbObjectCapabilities {
  return resolveDbType(dbType).capabilities;
}

/** 一级节点在界面上的称呼：数据库 / 模式 */
export function instanceLabelOf(dbType?: null | string): string {
  return resolveDbType(dbType).instanceKind === 'SCHEMA' ? '模式' : '数据库';
}

/** 连接表单下拉项 */
export function listDbTypeOptions(): Array<{ code: string; label: string }> {
  return Object.values(DB_TYPE_REGISTRY).map((d) => ({
    code: d.code,
    label: d.label,
  }));
}

/**
 * 按模板拼 JDBC URL 供表单预览；库名为空时代入维护库。
 * 与后端 DbTypeProfile.buildJdbcUrl 保持同一套占位规则。
 */
export function buildJdbcUrl(
  dbType: null | string | undefined,
  parts: { database?: string; host?: string; port?: number | string },
): string {
  const descriptor = resolveDbType(dbType);
  const database =
    parts.database?.trim() || descriptor.maintenanceDatabase || '';
  const port = String(parts.port ?? '').trim() || String(descriptor.defaultPort);
  return descriptor.urlTemplate
    .replace('{host}', parts.host?.trim() ?? '')
    .replace('{port}', port)
    .replace('{database}', database);
}

/** 服务端档案的原始结构（/dataBaseOperate/dbTypeProfiles） */
export interface ServerDbTypeProfile {
  code: string;
  label?: string;
  family?: string;
  connectionForm?: string;
  instanceKind?: string;
  defaultPort?: number;
  urlTemplate?: string;
  maintenanceDatabase?: string;
  driverClassName?: string;
  driverAvailable?: boolean;
  driverHint?: string;
  credentialRequired?: boolean;
}

/**
 * 用服务端档案回填本地注册表。
 * 服务端是驱动可用性与 URL 模板的权威来源；对象树能力等纯 UI 信息仍以本地为准。
 */
export function applyServerProfiles(profiles: ServerDbTypeProfile[]): void {
  for (const profile of profiles || []) {
    if (!profile?.code) continue;
    const local = DB_TYPE_REGISTRY[profile.code];
    if (!local) continue;
    if (profile.label) local.label = profile.label;
    if (profile.defaultPort != null) local.defaultPort = profile.defaultPort;
    if (profile.urlTemplate) local.urlTemplate = profile.urlTemplate;
    if (profile.maintenanceDatabase !== undefined) {
      local.maintenanceDatabase = profile.maintenanceDatabase ?? undefined;
    }
    if (profile.credentialRequired != null) {
      local.credentialRequired = profile.credentialRequired;
    }
    local.driverClassName = profile.driverClassName;
    local.driverAvailable = profile.driverAvailable;
    local.driverHint = profile.driverHint;
  }
}
