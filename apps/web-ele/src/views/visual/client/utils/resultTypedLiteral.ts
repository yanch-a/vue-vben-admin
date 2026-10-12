import type { SqlDialectFamily } from '../dialect/dbTypes';

/** 保留 JDBC 类型的结果回写值：显示仍用原文本，生成 SQL 时才应用显式类型。
 * @author yanch
 */
export interface TypedResultValue {
  __lemonTypedValue: { value: unknown; jdbcType: number; typeName: string };
}

/** UTF-8 十六进制文字不依赖 MySQL/PG 的反斜杠模式，避免路径字符串被二次转义。 */
export function utf8Hex(text: string): string {
  return [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 大数不经过 JS Number；时间使用方言明确格式，避免 Oracle NLS 隐式转换失败。 */
export function typedResultLiteral(value: TypedResultValue, family: SqlDialectFamily, quote: (value: unknown) => string): string {
  const { value: raw, jdbcType, typeName } = value.__lemonTypedValue;
  if (raw == null) return 'NULL';
  const text = String(raw);
  if ([-6, 5, 4, -5, 2, 3, 6, 7, 8].includes(jdbcType) && family !== 'SQLITE_LIKE') {
    if (/^[+-]?(?:Infinity|NaN)$/i.test(text) && (family === 'POSTGRES_LIKE' || family === 'H2_LIKE')) return quote(raw);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('数值字段请输入有效数字');
    return text;
  }
  if (![91, 92, 93, 2013, 2014].includes(jdbcType)) return quote(raw);
  let datetime = text.replace('T', ' ').replace(/Z$/, '+00:00');
  if (jdbcType === 93 && /^\d{4}-\d{2}-\d{2}$/.test(datetime)) datetime += ' 00:00:00';
  datetime = datetime.replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?=$|[+-])/, '$1:00');
  const escaped = datetime.replaceAll("'", "''");
  if (family === 'ORACLE_LIKE') {
    if (jdbcType === 91 || typeName.toUpperCase() === 'DATE') {
      return `TO_DATE('${escaped}', '${datetime.includes(' ') ? 'YYYY-MM-DD HH24:MI:SS' : 'YYYY-MM-DD'}')`;
    }
    if (jdbcType === 2014 || /WITH TIME ZONE/i.test(typeName)) {
      if (!/[+-]\d{2}:\d{2}$/.test(datetime)) throw new Error('带时区时间必须包含明确的时区偏移');
      datetime = datetime.replace(/\s*([+-]\d{2}:\d{2})$/, ' $1');
      return `TO_TIMESTAMP_TZ('${datetime.replaceAll("'", "''")}', 'YYYY-MM-DD HH24:MI:SS${datetime.includes('.') ? '.FF' : ''} TZH:TZM')`;
    }
    return `TIMESTAMP '${escaped}'`;
  }
  if (family === 'SQLSERVER_LIKE') {
    const type = jdbcType === 91 ? 'date' : jdbcType === 92 ? 'time(7)' : jdbcType === 2014 || /datetimeoffset/i.test(typeName) ? 'datetimeoffset(7)' : 'datetime2(7)';
    return `CAST(${quote(datetime.replace(' ', 'T'))} AS ${type})`;
  }
  return quote(raw);
}
