/**
 * SQL 内置函数目录（按方言族区分）
 *
 * 用途：
 * 1. 编辑器输入函数名时给出补全，选中后自动补上括号并弹出参数提示
 * 2. 光标在函数括号内时，按逗号位置高亮当前参数（签名帮助）
 * 3. 鼠标悬停在函数名上时显示签名和说明
 *
 * 维护约定：
 * - params 每项是一个参数的展示名；可选参数用 [xx] 包起来，变参用 ... 结尾
 * - 无括号调用的伪函数（如 Oracle 的 SYSDATE、标准 SQL 的 CURRENT_DATE）设 noParens
 * - 新增数据库产品只要映射到已有方言族即可复用；新增方言族才需要在这里补一组
 *
 * @author yanch
 */
import type { SqlDialectFamily } from './dbTypes';

import { resolveDialectFamily } from './dbTypes';

export interface SqlFunctionDef {
  /** 函数名（大写，补全时会按用户输入的大小写插入） */
  name: string;
  /** 参数展示名，按位置排列 */
  params: string[];
  /** 简短中文说明 */
  desc: string;
  /** 分类：聚合 / 字符串 / 日期时间 / 数值 / 条件 / 转换 / 窗口 / JSON / 系统 */
  category: string;
  /** 返回值类型（可选，仅用于展示） */
  returns?: string;
  /** 使用示例（可选） */
  example?: string;
  /** 不带括号调用，如 SYSDATE、CURRENT_DATE */
  noParens?: boolean;
}

/** 简写构造器：保持函数目录一行一个，方便对照官方文档增删 */
function fn(
  name: string,
  params: string[],
  desc: string,
  category: string,
  extra?: Partial<Pick<SqlFunctionDef, 'example' | 'noParens' | 'returns'>>,
): SqlFunctionDef {
  return { name, params, desc, category, ...extra };
}

const AGG = '聚合';
const STR = '字符串';
const DATE = '日期时间';
const NUM = '数值';
const COND = '条件';
const CONV = '转换';
const WIN = '窗口';
const JSON_CAT = 'JSON';
const SYS = '系统';

// ─────────────────────────── 多数方言共有的函数 ───────────────────────────

const AGG_STD: SqlFunctionDef[] = [
  fn('COUNT', ['expr'], '统计行数；COUNT(*) 含 NULL 行，COUNT(col) 忽略 NULL', AGG, { example: 'COUNT(DISTINCT user_id)' }),
  fn('SUM', ['expr'], '求和，忽略 NULL', AGG),
  fn('AVG', ['expr'], '平均值，忽略 NULL', AGG),
  fn('MIN', ['expr'], '最小值', AGG),
  fn('MAX', ['expr'], '最大值', AGG),
];

const WINDOW_STD: SqlFunctionDef[] = [
  fn('ROW_NUMBER', [], '窗口内行号，从 1 开始，不并列', WIN, { example: 'ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC)' }),
  fn('RANK', [], '窗口内排名，并列后跳号', WIN),
  fn('DENSE_RANK', [], '窗口内排名，并列后不跳号', WIN),
  fn('NTILE', ['n'], '把窗口内的行均分为 n 组，返回组号', WIN),
  fn('LAG', ['expr', '[offset]', '[default]'], '取当前行之前第 offset 行的值', WIN),
  fn('LEAD', ['expr', '[offset]', '[default]'], '取当前行之后第 offset 行的值', WIN),
  fn('FIRST_VALUE', ['expr'], '窗口内第一行的值', WIN),
  fn('LAST_VALUE', ['expr'], '窗口内最后一行的值（注意窗口帧默认到当前行）', WIN),
];

const COMMON_STD: SqlFunctionDef[] = [
  fn('COALESCE', ['expr1', 'expr2', '...'], '返回第一个非 NULL 参数', COND),
  fn('NULLIF', ['expr1', 'expr2'], '两值相等返回 NULL，否则返回 expr1', COND),
  fn('CAST', ['expr AS type'], '类型转换', CONV, { example: 'CAST(amount AS DECIMAL(10,2))' }),
  fn('ABS', ['x'], '绝对值', NUM),
  fn('ROUND', ['x', '[digits]'], '四舍五入到指定小数位', NUM),
  fn('FLOOR', ['x'], '向下取整', NUM),
  fn('UPPER', ['str'], '转大写', STR),
  fn('LOWER', ['str'], '转小写', STR),
  fn('TRIM', ['str'], '去掉两端空白（也支持 TRIM(BOTH x FROM str)）', STR),
  fn('LTRIM', ['str'], '去掉左侧空白', STR),
  fn('RTRIM', ['str'], '去掉右侧空白', STR),
  fn('REPLACE', ['str', 'from_str', 'to_str'], '替换全部匹配的子串', STR),
  fn('CURRENT_TIMESTAMP', [], '当前日期时间', DATE, { noParens: true }),
];

// ─────────────────────────── MySQL / MariaDB / TiDB 等 ───────────────────────────

