import type { EtlNode, EtlPipeline } from '#/api/visual/etl';

/** 通用算子目录与默认配置，保持旧 1.0 节点协议及稳定 ID。@author yanch */
export const ETL_OPERATORS = [
  { type: 'source.inline', label: '内嵌数据 / CSV', help: '用于小型参考表和样例数据，最多 10000 行；批量源数据使用 SQL 查询。' },
  { type: 'transform.filter', label: '条件筛选 / 分流', help: '条件返回 true 的行通过。反选可将不匹配的数据送到另一条分支。' },
  { type: 'transform.derive', label: '计算字段', help: '字段表达式引用原始输入；覆盖同名字段必须明确开启。' },
  { type: 'transform.union', label: '多路合并', help: '按所选输入的顺序合并，保持每个输入的行序，不自动去重。' },
  { type: 'transform.join', label: '跨源关联', help: '右侧建立有界索引，左侧逐行关联；默认 NULL 不匹配，允许一对多。' },
  { type: 'transform.distinct', label: '按键去重', help: '相同复合键只保留第一行，数字按精确数值比较，文本区分大小写。' },
  { type: 'transform.sort', label: '多字段排序', help: '支持升降序和 NULL 位置，相同键保持原始行序；大数据排序建议下推 SQL。' },
  { type: 'transform.aggregate', label: '分组聚合', help: '支持 count、sum、avg、min、max，金额使用十进制计算；空分组输出 count=0。' },
  { type: 'transform.assert', label: '数据质量断言', help: '任意行不符合条件则终止当前步骤；将断言放在写入前，避免不合格数据入库。' },
] as const;

/** 判断能产生可被后续查询参数、转换和写入引用的行结果。 */
export function isEtlRowSource(type: string): boolean {
  return ['database.query', 'transform.select'].includes(type) || ETL_OPERATORS.some((operator) => operator.type === type);
}

/** 统一所有引用来源，依赖连线、删除保护和编辑器使用同一规则。 */
export function etlInputReferences(config: Record<string, any>): string[] {
  return [...new Set<string>([
    config.inputStepId, config.rightStepId, ...(config.inputStepIds || []),
    ...(config.parameters || []).map((parameter: any) => parameter.stepId),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))];
}

/** 新建转换默认严格配置；不自动覆盖字段、放宽结构或绕过质量校验。 */
export function createOperatorConfig(type: string, inputStepId = ''): EtlNode['config'] {
  const condition = { op: 'eq', args: [{ field: 'status' }, { value: 'active' }] };
  switch (type) {
    case 'source.inline': return { columns: ['id', 'name'], rows: [] };
    case 'transform.filter': return { inputStepId, condition, invert: false };
    case 'transform.assert': return { inputStepId, condition, message: '数据未通过质量检查' };
    case 'transform.derive': return { inputStepId, replaceExisting: false, fields: [] };
    case 'transform.union': return { inputStepIds: inputStepId ? [inputStepId] : [], schemaMode: 'strict' };
    case 'transform.join': return { inputStepId, rightStepId: '', joinType: 'left', keys: [], rightPrefix: 'right_', nullEquals: false, requireUniqueRight: false };
    case 'transform.distinct': return { inputStepId, keys: [] };
    case 'transform.sort': return { inputStepId, orderBy: [] };
    case 'transform.aggregate': return { inputStepId, groupBy: [], metrics: [] };
    default: throw new Error(`未支持的算子：${type}`);
  }
}

/** 可直接预览和运行的参考流程，无业务数据库写入，供用户理解跨源转换后再替换输入。 */
export function createFlexibleExamplePipeline(id: string): EtlPipeline {
  const node = (suffix: string, type: string, name: string, config: EtlNode['config']): EtlNode => ({ id: `${id}-${suffix}`, type, name, typeVersion: 1, config });
  const orders = node('orders', 'source.inline', '订单样例', { rows: [{ customer_id: 1, amount: '100.10' }, { customer_id: 1, amount: '200.20' }, { customer_id: 2, amount: '50.00' }] });
  const customers = node('customers', 'source.inline', '客户样例', { rows: [{ id: 1, name: '张三' }, { id: 2, name: '李四' }] });
  const converted = node('converted', 'transform.derive', '精确金额转换', { inputStepId: orders.id, replaceExisting: true, fields: [{ target: 'amount', expression: { op: 'cast', type: 'decimal', args: [{ field: 'amount' }] } }] });
  const joined = node('joined', 'transform.join', '关联客户', { inputStepId: converted.id, rightStepId: customers.id, joinType: 'left', keys: [{ left: 'customer_id', right: 'id' }], rightFields: [{ source: 'name', target: 'customer_name' }], requireUniqueRight: true });
  // 姓名不是客户身份；保留左侧 ID，防止同名客户或缺失客户资料的订单被合并。
  const grouped = node('grouped', 'transform.aggregate', '按客户汇总', { inputStepId: joined.id, groupBy: ['customer_id', 'customer_name'], metrics: [{ target: 'total_amount', field: 'amount', op: 'sum' }, { target: 'order_count', op: 'count' }] });
  const sorted = node('sorted', 'transform.sort', '总金额降序', { inputStepId: grouped.id, orderBy: [{ field: 'total_amount', direction: 'desc', nulls: 'last' }] });
  const nodes = [orders, customers, converted, joined, grouped, sorted];
  return { id, name: '跨源转换示例', enabled: true, dependsOn: [], nodes, edges: nodes.flatMap((item) => etlInputReferences(item.config).map((source) => ({ source, target: item.id, sourcePort: 'output', targetPort: 'input', generated: true }))) };
}

/** RFC 4180 风格 CSV 解析，支持 BOM、引号、换行和转义双引号；数据保持文本以免大整数失真。 */
export function parseEtlCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  if (text.length > 1024 * 1024) throw new Error('CSV 最多 1MB；大文件请先导入数据库再查询');
  const records: string[][] = [];
  let record: string[] = [], value = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const finish = () => { record.push(value); records.push(record); record = []; value = ''; closed = false; if (records.length > 10001) throw new Error('CSV 最多 10000 行数据'); };
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') { if (input[index + 1] === '"') { value += '"'; index++; } else { quoted = false; closed = true; } }
      else value += char;
    } else if (char === ',' || char === '\r' || char === '\n') {
      if (char === ',') { record.push(value); value = ''; closed = false; }
      else { if (char === '\r' && input[index + 1] === '\n') index++; finish(); }
    } else if (char === '"' && value === '' && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error('CSV 引号位置不正确'); value += char; }
  }
  if (quoted) throw new Error('CSV 引号尚未闭合');
  if (record.length || value || closed) finish();
  const columns = records.shift()?.map((name) => name.trim()) || [];
  if (!columns.length || columns.some((name) => !name) || new Set(columns.map((name) => name.toLowerCase())).size !== columns.length) throw new Error('CSV 表头不能为空或重名');
  const rows = records.map((values, index) => {
    if (values.length !== columns.length) throw new Error(`CSV 行列数与表头不一致: ${index + 2}`);
    return Object.fromEntries(columns.map((name, i) => [name, values[i]!]));
  });
  return { columns, rows };
}
