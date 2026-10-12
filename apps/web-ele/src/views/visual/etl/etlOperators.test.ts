import { describe, expect, it, vi } from 'vitest';
import { createFlexibleExamplePipeline, createOperatorConfig, ETL_OPERATORS, etlInputReferences, isEtlRowSource, parseEtlCsv } from './etlOperators';
import { createSqlPipeline, normalizeSqlDocument, syncStepDependencies } from './etlModel';
vi.mock('#/locales/ui-text', () => ({ translateUiText: (text: string) => text }));

/** 算子引用、默认值和 CSV 精度/格式回归测试。@author yanch */
describe('flexible ETL operators', () => {
  it('creates a complete independent example with every input dependency', () => {
    const pipeline=createFlexibleExamplePipeline('example');
    expect(pipeline.nodes).toHaveLength(6);expect(pipeline.nodes.every((node)=>!node.resourceRef)).toBe(true);
    for(const node of pipeline.nodes)for(const source of etlInputReferences(node.config))expect(pipeline.edges.some((edge)=>edge.source===source&&edge.target===node.id)).toBe(true);
    expect(pipeline.nodes.map((node)=>node.type)).not.toContain('database.write');
    const restored=normalizeSqlDocument({formatVersion:'1.0',workspace:{id:'w',name:'w'},resources:{},variables:{},pipelines:[pipeline]});
    expect(restored.pipelines[0]?.nodes[0]?.config.columns).toBeUndefined();
    expect(restored.pipelines[0]?.nodes[0]?.config.rows[0]).toEqual({customer_id:1,amount:'100.10'});
    expect(restored.pipelines[0]?.nodes.find((node)=>node.type==='transform.aggregate')?.config.groupBy).toEqual(['customer_id','customer_name']);
    expect(restored.pipelines[0]?.nodes.find((node)=>node.type==='transform.join')?.config.requireUniqueRight).toBe(true);
  });
  it('reads CSV quotes, multiline records, BOM and exact text values', () => {
    expect(parseEtlCsv('\uFEFFid,name,note\r\n9007199254740993,"O""Reilly","line 1\nline 2"\r\n')).toEqual({
      columns: ['id', 'name', 'note'], rows: [{ id: '9007199254740993', name: 'O"Reilly', note: 'line 1\nline 2' }],
    });
    expect(parseEtlCsv('a,b\n,\n')).toEqual({ columns: ['a','b'], rows: [{a:'',b:''}] });
  });
  it.each(['a,A\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"unclosed', 'a\n"x"tail', 'a\nabc"def'])('rejects ambiguous CSV: %s', (text) => {
    expect(() => parseEtlCsv(text)).toThrow();
  });
  it('rejects excessive CSV size and row counts without truncation', () => {
    expect(() => parseEtlCsv('a\n' + 'x'.repeat(1024 * 1024))).toThrow('1MB');
    expect(() => parseEtlCsv('a\n' + 'x\n'.repeat(10001))).toThrow('10000');
  });
  it('recognizes every registered row source and excludes write/control nodes', () => {
    for (const operator of ETL_OPERATORS) expect(isEtlRowSource(operator.type)).toBe(true);
    expect(isEtlRowSource('database.write')).toBe(false); expect(isEtlRowSource('flow.noop')).toBe(false);
    expect(createOperatorConfig('transform.join','left').nullEquals).toBe(false);
    expect(createOperatorConfig('transform.derive','left').replaceExisting).toBe(false);
  });
  it('includes all join, union and SQL parameter references in generated edges', () => {
    const pipeline = createSqlPipeline(['a','b']);
    const node = pipeline.nodes[1]!;
    node.config = { inputStepId:'left', rightStepId:'right', inputStepIds:['left','extra'], parameters:[{stepId:'parameter'}] };
    expect(etlInputReferences(node.config)).toEqual(['left','right','extra','parameter']);
    syncStepDependencies(pipeline,node);
    expect(pipeline.edges.map((edge) => edge.source)).toEqual(['left','right','extra','parameter']);
    delete node.config.rightStepId; node.config.inputStepIds=[]; node.config.parameters=[];
    syncStepDependencies(pipeline,node);expect(pipeline.edges.map((edge) => edge.source)).toEqual(['left']);
  });
  it('normalizes imported operators without replacing explicit configuration or legacy features', () => {
    const pipeline = createSqlPipeline(['a','b']); pipeline.nodes.push({id:'j',type:'transform.join',typeVersion:1,config:{inputStepId:'a',rightStepId:'b',nullEquals:true,maxStateRows:12}});
    const document = {formatVersion:'1.0' as const,workspace:{id:'x',name:'x'},resources:{},variables:{limit:10},pipelines:[pipeline]};
    const normalized=normalizeSqlDocument(document);
    expect(normalized.pipelines[0]?.nodes[2]?.config).toMatchObject({nullEquals:true,maxStateRows:12,rightStepId:'b',keys:[]});
    expect(normalized.variables).toEqual({limit:10}); expect(document.pipelines[0]?.nodes[2]?.config.keys).toBeUndefined();
  });
});