const MYSQL_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD,
  fn('GROUP_CONCAT', ['[DISTINCT] expr [ORDER BY ...] [SEPARATOR sep]'], '把分组内的值拼成字符串，默认逗号分隔', AGG, { example: "GROUP_CONCAT(name ORDER BY id SEPARATOR ';')" }),
  fn('JSON_ARRAYAGG', ['expr'], '把分组内的值聚合成 JSON 数组', AGG),
  fn('JSON_OBJECTAGG', ['key', 'value'], '把分组内的键值聚合成 JSON 对象', AGG),
  fn('ANY_VALUE', ['expr'], '取分组内任意一个值（ONLY_FULL_GROUP_BY 下使用）', AGG),
  fn('CONCAT', ['str1', 'str2', '...'], '拼接字符串；任一参数为 NULL 结果即 NULL', STR),
  fn('CONCAT_WS', ['separator', 'str1', 'str2', '...'], '用分隔符拼接，跳过 NULL', STR),
  fn('SUBSTRING', ['str', 'pos', '[len]'], '截取子串，pos 从 1 开始，负数表示从末尾数', STR),
  fn('SUBSTR', ['str', 'pos', '[len]'], '同 SUBSTRING', STR),
  fn('SUBSTRING_INDEX', ['str', 'delim', 'count'], '按分隔符取第 count 段之前（负数取之后）的内容', STR, { example: "SUBSTRING_INDEX('a.b.c', '.', -1)" }),
  fn('LEFT', ['str', 'len'], '取左侧 len 个字符', STR),
  fn('RIGHT', ['str', 'len'], '取右侧 len 个字符', STR),
  fn('LENGTH', ['str'], '字节长度（utf8mb4 中文占 3~4 字节）', STR),
  fn('CHAR_LENGTH', ['str'], '字符个数', STR),
  fn('LOCATE', ['substr', 'str', '[pos]'], '子串首次出现位置，找不到返回 0', STR),
  fn('INSTR', ['str', 'substr'], '子串首次出现位置，找不到返回 0', STR),
  fn('LPAD', ['str', 'len', 'padstr'], '左侧填充到指定长度', STR),
  fn('RPAD', ['str', 'len', 'padstr'], '右侧填充到指定长度', STR),
  fn('REVERSE', ['str'], '反转字符串', STR),
  fn('REPEAT', ['str', 'count'], '重复字符串 count 次', STR),
  fn('FORMAT', ['x', 'decimals', '[locale]'], '数字格式化为千分位字符串', STR),
  fn('FIND_IN_SET', ['str', 'strlist'], '在逗号分隔列表中查找位置', STR),
  fn('FIELD', ['str', 'str1', 'str2', '...'], '返回 str 在后续参数中的位置，常用于自定义排序', STR),
  fn('HEX', ['x'], '转十六进制字符串', STR),
  fn('UNHEX', ['str'], '十六进制字符串转二进制', STR),
  fn('MD5', ['str'], 'MD5 摘要（32 位十六进制）', STR),
  fn('SHA2', ['str', 'hash_length'], 'SHA-2 摘要，hash_length 取 224/256/384/512', STR),
  fn('UUID', [], '生成 UUID 字符串', STR),
  fn('REGEXP_LIKE', ['expr', 'pattern', '[match_type]'], '正则匹配，返回 1/0（8.0+）', STR),
  fn('REGEXP_REPLACE', ['expr', 'pattern', 'repl'], '正则替换（8.0+）', STR),
  fn('REGEXP_SUBSTR', ['expr', 'pattern'], '取正则匹配到的子串（8.0+）', STR),
  fn('IFNULL', ['expr', 'alt'], 'expr 为 NULL 时返回 alt', COND),
  fn('IF', ['cond', 'then_value', 'else_value'], '条件为真返回第二个参数，否则第三个', COND),
  fn('ISNULL', ['expr'], '是否为 NULL，返回 1/0', COND),
  fn('GREATEST', ['v1', 'v2', '...'], '参数中的最大值', COND),
  fn('LEAST', ['v1', 'v2', '...'], '参数中的最小值', COND),
  fn('NOW', ['[fsp]'], '当前日期时间（语句开始时刻）', DATE),
  fn('SYSDATE', ['[fsp]'], '当前日期时间（函数执行时刻）', DATE),
  fn('CURDATE', [], '当前日期', DATE),
  fn('CURTIME', ['[fsp]'], '当前时间', DATE),
  fn('CURRENT_DATE', [], '当前日期', DATE, { noParens: true }),
  fn('UNIX_TIMESTAMP', ['[date]'], '转 Unix 秒级时间戳', DATE),
  fn('FROM_UNIXTIME', ['ts', '[format]'], 'Unix 时间戳转日期时间', DATE),
  fn('DATE_FORMAT', ['date', 'format'], '日期格式化', DATE, { example: "DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s')" }),
  fn('STR_TO_DATE', ['str', 'format'], '按格式解析字符串为日期', DATE, { example: "STR_TO_DATE('2024-01-31', '%Y-%m-%d')" }),
  fn('DATE_ADD', ['date', 'INTERVAL expr unit'], '日期加上时间间隔', DATE, { example: 'DATE_ADD(NOW(), INTERVAL 7 DAY)' }),
  fn('DATE_SUB', ['date', 'INTERVAL expr unit'], '日期减去时间间隔', DATE, { example: 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)' }),
  fn('DATEDIFF', ['date1', 'date2'], '相差天数 date1 - date2', DATE),
  fn('TIMESTAMPDIFF', ['unit', 'start', 'end'], '按单位计算两个时间的差值', DATE, { example: 'TIMESTAMPDIFF(MINUTE, start_time, end_time)' }),
  fn('TIMESTAMPADD', ['unit', 'n', 'datetime'], '按单位加时间', DATE),
  fn('DATE', ['expr'], '取日期部分', DATE),
  fn('TIME', ['expr'], '取时间部分', DATE),
  fn('YEAR', ['date'], '取年份', DATE),
  fn('MONTH', ['date'], '取月份 1~12', DATE),
  fn('DAY', ['date'], '取日 1~31', DATE),
  fn('HOUR', ['time'], '取小时', DATE),
  fn('MINUTE', ['time'], '取分钟', DATE),
  fn('SECOND', ['time'], '取秒', DATE),
  fn('WEEK', ['date', '[mode]'], '一年中的第几周', DATE),
  fn('WEEKDAY', ['date'], '星期几，0=周一', DATE),
  fn('DAYOFWEEK', ['date'], '星期几，1=周日', DATE),
  fn('DAYOFYEAR', ['date'], '一年中的第几天', DATE),
  fn('LAST_DAY', ['date'], '当月最后一天', DATE),
  fn('EXTRACT', ['unit FROM date'], '提取日期部分', DATE, { example: 'EXTRACT(YEAR FROM create_time)' }),
  fn('CONVERT', ['expr', 'type'], '类型转换；CONVERT(expr USING charset) 转字符集', CONV),
  fn('CEIL', ['x'], '向上取整', NUM),
  fn('CEILING', ['x'], '向上取整', NUM),
  fn('MOD', ['n', 'm'], '取余', NUM),
  fn('POWER', ['x', 'y'], 'x 的 y 次方', NUM),
  fn('SQRT', ['x'], '平方根', NUM),
  fn('RAND', ['[seed]'], '0~1 随机数', NUM),
  fn('TRUNCATE', ['x', 'digits'], '截断到指定小数位（不四舍五入）', NUM),
  fn('SIGN', ['x'], '符号：-1/0/1', NUM),
  fn('JSON_EXTRACT', ['json_doc', 'path', '...'], '按路径取 JSON 值，等价 col->\'$.path\'', JSON_CAT, { example: "JSON_EXTRACT(attrs, '$.name')" }),
  fn('JSON_UNQUOTE', ['json_val'], '去掉 JSON 字符串引号，等价 ->>', JSON_CAT),
  fn('JSON_OBJECT', ['key', 'value', '...'], '构造 JSON 对象', JSON_CAT),
  fn('JSON_ARRAY', ['value', '...'], '构造 JSON 数组', JSON_CAT),
  fn('JSON_CONTAINS', ['target', 'candidate', '[path]'], 'JSON 是否包含指定值', JSON_CAT),
  fn('JSON_LENGTH', ['json_doc', '[path]'], 'JSON 数组/对象长度', JSON_CAT),
  fn('JSON_SET', ['json_doc', 'path', 'val', '...'], '设置 JSON 路径的值（存在则替换）', JSON_CAT),
  fn('JSON_TABLE', ['expr', 'path COLUMNS (...)'], '把 JSON 展开成关系表（8.0+）', JSON_CAT),
  fn('LAST_INSERT_ID', ['[expr]'], '本连接最近一次自增 ID', SYS),
  fn('DATABASE', [], '当前库名', SYS),
  fn('USER', [], '当前连接用户', SYS),
  fn('VERSION', [], '服务器版本', SYS),
  fn('ROW_COUNT', [], '上一条 DML 影响的行数', SYS),
  fn('INET_ATON', ['ip'], 'IPv4 字符串转整数', SYS),
  fn('INET_NTOA', ['n'], '整数转 IPv4 字符串', SYS),
];

