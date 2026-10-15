import { resolveSqlDialect } from '../dialect/sqlDialect';

/** JSON 可传输的绑定参数，文本大数和字节不经 JavaScript Number。@author yanch */
export interface ResultEditParameter { value: unknown; jdbcType?: number; typeName?: string }

/** 每条语句拥有独立参数列表；生成 SQL 的同时编译绑定顺序，执行时复用。 */
export function createResultValueWriter(dbType: string, parameters?: ResultEditParameter[]) {
  const dialect = resolveSqlDialect(dbType);
  return (value: any, comparison = false): string => {
    const typed = value?.__lemonTypedValue;
    const raw = typed ? typed.value : value;
    const type = String(typed?.typeName || '').toUpperCase();
    if (parameters) {
      if (!comparison && (/GEOMETRY|GEOGRAPHY|POINT|POLYGON|LINESTRING|SDO_|ROWVERSION/.test(type)
          || dialect.family === 'SQLSERVER_LIKE' && type === 'TIMESTAMP')) throw new Error('该空间或自动生成字段暂不支持安全回写，请使用原生 SQL');
      parameters.push({ value: raw, jdbcType: type === 'XMLTYPE' ? 12 : typed?.jdbcType, typeName: typed?.typeName });
      return dialect.family === 'ORACLE_LIKE' && type === 'XMLTYPE' ? 'XMLTYPE(?)' : '?';
    }
    if (dialect.family === 'ORACLE_LIKE' && (typed?.jdbcType === 2005 || typed?.jdbcType === 2011 || /^(N?CLOB)$/.test(type))) {
      const text = String(raw ?? ''); const functionName = typed?.jdbcType === 2011 || type === 'NCLOB' ? 'TO_NCLOB' : 'TO_CLOB';
      const chunks = text.match(/[\s\S]{1,1000}/g) || [''];
      return chunks.map((chunk) => `${functionName}(${dialect.literal(chunk)})`).join(' || ');
    }
    if (raw && typeof raw === 'object' && '__lemonBinary' in raw) {
      const literal = dialect.literal(raw);
      return dialect.family === 'ORACLE_LIKE' && typed?.jdbcType === 2004 ? `TO_BLOB(${literal})` : literal;
    }
    return dialect.literal(value);
  };
}

/** 按 JDBC 类型选择可比较表达式，不能把 LOB/XML/json/空间类型套普通等号。 */
export function resultValuePredicate(column: string, value: any, dbType: string, write: ReturnType<typeof createResultValueWriter>): string {
  const typed = value?.__lemonTypedValue;
  const raw = typed ? typed.value : value;
  if (raw == null) return `${column} IS NULL`;
  const name = String(typed?.typeName || '').toUpperCase();
  const jdbc = typed?.jdbcType;
  const family = resolveSqlDialect(dbType).family;
  const operand = write(value, true);
  if (family === 'ORACLE_LIKE') {
    if ([2004, 2005, 2011].includes(jdbc) || /^(N?CLOB|BLOB)$/.test(name)) return `DBMS_LOB.COMPARE(${column}, ${operand}) = 0`;
    if (name === 'XMLTYPE') return `DBMS_LOB.COMPARE(XMLSERIALIZE(CONTENT ${column} AS CLOB), XMLSERIALIZE(CONTENT ${operand} AS CLOB)) = 0`;
    if (/SDO_/.test(name)) throw new Error('该 Oracle 对象字段暂不能安全校验原值，请使用原生 SQL');
  }
  if (family === 'POSTGRES_LIKE') {
    if (name === 'JSON' || name === 'XML' || jdbc === 2009 || jdbc === 2003
        || /^(POINT|LSEG|BOX|PATH|POLYGON|CIRCLE)$/.test(name)) return `CAST(${column} AS text) = CAST(${operand} AS text)`;
    if (/^(GEOMETRY|GEOGRAPHY)$/.test(name)) return `ST_AsEWKB(${column}${name === 'GEOGRAPHY' ? '::geometry' : ''}) = ST_AsEWKB(${operand}${name === 'GEOGRAPHY' ? '::geometry' : ''})`;
  }
  if (family === 'SQLSERVER_LIKE') {
    if (name === 'XML' || jdbc === 2009 || /^(TEXT|NTEXT)$/.test(name)) return `CAST(CAST(${column} AS nvarchar(max)) AS varbinary(max)) = CAST(CAST(${operand} AS nvarchar(max)) AS varbinary(max))`;
    if (/^(IMAGE)$/.test(name)) return `CAST(${column} AS varbinary(max)) = ${operand}`;
    if (/^(GEOMETRY|GEOGRAPHY)$/.test(name)) throw new Error('该 SQL Server 空间字段暂不能安全校验原值，请使用原生 SQL');
    if ([1, 12, -1, -9, -15, -16].includes(jdbc)) return `CAST(${column} AS varbinary(max)) = CAST(${operand} AS varbinary(max))`;
  }
  if (family === 'MYSQL_LIKE' && ([1, 12, -1, -9, -15, -16].includes(jdbc) || /GEOMETRY|GEOGRAPHY|POINT|POLYGON|LINESTRING/.test(name))) return `CAST(${column} AS BINARY) = CAST(${operand} AS BINARY)`;
  return `${column} = ${operand}`;
}
