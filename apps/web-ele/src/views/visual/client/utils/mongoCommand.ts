import type { TableRef } from './resultRowSql';

export type MongoCommandKind =
  | 'data'
  | 'manage'
  | 'read'
  | 'schema'
  | 'session'
  | 'unknown';

export function isMongoDbType(dbType?: string | null): boolean {
  return String(dbType || '').trim().toUpperCase() === 'MONGODB';
}

function clean(sql: string): string {
  return String(sql || '').trim().replace(/;+\s*$/, '').trim();
}

export function mongoCommandKind(sql: string): MongoCommandKind {
  const s = clean(sql);
  if (/^use(?:\s*\(|\s+\S)/i.test(s)) return 'session';
  if (
    /^db\.getCollection\s*\([^)]*\)\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany)\s*\(/i.test(
      s,
    ) ||
    /^db\.[\w$]+\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany)\s*\(/i.test(
      s,
    )
  ) {
    return 'data';
  }
  if (
    /^db\.createCollection\s*\(/i.test(s) ||
    /^db\.createView\s*\(/i.test(s) ||
    /^db\.runCommand\s*\(\s*\{\s*["']?(?:collMod|createIndexes|dropIndexes)["']?\s*:/i.test(s) ||
    /^db\.(?:getCollection\s*\([^)]*\)|[\w$]+)\.(drop|createIndex|dropIndex)\s*\(/i.test(
      s,
    )
  ) {
    return 'schema';
  }
  if (
    /^db\.dropDatabase\s*\(/i.test(s) ||
    /^db\.getSiblingDB\s*\(.*\)\.createCollection\s*\(/i.test(s)
  )
    return 'manage';
  if (
    /^db\.(?:getCollectionNames|getCollectionInfos|stats|runCommand)\s*\(/i.test(s) ||
    /^db\.(?:getCollection\s*\([^)]*\)|[\w$]+)\.(find|findOne|aggregate|countDocuments|estimatedDocumentCount|distinct|getIndexes|stats)\s*\(/i.test(
      s,
    )
  ) {
    return 'read';
  }
  return 'unknown';
}

/** Parse only collection reads; aggregate output is intentionally not editable. */
export function parseMongoCollection(sql: string): TableRef | null {
  const s = clean(sql);
  const simple = s.match(
    /^db\.([A-Za-z_][A-Za-z0-9_$]*)\.(find|findOne)\s*\(/i,
  );
  if (simple) return { table: simple[1]! };
  const quoted = s.match(
    /^db\.getCollection\s*\(\s*(["'])(.*?)\1\s*\)\.(find|findOne)\s*\(/i,
  );
  return quoted ? { table: quoted[2]! } : null;
}

export function isMongoEditableQuery(sql: string): boolean {
  return !!parseMongoCollection(sql);
}

function mongoJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item === undefined ? null : item,
  );
}

function collectionCall(ref: TableRef, method: string): string {
  return `db.getCollection(${JSON.stringify(ref.table)}).${method}`;
}

function rowFilter(row: Record<string, any>, whereColumns: string[]): Record<string, any> {
  if (!Object.prototype.hasOwnProperty.call(row, '_id') || row._id == null) {
    throw new Error('MongoDB 结果缺少 _id；请保留 _id 投影后再编辑或删除文档');
  }
  const keys = (whereColumns.length ? whereColumns : ['_id']).filter(
    (key) => Object.prototype.hasOwnProperty.call(row, key),
  );
  if (!keys.length) throw new Error('无法构建 MongoDB 过滤条件：没有可用字段');
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

export function buildMongoInsertCommand(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
): string {
  const doc = Object.fromEntries(
    columns
      .filter(
        (key) =>
          key !== '_id' &&
          row[key] !== undefined &&
          Object.prototype.hasOwnProperty.call(row, key),
      )
      .map((key) => [key, row[key]]),
  );
  return `${collectionCall(ref, 'insertOne')}(${mongoJson(doc)});`;
}

export function buildMongoUpdateCommand(
  ref: TableRef,
  original: Record<string, any>,
  edited: Record<string, any>,
  changedColumns: string[],
  whereColumns: string[],
): string {
  if (changedColumns.includes('_id') && edited._id !== original._id) {
    throw new Error('MongoDB 的 _id 不可修改');
  }
  const set = Object.fromEntries(
    changedColumns
      .filter((key) => key !== '_id')
      .map((key) => [key, edited[key]]),
  );
  if (!Object.keys(set).length) throw new Error('没有可更新的字段');
  return `${collectionCall(ref, 'updateOne')}(${mongoJson(
    rowFilter(original, whereColumns),
  )}, {"$set":${mongoJson(set)}});`;
}

export function buildMongoDeleteCommand(
  ref: TableRef,
  row: Record<string, any>,
  columns: string[],
  whereColumns: string[],
): string {
  return `${collectionCall(ref, 'deleteOne')}(${mongoJson(
    rowFilter(row, whereColumns.length ? whereColumns : columns),
  )});`;
}