// ─────────────────────────── PostgreSQL / Kingbase / openGauss 等 ───────────────────────────

const POSTGRES_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD,
  fn('STRING_AGG', ['expr', 'delimiter [ORDER BY ...]'], '把分组内的值拼成字符串', AGG, { example: "STRING_AGG(name, ',' ORDER BY id)" }),
  fn('ARRAY_AGG', ['expr [ORDER BY ...]'], '把分组内的值聚合成数组', AGG),
  fn('JSON_AGG', ['expr'], '把分组内的值聚合成 JSON 数组', AGG),
  fn('JSONB_AGG', ['expr'], '把分组内的值聚合成 JSONB 数组', AGG),
  fn('BOOL_AND', ['expr'], '全部为真才为真', AGG),
  fn('BOOL_OR', ['expr'], '任一为真即为真', AGG),
  fn('PERCENTILE_CONT', ['fraction'], '连续分位数，配合 WITHIN GROUP (ORDER BY ...)', AGG, { example: 'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)' }),
  fn('CONCAT', ['str1', 'str2', '...'], '拼接字符串，忽略 NULL', STR),
  fn('CONCAT_WS', ['separator', 'str1', 'str2', '...'], '用分隔符拼接，跳过 NULL', STR),
  fn('SUBSTRING', ['str', 'pos', '[len]'], '截取子串；也可写成 SUBSTRING(str FROM pos FOR len)', STR),
  fn('SUBSTR', ['str', 'pos', '[len]'], '截取子串', STR),
  fn('LEFT', ['str', 'n'], '取左侧 n 个字符', STR),
  fn('RIGHT', ['str', 'n'], '取右侧 n 个字符', STR),
  fn('LENGTH', ['str'], '字符个数', STR),
  fn('CHAR_LENGTH', ['str'], '字符个数', STR),
  fn('POSITION', ['substr IN str'], '子串位置，找不到返回 0', STR),
  fn('STRPOS', ['str', 'substr'], '子串位置，找不到返回 0', STR),
  fn('LPAD', ['str', 'len', '[fill]'], '左侧填充', STR),
  fn('RPAD', ['str', 'len', '[fill]'], '右侧填充', STR),
  fn('BTRIM', ['str', '[chars]'], '去掉两端指定字符', STR),
  fn('REVERSE', ['str'], '反转字符串', STR),
  fn('REPEAT', ['str', 'n'], '重复字符串 n 次', STR),
  fn('SPLIT_PART', ['str', 'delimiter', 'n'], '按分隔符取第 n 段（从 1 开始）', STR, { example: "SPLIT_PART('a,b,c', ',', 2)" }),
  fn('INITCAP', ['str'], '单词首字母大写', STR),
  fn('TRANSLATE', ['str', 'from', 'to'], '逐字符替换', STR),
  fn('FORMAT', ['formatstr', 'arg', '...'], '类似 sprintf 的格式化，%s %I %L', STR),
  fn('QUOTE_IDENT', ['str'], '按标识符规则加双引号', STR),
  fn('QUOTE_LITERAL', ['str'], '按字面量规则加单引号', STR),
  fn('MD5', ['str'], 'MD5 摘要', STR),
  fn('ENCODE', ['bytea', 'format'], '二进制编码为 base64/hex/escape', STR),
  fn('DECODE', ['str', 'format'], '把 base64/hex 文本解码为二进制', STR),
  fn('REGEXP_REPLACE', ['str', 'pattern', 'replacement', '[flags]'], '正则替换，flags 传 g 全部替换', STR),
  fn('REGEXP_MATCHES', ['str', 'pattern', '[flags]'], '返回正则匹配的分组数组', STR),
  fn('STRING_TO_ARRAY', ['str', 'delimiter'], '按分隔符拆成数组', STR),
  fn('ARRAY_TO_STRING', ['array', 'delimiter', '[null_str]'], '数组拼成字符串', STR),
  fn('GEN_RANDOM_UUID', [], '生成随机 UUID（13+ 内置）', STR),
  fn('NOW', [], '当前事务开始时间', DATE),
  fn('CURRENT_DATE', [], '当前日期', DATE, { noParens: true }),
  fn('CLOCK_TIMESTAMP', [], '函数执行时的实际时间', DATE),
  fn('DATE_TRUNC', ['field', 'source'], '按单位截断时间', DATE, { example: "DATE_TRUNC('month', created_at)" }),
  fn('DATE_PART', ['field', 'source'], '提取时间部分', DATE, { example: "DATE_PART('year', created_at)" }),
  fn('EXTRACT', ['field FROM source'], '提取时间部分', DATE, { example: 'EXTRACT(EPOCH FROM created_at)' }),
  fn('AGE', ['timestamp', '[timestamp]'], '两个时间的间隔（年月日）', DATE),
  fn('MAKE_DATE', ['year', 'month', 'day'], '构造日期', DATE),
  fn('TO_CHAR', ['value', 'format'], '日期/数字格式化为字符串', CONV, { example: "TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS')" }),
  fn('TO_DATE', ['str', 'format'], '按格式解析为日期', CONV),
  fn('TO_TIMESTAMP', ['str', 'format'], '按格式解析为时间戳；单参数时把 Unix 秒转时间戳', CONV),
  fn('TO_NUMBER', ['str', 'format'], '按格式解析为数字', CONV),
  fn('GREATEST', ['v1', 'v2', '...'], '参数中的最大值', COND),
  fn('LEAST', ['v1', 'v2', '...'], '参数中的最小值', COND),
  fn('CEIL', ['x'], '向上取整', NUM),
  fn('MOD', ['n', 'm'], '取余', NUM),
  fn('POWER', ['x', 'y'], 'x 的 y 次方', NUM),
  fn('SQRT', ['x'], '平方根', NUM),
  fn('RANDOM', [], '0~1 随机数', NUM),
  fn('TRUNC', ['x', '[digits]'], '截断小数', NUM),
  fn('GENERATE_SERIES', ['start', 'stop', '[step]'], '生成序列行', SYS, { example: "GENERATE_SERIES('2024-01-01'::date, '2024-01-31', '1 day')" }),
  fn('UNNEST', ['array'], '把数组展开成多行', SYS),
  fn('ARRAY_LENGTH', ['array', 'dimension'], '数组长度', SYS),
  fn('JSON_BUILD_OBJECT', ['key', 'value', '...'], '构造 JSON 对象', JSON_CAT),
  fn('JSONB_BUILD_OBJECT', ['key', 'value', '...'], '构造 JSONB 对象', JSON_CAT),
  fn('TO_JSON', ['value'], '值转 JSON', JSON_CAT),
  fn('TO_JSONB', ['value'], '值转 JSONB', JSON_CAT),
  fn('ROW_TO_JSON', ['record'], '整行转 JSON 对象', JSON_CAT),
  fn('JSONB_EXTRACT_PATH_TEXT', ['jsonb', 'path', '...'], '按路径取文本值，等价 #>>', JSON_CAT),
  fn('JSONB_SET', ['target', 'path', 'new_value', '[create_missing]'], '设置 JSONB 路径的值', JSON_CAT, { example: "JSONB_SET(attrs, '{name}', '\"x\"')" }),
  fn('JSONB_ARRAY_ELEMENTS', ['jsonb'], '把 JSONB 数组展开成多行', JSON_CAT),
  fn('NEXTVAL', ['regclass'], '取序列下一个值', SYS, { example: "NEXTVAL('seq_order_id')" }),
  fn('CURRVAL', ['regclass'], '本会话序列当前值', SYS),
  fn('SETVAL', ['regclass', 'value', '[is_called]'], '设置序列当前值', SYS),
  fn('VERSION', [], '服务器版本', SYS),
  fn('CURRENT_SCHEMA', [], '当前 schema', SYS, { noParens: true }),
  fn('CURRENT_USER', [], '当前用户', SYS, { noParens: true }),
  fn('PG_SIZE_PRETTY', ['bigint'], '字节数转可读大小', SYS),
  fn('PG_TOTAL_RELATION_SIZE', ['regclass'], '表含索引、TOAST 的总大小', SYS),
];

