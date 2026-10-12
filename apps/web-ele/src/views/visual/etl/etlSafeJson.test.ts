import { describe, expect, it } from 'vitest';
import { parseEtlJson } from './etlSafeJson';

/** 防止源/目标键与高精度金额在前端 JSON 导入时被改值。@author yanch */
describe('ETL precision-safe JSON',()=>{
  it.each(['9007199254740993','9007199254740992','0.1234567890123456789','1e309','1e-999','-9007199254740993'])('rejects numeric precision loss: %s',(number)=>{
    expect(()=>parseEtlJson(`{"rows":[{"value":${number}}]}`)).toThrow('不能精确表示');
  });
  it('preserves ordinary values, numeric strings, trailing zeros and scientific notation',()=>{
    expect(parseEtlJson('{"a":1.2300e2,"b":0.1,"c":"9007199254740993","d":true,"e":null,"f":-1}')).toEqual({a:123,b:0.1,c:'9007199254740993',d:true,e:null,f:-1});
  });
  it('does not scan numeric text inside SQL or escaped JSON strings',()=>{
    const value={sql:'SELECT 9007199254740993, "0.1234567890123456789" AS v',text:'\\"9007199254740993',rows:[{id:1}]};
    expect(parseEtlJson(JSON.stringify(value))).toEqual(value);
  });
  it('rejects invalid syntax and oversized payloads before applying a draft',()=>{
    expect(()=>parseEtlJson('{broken')).toThrow();expect(()=>parseEtlJson('"long text"',2)).toThrow('限制');
  });
});
