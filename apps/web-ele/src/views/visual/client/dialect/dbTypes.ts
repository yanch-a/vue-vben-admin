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
  | 'MONGODB_LIKE'
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
  /** 事件：MySQL 为 EVENT；其它库为调度任务（pg_cron / Scheduler / Agent Job） */
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

/** 服务端库：对象树全开。事件在非 MySQL 上对应调度任务（pg_cron / Scheduler / Agent Job） */
const NO_EVENT_OBJECTS: DbObjectCapabilities = {
  ...FULL_OBJECTS,
  events: true,
};

/** Oracle/达梦的对象树不开放一级节点管理，Oracle 节点是服务对应的数据库，达梦节点是用户模式。 */
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

const MONGODB_OBJECTS: DbObjectCapabilities = {
  views: true,
  procedures: false,
  functions: false,
  triggers: false,
  events: false,
  manageInstance: true,
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
    // 后端 Oracle Handler 返回 V$SERVICES 的服务名；真实对象 schema 仍由表元数据提供。
    instanceKind: 'DATABASE',
    defaultPort: 1521,
    urlTemplate: 'jdbc:oracle:thin:@//{host}:{port}/{database}',
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
    // 一级节点是 Schema，允许 CREATE / DROP SCHEMA（SQLite 仍走新建连接）
    capabilities: { ...EMBEDDED_OBJECTS, functions: true, manageInstance: true },
    fileExample: 'D:/data/h2/app',
  },
  MONGODB: {
    code: 'MONGODB',
    label: 'MongoDB',
    family: 'MONGODB_LIKE',
    connectionForm: 'SERVER',
    instanceKind: 'DATABASE',
    defaultPort: 27017,
    urlTemplate: 'mongodb://{host}:{port}/{database}',
    maintenanceDatabase: 'admin',
    credentialRequired: false,
    capabilities: MONGODB_OBJECTS,
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
  if (raw.includes('MONGO')) return 'MONGODB';
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

const JDBC_PARAM_KEY = /^[A-Za-z][A-Za-z0-9_.]*$/;
const JDBC_PARAM_VALUE = /^[A-Za-z0-9._~%:/+\-@,]*$/;

export interface JdbcParamPair {
  key: string;
  value: string;
}

/**
 * 解析连接参数。空白返回空列表；格式不对时返回 error，供表单即时提示。
 * 规则与后端 JdbcUrlParameterMerger 保持一致。
 */
export function parseJdbcParams(extra?: null | string): {
  error: string;
  pairs: JdbcParamPair[];
} {
  const pairs: JdbcParamPair[] = [];
  const raw = String(extra ?? '').trim();
  if (!raw) return { error: '', pairs };
  if (raw.length > 1024) {
    return { error: '连接参数不能超过 1024 个字符', pairs };
  }
  let text = raw;
  while (text.startsWith('?') || text.startsWith('&') || text.startsWith(';')) {
    text = text.slice(1).trim();
  }
  if (!text) return { error: '', pairs };
  for (const token of text.split(/[&;\r\n]+/)) {
    const item = token.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    if (eq <= 0) {
      return { error: '连接参数格式应为 key=value，多项用 & 或 ; 分隔', pairs: [] };
    }
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (!JDBC_PARAM_KEY.test(key)) {
      return { error: `连接参数名无效：${key}`, pairs: [] };
    }
    if (!JDBC_PARAM_VALUE.test(value)) {
      return {
        error: `连接参数值含有不支持的字符：${key}。空格、引号和 & ; ? # 请先百分号编码`,
        pairs: [],
      };
    }
    const index = pairs.findIndex(
      (pair) => pair.key.toLowerCase() === key.toLowerCase(),
    );
    if (index >= 0) pairs[index] = { key, value };
    else pairs.push({ key, value });
    if (pairs.length > 32) {
      return { error: '连接参数最多 32 项', pairs: [] };
    }
  }
  return { error: '', pairs };
}

/** 表单校验用：合法或空白时返回空串。 */
export function jdbcParamsError(extra?: null | string): string {
  return parseJdbcParams(extra).error;
}

/**
 * 把额外参数合并进连接串。SQL Server / H2 用分号，其余用查询串。
 * 同名参数覆盖已有值，供「实际使用」预览和后端拼 URL 的结果一致。
 */
export function applyJdbcParams(
  jdbcUrl: string,
  extra?: null | string,
  dbType?: null | string,
): string {
  const { error, pairs } = parseJdbcParams(extra);
  if (error || pairs.length === 0 || !jdbcUrl) return jdbcUrl;
  const family = resolveDbType(dbType).family;
  const semicolon =
    !jdbcUrl.includes('?') &&
    (family === 'SQLSERVER_LIKE' ||
      family === 'H2_LIKE' ||
      jdbcUrl.toLowerCase().startsWith('jdbc:sqlserver:') ||
      jdbcUrl.toLowerCase().startsWith('jdbc:h2:'));
  return mergeJdbcParamSegments(jdbcUrl, pairs, semicolon);
}

function mergeJdbcParamSegments(
  jdbcUrl: string,
  pairs: JdbcParamPair[],
  semicolon: boolean,
): string {
  const mark = semicolon ? jdbcUrl.indexOf(';') : jdbcUrl.indexOf('?');
  const head = mark < 0 ? jdbcUrl : jdbcUrl.slice(0, mark);
  const tail = mark < 0 ? '' : jdbcUrl.slice(mark + 1);
  const delimiter = semicolon ? ';' : '&';
  const segments = tail ? tail.split(delimiter).filter(Boolean) : [];
  for (const pair of pairs) {
    const rendered = `${pair.key}=${pair.value}`;
    const index = segments.findIndex((segment) => {
      const eq = segment.indexOf('=');
      return (
        eq > 0 && segment.slice(0, eq).toLowerCase() === pair.key.toLowerCase()
      );
    });
    if (index >= 0) segments[index] = rendered;
    else segments.push(rendered);
  }
  if (segments.length === 0) return head;
  return `${head}${semicolon ? ';' : '?'}${segments.join(delimiter)}`;
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