// ─────────────────────────── Oracle / 达梦 ───────────────────────────

const ORACLE_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD,
  fn('LISTAGG', ['expr', "[delimiter]"], '把分组内的值拼成字符串，配合 WITHIN GROUP (ORDER BY ...)', AGG, { example: "LISTAGG(name, ',') WITHIN GROUP (ORDER BY id)" }),
  fn('RATIO_TO_REPORT', ['expr'], '当前值占窗口合计的比例', WIN),
  fn('NVL', ['expr', 'alt'], 'expr 为 NULL 时返回 alt', COND),
  fn('NVL2', ['expr', 'not_null_value', 'null_value'], 'expr 非 NULL 返回第二个参数，否则第三个', COND),
  fn('DECODE', ['expr', 'search', 'result', '...', '[default]'], '按值匹配返回结果，类似简单 CASE', COND, { example: "DECODE(status, 1, '启用', 0, '停用', '未知')" }),
  fn('GREATEST', ['v1', 'v2', '...'], '参数中的最大值', COND),
  fn('LEAST', ['v1', 'v2', '...'], '参数中的最小值', COND),
  fn('CONCAT', ['str1', 'str2'], '拼接两个字符串（多个请用 ||）', STR),
  fn('SUBSTR', ['str', 'pos', '[len]'], '截取子串，pos 从 1 开始，负数从末尾数', STR),
  fn('INSTR', ['str', 'substr', '[pos]', '[occurrence]'], '子串位置，找不到返回 0', STR),
  fn('LENGTH', ['str'], '字符个数', STR),
  fn('LENGTHB', ['str'], '字节长度', STR),
  fn('LPAD', ['str', 'len', '[pad]'], '左侧填充', STR),
  fn('RPAD', ['str', 'len', '[pad]'], '右侧填充', STR),
  fn('INITCAP', ['str'], '单词首字母大写', STR),
  fn('TRANSLATE', ['str', 'from', 'to'], '逐字符替换', STR),
  fn('REGEXP_LIKE', ['str', 'pattern', '[match_param]'], '正则匹配条件，用在 WHERE 中', STR),
  fn('REGEXP_SUBSTR', ['str', 'pattern', '[pos]', '[occurrence]'], '取正则匹配到的子串', STR),
  fn('REGEXP_REPLACE', ['str', 'pattern', '[replacement]'], '正则替换', STR),
  fn('REGEXP_INSTR', ['str', 'pattern', '[pos]', '[occurrence]'], '正则匹配位置', STR),
  fn('TO_CHAR', ['value', '[format]'], '日期/数字格式化为字符串', CONV, { example: "TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS')" }),
  fn('TO_DATE', ['str', '[format]'], '按格式解析为日期', CONV, { example: "TO_DATE('2024-01-31', 'YYYY-MM-DD')" }),
  fn('TO_TIMESTAMP', ['str', '[format]'], '按格式解析为时间戳', CONV),
  fn('TO_NUMBER', ['str', '[format]'], '字符串转数字', CONV),
  fn('TO_CLOB', ['str'], '转 CLOB', CONV),
  fn('SYSDATE', [], '数据库服务器当前日期时间', DATE, { noParens: true }),
  fn('SYSTIMESTAMP', [], '数据库服务器当前时间戳（含时区）', DATE, { noParens: true }),
  fn('CURRENT_DATE', [], '会话时区的当前日期时间', DATE, { noParens: true }),
  fn('ADD_MONTHS', ['date', 'n'], '加 n 个月', DATE),
  fn('MONTHS_BETWEEN', ['date1', 'date2'], '相差月数', DATE),
  fn('LAST_DAY', ['date'], '当月最后一天', DATE),
  fn('NEXT_DAY', ['date', 'weekday'], '之后第一个指定星期几', DATE),
  fn('TRUNC', ['date_or_number', '[fmt]'], '截断日期（默认到天）或数字', DATE, { example: "TRUNC(SYSDATE, 'MM')" }),
  fn('EXTRACT', ['field FROM source'], '提取日期部分', DATE, { example: 'EXTRACT(YEAR FROM SYSDATE)' }),
  fn('NUMTODSINTERVAL', ['n', 'unit'], '数字转天-秒间隔', DATE),
  fn('CEIL', ['x'], '向上取整', NUM),
  fn('MOD', ['n', 'm'], '取余', NUM),
  fn('POWER', ['x', 'y'], 'x 的 y 次方', NUM),
  fn('SQRT', ['x'], '平方根', NUM),
  fn('SIGN', ['x'], '符号：-1/0/1', NUM),
  fn('JSON_VALUE', ['json', 'path'], '按路径取标量值（12c+）', JSON_CAT),
  fn('JSON_QUERY', ['json', 'path'], '按路径取对象/数组（12c+）', JSON_CAT),
  fn('JSON_OBJECT', ['KEY k VALUE v', '...'], '构造 JSON 对象', JSON_CAT),
  fn('SYS_GUID', [], '生成 16 字节全局唯一 ID', SYS),
  fn('SYS_CONTEXT', ['namespace', 'parameter'], '读取会话上下文', SYS, { example: "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')" }),
  fn('USERENV', ['parameter'], '读取会话环境信息', SYS),
  fn('USER', [], '当前登录用户', SYS, { noParens: true }),
  fn('ROWNUM', [], '结果行号伪列，常用于限行', SYS, { noParens: true }),
  fn('EMPTY_CLOB', [], '空 CLOB', SYS),
];

