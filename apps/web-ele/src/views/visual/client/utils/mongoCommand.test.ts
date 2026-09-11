import { describe, expect, it } from 'vitest';

import {
  buildMongoDeleteCommand,
  buildMongoInsertCommand,
  buildMongoUpdateCommand,
  isMongoEditableQuery,
  mongoCommandKind,
  parseMongoCollection,
} from './mongoCommand';

describe('MongoDB 命令适配', () => {
  it('识别查询、数据写入和结构变更命令', () => {
    expect(mongoCommandKind('db.users.find({ age: { $gte: 18 } }).limit(20)')).toBe('read');
    expect(mongoCommandKind('db.users.updateOne({"_id":"abc"},{"$set":{"name":"new"}})')).toBe('data');
    expect(mongoCommandKind('db.users.createIndex({"email":1},{"unique":true})')).toBe('schema');
    expect(mongoCommandKind('db.createView("active_users", "users", [])')).toBe('schema');
    expect(mongoCommandKind('db.getCollectionInfos({ name: "users" })')).toBe('read');
    expect(parseMongoCollection('db.getCollection("users").find({})')).toEqual({ table: 'users' });
  });

  it('只允许 find 结果进入文档编辑，并按 _id 生成 update/delete', () => {
    const ref = { table: 'users' };
    const original = { _id: '507f1f77bcf86cd799439011', name: 'old', profile: { level: 1 } };
    const edited = { ...original, name: 'new' };
    expect(isMongoEditableQuery('db.users.find({})')).toBe(true);
    expect(isMongoEditableQuery('db.users.aggregate([{ "$match": {} }])')).toBe(false);
    expect(buildMongoUpdateCommand(ref, original, edited, ['name'], ['_id'])).toContain(
      'updateOne({"_id":"507f1f77bcf86cd799439011"}, {"$set":{"name":"new"}})',
    );
    expect(buildMongoDeleteCommand(ref, original, Object.keys(original), ['_id'])).toContain(
      'deleteOne({"_id":"507f1f77bcf86cd799439011"})',
    );
    expect(buildMongoInsertCommand(ref, edited, Object.keys(edited))).toBe(
      'db.getCollection("users").insertOne({"name":"new","profile":{"level":1}});',
    );
    expect(() =>
      buildMongoUpdateCommand(ref, original, { ...edited, _id: 'changed' }, ['_id'], ['_id']),
    ).toThrow('_id 不可修改');
    expect(() =>
      buildMongoDeleteCommand(ref, { name: 'no id' }, ['name'], []),
    ).toThrow('缺少 _id');
  });
});
