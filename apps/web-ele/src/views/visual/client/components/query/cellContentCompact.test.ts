import { describe, expect, it } from 'vitest';

import { compactCellContent, compactJsonText, compactXmlText } from './cellContentCompact';

describe('格式化内容压缩为一行', () => {
  it('JSON 去掉缩进，不保留格式化换行', () => {
    expect(compactJsonText('{\n  "a": 1,\n  "b": "x"\n}')).toBe('{"a":1,"b":"x"}');
  });

  it('XML 只去掉标签间空白，文本里的换行保留', () => {
    const xml = '<?xml version="1.0"?>\n<root>\n  <a>1</a>\n  <b>hello\nworld</b>\n</root>';
    expect(compactXmlText(xml)).toBe('<?xml version="1.0"?><root><a>1</a><b>hello\nworld</b></root>');
  });

  it('非法 XML 不能当成可回写内容', () => {
    expect(compactXmlText('<root>')).toBeNull();
    expect(compactXmlText('plain text')).toBeNull();
  });

  it('JSON 视图里的 XML 也能压缩，作为更新入参', () => {
    const compacted = compactCellContent('json', '<root>\n  <a>1</a>\n</root>');
    expect(compacted).toEqual({ ok: true, text: '<root><a>1</a></root>' });
  });

  it('XML 视图里的格式化 JSON 压成一行', () => {
    const compacted = compactCellContent('xml', '{\n  "a": 1\n}');
    expect(compacted).toEqual({ ok: true, text: '{"a":1}' });
  });

  it('原文既不是 JSON 也不是 XML 时保留编辑文本', () => {
    const compacted = compactCellContent('raw', '第一行\n第二行');
    expect(compacted).toEqual({ ok: true, text: '第一行\n第二行' });
  });
});