// ─────────────────────────── SQL Server ───────────────────────────

const SQLSERVER_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD,
  fn('COUNT_BIG', ['expr'], '统计行数，返回 BIGINT', AGG),
  fn('STRING_AGG', ['expr', 'separator'], '把分组内的值拼成字符串（2017+），配合 WITHIN GROUP', AGG, { example: "STRING_AGG(name, ',') WITHIN GROUP (ORDER BY id)" }),
  fn('ISNULL', ['expr', 'replacement'], 'expr 为 NULL 时返回 replacement', COND),
  fn('IIF', ['cond', 'true_value', 'false_value'], '条件表达式', COND),
  fn('CHOOSE', ['index', 'v1', 'v2', '...'], '按序号返回参数', COND),
  fn('CONCAT', ['str1', 'str2', '...'], '拼接字符串，NULL 当空串', STR),
  fn('CONCAT_WS', ['separator', 'str1', 'str2', '...'], '用分隔符拼接（2017+）', STR),
  fn('SUBSTRING', ['str', 'start', 'length'], '截取子串，三个参数都必填', STR),
  fn('LEFT', ['str', 'n'], '取左侧 n 个字符', STR),
  fn('RIGHT', ['str', 'n'], '取右侧 n 个字符', STR),
  fn('LEN', ['str'], '字符个数（不含尾部空格）', STR),
  fn('DATALENGTH', ['expr'], '字节长度', STR),
  fn('CHARINDEX', ['substr', 'str', '[start]'], '子串位置，找不到返回 0', STR),
  fn('PATINDEX', ["'%pattern%'", 'str'], '通配符模式首次出现位置', STR),
  fn('REPLICATE', ['str', 'n'], '重复字符串 n 次', STR),
  fn('REVERSE', ['str'], '反转字符串', STR),
  fn('STUFF', ['str', 'start', 'length', 'replace_str'], '删除指定区间并插入新串', STR),
  fn('STRING_SPLIT', ['str', 'separator'], '按分隔符拆成多行（表值函数）', STR),
  fn('FORMAT', ['value', 'format', '[culture]'], '按 .NET 格式串格式化', STR, { example: "FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss')" }),
  fn('CONVERT', ['type', 'expr', '[style]'], '类型转换，style 控制日期格式', CONV, { example: 'CONVERT(VARCHAR(19), GETDATE(), 120)' }),
  fn('TRY_CAST', ['expr AS type'], '转换失败返回 NULL', CONV),
  fn('TRY_CONVERT', ['type', 'expr', '[style]'], '转换失败返回 NULL', CONV),
  fn('GETDATE', [], '当前日期时间', DATE),
  fn('GETUTCDATE', [], '当前 UTC 日期时间', DATE),
  fn('SYSDATETIME', [], '当前日期时间（高精度）', DATE),
  fn('DATEADD', ['datepart', 'number', 'date'], '按单位加时间', DATE, { example: 'DATEADD(DAY, 7, GETDATE())' }),
  fn('DATEDIFF', ['datepart', 'start', 'end'], '按单位计算差值', DATE, { example: 'DATEDIFF(MINUTE, start_time, end_time)' }),
  fn('DATEPART', ['datepart', 'date'], '提取日期部分（整数）', DATE),
  fn('DATENAME', ['datepart', 'date'], '提取日期部分（字符串）', DATE),
  fn('DATEFROMPARTS', ['year', 'month', 'day'], '构造日期', DATE),
  fn('EOMONTH', ['date', '[months]'], '当月最后一天', DATE),
  fn('YEAR', ['date'], '取年份', DATE),
  fn('MONTH', ['date'], '取月份', DATE),
  fn('DAY', ['date'], '取日', DATE),
  fn('CEILING', ['x'], '向上取整', NUM),
  fn('POWER', ['x', 'y'], 'x 的 y 次方', NUM),
  fn('SQRT', ['x'], '平方根', NUM),
  fn('RAND', ['[seed]'], '0~1 随机数', NUM),
  fn('SIGN', ['x'], '符号：-1/0/1', NUM),
  fn('NEWID', [], '生成 UNIQUEIDENTIFIER', SYS),
  fn('SCOPE_IDENTITY', [], '当前作用域最近插入的自增值', SYS),
  fn('OBJECT_ID', ['name', '[type]'], '取对象 ID，常用于判断表是否存在', SYS),
  fn('DB_NAME', ['[db_id]'], '当前库名', SYS),
  fn('JSON_VALUE', ['json', 'path'], '按路径取标量值', JSON_CAT, { example: "JSON_VALUE(attrs, '$.name')" }),
  fn('JSON_QUERY', ['json', '[path]'], '按路径取对象/数组', JSON_CAT),
  fn('ISJSON', ['expr'], '是否为合法 JSON', JSON_CAT),
  fn('OPENJSON', ['json', '[path]'], '把 JSON 展开成行（表值函数）', JSON_CAT),
];

