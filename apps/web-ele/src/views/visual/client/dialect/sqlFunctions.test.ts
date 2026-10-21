import { describe, expect, it } from 'vitest';

import {
  applyTypedCase,
  findSqlFunction,
  findSqlFunctionCallAt,
  formatSqlFunctionSignature,
  listSqlFunctions,
  listSqlKeywords,
  resolveActiveParam,
} from './sqlFunctions';

/** 各数据库函数目录与参数提示定位。@author yanch */
describe('SQL 函数目录', () => {
  it('不同数据库给出各自的函数', () => {
    expect(findSqlFunction('MY_SQL', 'date_format')).toBeTruthy();
    expect(findSqlFunction('MY_SQL', 'TO_CHAR')).toBeUndefined();
    expect(findSqlFunction('POSTGRE_SQL', 'string_agg')).toBeTruthy();
    expect(findSqlFunction('ORACLE', 'NVL')).toBeTruthy();
    expect(findSqlFunction('SQL_SERVER', 'GETDATE')).toBeTruthy();
    expect(findSqlFunction('SQLITE', 'STRFTIME')).toBeTruthy();
  });

  it('函数名不重复，签名可读', () => {
    for (const dbType of ['MY_SQL', 'POSTGRE_SQL', 'ORACLE', 'SQL_SERVER', 'SQLITE', 'H2']) {
      const names = listSqlFunctions(dbType).map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
    const def = findSqlFunction('MY_SQL', 'DATE_FORMAT')!;
    expect(formatSqlFunctionSignature(def)).toBe('DATE_FORMAT(date, format)');
    expect(formatSqlFunctionSignature(findSqlFunction('ORACLE', 'SYSDATE')!)).toBe('SYSDATE');
  });

  it('MongoDB 不提供 SQL 函数和关键字', () => {
    expect(listSqlFunctions('MONGODB')).toEqual([]);
    expect(listSqlKeywords('MONGODB')).toEqual([]);
  });

  it('按用户输入的大小写插入', () => {
    expect(applyTypedCase('DATE_FORMAT', 'date_f')).toBe('date_format');
    expect(applyTypedCase('DATE_FORMAT', 'DATE')).toBe('DATE_FORMAT');
    expect(applyTypedCase('DATE_FORMAT', 'Date')).toBe('DATE_FORMAT');
  });
});

describe('函数参数提示定位', () => {
  it('按顶层逗号计算当前参数', () => {
    expect(findSqlFunctionCallAt("select date_format(create_time, ")).toEqual({ name: 'date_format', argIndex: 1 });
    expect(findSqlFunctionCallAt('select concat(a, substr(b, 1')).toEqual({ name: 'substr', argIndex: 1 });
    expect(findSqlFunctionCallAt('select concat(a, substr(b, 1), ')).toEqual({ name: 'concat', argIndex: 2 });
  });

  it('字符串里的逗号和括号不计入', () => {
    expect(findSqlFunctionCallAt("select concat('a,(b', ")).toEqual({ name: 'concat', argIndex: 1 });
    // 光标在未闭合字符串里不弹提示
    expect(findSqlFunctionCallAt("select concat('a, ")).toBeNull();
  });

  it('括号已闭合时返回 null；IN ( 这类关键字括号由函数目录查不到而自然忽略', () => {
    expect(findSqlFunctionCallAt('select count(*) ')).toBeNull();
    expect(findSqlFunctionCallAt('select * from t where id in (')).toMatchObject({ name: 'in' });
    expect(findSqlFunctionCallAt('select (')).toMatchObject({ name: 'select' });
  });

  it('变参函数超出参数个数时停在最后一个真实参数', () => {
    const def = findSqlFunction('MY_SQL', 'CONCAT')!;
    expect(resolveActiveParam(def, 0)).toBe(0);
    expect(resolveActiveParam(def, 5)).toBe(1);
  });
});