// ─────────────────────────── SQLite ───────────────────────────

const SQLITE_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD.filter((f) => f.name !== 'FLOOR'),
  fn('GROUP_CONCAT', ['expr', '[separator]'], '把分组内的值拼成字符串', AGG),
  fn('TOTAL', ['expr'], '求和，始终返回浮点数（全 NULL 时为 0.0）', AGG),
  fn('JSON_GROUP_ARRAY', ['expr'], '把分组内的值聚合成 JSON 数组', AGG),
  fn('JSON_GROUP_OBJECT', ['key', 'value'], '把分组内的键值聚合成 JSON 对象', AGG),
  fn('IFNULL', ['expr', 'alt'], 'expr 为 NULL 时返回 alt', COND),
  fn('IIF', ['cond', 'true_value', 'false_value'], '条件表达式（3.32+）', COND),
  fn('SUBSTR', ['str', 'pos', '[len]'], '截取子串', STR),
  fn('SUBSTRING', ['str', 'pos', '[len]'], '截取子串', STR),
  fn('LENGTH', ['str'], '字符个数', STR),
  fn('INSTR', ['str', 'substr'], '子串位置，找不到返回 0', STR),
  fn('PRINTF', ['format', 'arg', '...'], '类似 C printf 的格式化', STR),
  fn('HEX', ['x'], '转十六进制字符串', STR),
  fn('QUOTE', ['x'], '转成 SQL 字面量文本', STR),
  fn('DATE', ['time', '[modifier]', '...'], '取日期 YYYY-MM-DD', DATE, { example: "DATE('now', '-1 day')" }),
  fn('TIME', ['time', '[modifier]', '...'], '取时间 HH:MM:SS', DATE),
  fn('DATETIME', ['time', '[modifier]', '...'], '取日期时间', DATE, { example: "DATETIME('now', 'localtime')" }),
  fn('JULIANDAY', ['time', '[modifier]', '...'], '儒略日数，常用于计算天数差', DATE),
  fn('STRFTIME', ['format', 'time', '[modifier]', '...'], '日期格式化', DATE, { example: "STRFTIME('%Y-%m', created_at)" }),
  fn('UNIXEPOCH', ['[time]', '[modifier]'], '转 Unix 秒级时间戳（3.38+）', DATE),
  fn('CURRENT_DATE', [], '当前 UTC 日期', DATE, { noParens: true }),
  fn('RANDOM', [], '随机 64 位整数', NUM),
  fn('TYPEOF', ['x'], '值的存储类型：integer/real/text/blob/null', SYS),
  fn('LAST_INSERT_ROWID', [], '本连接最近插入的 rowid', SYS),
  fn('CHANGES', [], '上一条 DML 影响的行数', SYS),
  fn('JSON', ['json'], '校验并压缩 JSON', JSON_CAT),
  fn('JSON_EXTRACT', ['json', 'path', '...'], '按路径取 JSON 值', JSON_CAT, { example: "JSON_EXTRACT(attrs, '$.name')" }),
  fn('JSON_OBJECT', ['key', 'value', '...'], '构造 JSON 对象', JSON_CAT),
  fn('JSON_ARRAY', ['value', '...'], '构造 JSON 数组', JSON_CAT),
];

// ─────────────────────────── H2 ───────────────────────────

const H2_FUNCS: SqlFunctionDef[] = [
  ...AGG_STD,
  ...WINDOW_STD,
  ...COMMON_STD,
  fn('LISTAGG', ['expr', '[delimiter]'], '把分组内的值拼成字符串，配合 WITHIN GROUP', AGG),
  fn('ARRAY_AGG', ['expr'], '把分组内的值聚合成数组', AGG),
  fn('IFNULL', ['expr', 'alt'], 'expr 为 NULL 时返回 alt', COND),
  fn('NVL', ['expr', 'alt'], 'expr 为 NULL 时返回 alt', COND),
  fn('CASEWHEN', ['cond', 'a', 'b'], '条件为真返回 a，否则 b', COND),
  fn('DECODE', ['expr', 'search', 'result', '...', '[default]'], '按值匹配返回结果', COND),
  fn('GREATEST', ['v1', 'v2', '...'], '参数中的最大值', COND),
  fn('LEAST', ['v1', 'v2', '...'], '参数中的最小值', COND),
  fn('CONCAT', ['str1', 'str2', '...'], '拼接字符串，忽略 NULL', STR),
  fn('CONCAT_WS', ['separator', 'str1', 'str2', '...'], '用分隔符拼接', STR),
  fn('SUBSTRING', ['str', 'pos', '[len]'], '截取子串', STR),
  fn('LEFT', ['str', 'n'], '取左侧 n 个字符', STR),
  fn('RIGHT', ['str', 'n'], '取右侧 n 个字符', STR),
  fn('LENGTH', ['str'], '字符个数', STR),
  fn('LOCATE', ['substr', 'str', '[pos]'], '子串位置，找不到返回 0', STR),
  fn('POSITION', ['substr', 'str'], '子串位置', STR),
  fn('LPAD', ['str', 'len', '[pad]'], '左侧填充', STR),
  fn('RPAD', ['str', 'len', '[pad]'], '右侧填充', STR),
  fn('REGEXP_REPLACE', ['str', 'pattern', 'replacement'], '正则替换', STR),
  fn('RANDOM_UUID', [], '生成 UUID', STR),
  fn('NOW', [], '当前日期时间', DATE),
  fn('CURRENT_DATE', [], '当前日期', DATE, { noParens: true }),
  fn('DATEADD', ['unit', 'n', 'date'], '按单位加时间', DATE, { example: "DATEADD('DAY', 7, CURRENT_DATE)" }),
  fn('DATEDIFF', ['unit', 'start', 'end'], '按单位计算差值', DATE),
  fn('FORMATDATETIME', ['date', 'format'], '日期格式化（Java 格式串）', DATE, { example: "FORMATDATETIME(created_at, 'yyyy-MM-dd')" }),
  fn('PARSEDATETIME', ['str', 'format'], '按格式解析日期', DATE),
  fn('EXTRACT', ['field FROM source'], '提取日期部分', DATE),
  fn('YEAR', ['date'], '取年份', DATE),
  fn('MONTH', ['date'], '取月份', DATE),
  fn('CEILING', ['x'], '向上取整', NUM),
  fn('MOD', ['n', 'm'], '取余', NUM),
  fn('POWER', ['x', 'y'], 'x 的 y 次方', NUM),
  fn('SQRT', ['x'], '平方根', NUM),
  fn('RAND', ['[seed]'], '0~1 随机数', NUM),
  fn('TRUNC', ['x', '[digits]'], '截断数字或日期', NUM),
];

const FAMILY_FUNCTIONS: Record<SqlDialectFamily, SqlFunctionDef[]> = {
  MYSQL_LIKE: MYSQL_FUNCS,
  POSTGRES_LIKE: POSTGRES_FUNCS,
  ORACLE_LIKE: ORACLE_FUNCS,
  SQLSERVER_LIKE: SQLSERVER_FUNCS,
  SQLITE_LIKE: SQLITE_FUNCS,
  H2_LIKE: H2_FUNCS,
  // MongoDB 走 Shell 语法，不提供 SQL 函数
  MONGODB_LIKE: [],
};

// ─────────────────────────── 关键字 ───────────────────────────

/**
 * 常用 SQL 关键字。补全里带上关键字，是为了让输入 from / left 后按回车得到的是关键字本身，
 * 而不是前缀相同的 FROM_UNIXTIME( / LEFT( 函数。
 */
const KEYWORDS_STD = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'USING', 'AS', 'DISTINCT',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'ASC', 'DESC', 'UNION', 'ALL', 'INTERSECT', 'EXCEPT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'OVER', 'PARTITION',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'MERGE',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'VIEW', 'INDEX', 'PRIMARY', 'KEY', 'DEFAULT',
  'COMMIT', 'ROLLBACK', 'TRUE', 'FALSE',
];

const KEYWORDS_EXTRA: Record<SqlDialectFamily, string[]> = {
  MYSQL_LIKE: ['LIMIT', 'OFFSET', 'SHOW', 'DATABASES', 'TABLES', 'COLUMNS', 'DESCRIBE', 'EXPLAIN', 'REPLACE', 'DUPLICATE', 'IGNORE', 'REGEXP', 'INTERVAL', 'STRAIGHT_JOIN', 'AUTO_INCREMENT', 'ENGINE', 'COMMENT'],
  POSTGRES_LIKE: ['LIMIT', 'OFFSET', 'ILIKE', 'RETURNING', 'CONFLICT', 'NOTHING', 'LATERAL', 'INTERVAL', 'EXPLAIN', 'ANALYZE', 'SCHEMA', 'SEQUENCE', 'FILTER', 'WITHIN'],
  ORACLE_LIKE: ['FETCH', 'FIRST', 'NEXT', 'ROWS', 'ONLY', 'CONNECT', 'PRIOR', 'START', 'MINUS', 'DUAL', 'SEQUENCE', 'WITHIN', 'MATCHED'],
  SQLSERVER_LIKE: ['TOP', 'OFFSET', 'FETCH', 'NEXT', 'ROWS', 'ONLY', 'NOLOCK', 'OUTPUT', 'APPLY', 'PIVOT', 'UNPIVOT', 'IDENTITY', 'MATCHED', 'WITHIN'],
  SQLITE_LIKE: ['LIMIT', 'OFFSET', 'PRAGMA', 'GLOB', 'AUTOINCREMENT', 'CONFLICT', 'RETURNING'],
  H2_LIKE: ['LIMIT', 'OFFSET', 'FETCH', 'FIRST', 'ROWS', 'ONLY', 'MINUS', 'SEQUENCE', 'SCHEMA'],
  MONGODB_LIKE: [],
};

/** 当前数据库类型的关键字（MongoDB 返回空） */
export function listSqlKeywords(dbType?: null | string): string[] {
  const family = resolveDialectFamily(dbType);
  if (family === 'MONGODB_LIKE') return [];
  return [...new Set([...KEYWORDS_STD, ...KEYWORDS_EXTRA[family]])];
}

/** 按方言族缓存「函数名 → 定义」索引；同名后定义的覆盖公共定义（方言说明更准确） */
const indexCache = new Map<SqlDialectFamily, Map<string, SqlFunctionDef>>();

function functionIndex(family: SqlDialectFamily): Map<string, SqlFunctionDef> {
  let index = indexCache.get(family);
  if (!index) {
    index = new Map();
    for (const def of FAMILY_FUNCTIONS[family] || []) {
      index.set(def.name.toUpperCase(), def);
    }
    indexCache.set(family, index);
  }
  return index;
}

/** 当前数据库类型可用的全部函数（已去重，按名称排序） */
export function listSqlFunctions(dbType?: null | string): SqlFunctionDef[] {
  const index = functionIndex(resolveDialectFamily(dbType));
  return [...index.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 按名称查函数定义（大小写不敏感），不存在返回 undefined */
export function findSqlFunction(
  dbType: null | string | undefined,
  name: string,
): SqlFunctionDef | undefined {
  if (!name) return undefined;
  return functionIndex(resolveDialectFamily(dbType)).get(name.toUpperCase());
}

/** 签名展示文本，如 DATE_FORMAT(date, format)；无括号伪函数只返回名称 */
export function formatSqlFunctionSignature(def: SqlFunctionDef): string {
  if (def.noParens) return def.name;
  return `${def.name}(${def.params.join(', ')})`;
}

/** 悬停 / 补全详情里的 Markdown 说明 */
export function formatSqlFunctionDoc(def: SqlFunctionDef): string {
  const lines = [
    '```sql',
    formatSqlFunctionSignature(def),
    '```',
    `${def.category} · ${def.desc}`,
  ];
  if (def.example) {
    lines.push('', '示例：', '```sql', def.example, '```');
  }
  return lines.join('\n');
}

/**
 * 按用户输入的大小写决定插入形式：
 * 输入全小写（如 date_f）时插入小写函数名，其余情况保持目录里的大写。
 */
export function applyTypedCase(name: string, typed: string): string {
  if (typed && /[a-z]/.test(typed) && typed === typed.toLowerCase()) {
    return name.toLowerCase();
  }
  return name;
}

export interface SqlFunctionCall {
  /** 光标所在括号前的函数名（原样） */
  name: string;
  /** 当前是第几个参数（从 0 开始，按顶层逗号计数） */
  argIndex: number;
}

/**
 * 找出光标所在的函数调用：从语句开头扫描到光标，跟踪括号栈和顶层逗号。
 * 字符串、注释、带引号标识符里的括号/逗号不计入。
 * 光标不在任何函数括号内（或括号前不是标识符，如子查询 `IN (`）时返回 null。
 */
export function findSqlFunctionCallAt(textBeforeCursor: string): null | SqlFunctionCall {
  const text = textBeforeCursor || '';
  const stack: { name: string; commas: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (c === '-' && n === '-') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === c) {
          // 两个连续引号是转义，继续扫描
          if (text[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        if (text[j] === '\\' && c === "'") j++;
        j++;
      }
      // 光标停在未闭合的字符串里，不弹参数提示
      if (j >= text.length) return null;
      i = j + 1;
      continue;
    }
    if (c === '(') {
      stack.push({ name: identifierBefore(text, i), commas: 0 });
      i++;
      continue;
    }
    if (c === ')') {
      stack.pop();
      i++;
      continue;
    }
    if (c === ',' && stack.length > 0) {
      stack[stack.length - 1]!.commas++;
    }
    i++;
  }
  const top = stack[stack.length - 1];
  if (!top || !top.name) return null;
  return { name: top.name, argIndex: top.commas };
}

/** 取 pos 处左括号前紧挨着的标识符（允许中间有空白）；带点时只取最后一段 */
function identifierBefore(text: string, pos: number): string {
  let j = pos - 1;
  while (j >= 0 && /\s/.test(text[j]!)) j--;
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(text[j]!)) j--;
  return text.slice(j + 1, end);
}

/**
 * 参数提示里要高亮的参数下标。
 * 超出参数个数时：最后一个参数是变参（...）就停在它前一个真实参数上，否则停在最后一个。
 */
export function resolveActiveParam(def: SqlFunctionDef, argIndex: number): number {
  const count = def.params.length;
  if (count === 0) return 0;
  const index = Math.min(Math.max(0, argIndex), count - 1);
  // 落在变参占位 ... 上时，高亮它前面那个真实参数
  if (def.params[index] === '...' && index > 0) return index - 1;
  return index;
}
