/**
 * 把格式化抽屉里的 JSON / XML 压成一行，供结果更新写入数据库。
 * 编辑器里看到的是缩进后的文本，回写必须用压缩结果，不能把换行和缩进存进去。
 *
 * @author yanch
 */

export type CellContentMode = 'json' | 'xml' | 'raw';

export type CompactCellContent =
  | { ok: true; text: string }
  | { ok: false; message: string };

/** 合法 JSON 压成一行；空文本保持空串，非法 JSON 返回 null。 */
export function compactJsonText(raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 浏览器把非法 XML 标成 parsererror，不能只看解析有没有抛错。 */
function xmlDocumentInvalid(doc: Document): boolean {
  if (doc.getElementsByTagName('parsererror').length > 0) return true;
  const root = doc.documentElement;
  return !!root && root.nodeName.toLowerCase() === 'parsererror';
}

/**
 * 合法 XML 去掉标签之间的空白，压成一行。
 * 只动 `>...<` 之间的格式化空白，元素里的文本换行保留。
 * 不重新序列化，避免浏览器改写属性顺序、命名空间或自闭合写法。
 */
export function compactXmlText(raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (!text.startsWith('<')) return null;
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (xmlDocumentInvalid(doc)) return null;
  }
  return text.replace(/>\s+</g, '><');
}

const INVALID_MESSAGE = '当前内容不是合法 JSON 或 XML，无法压缩为一行后更新';

/**
 * 按当前视图决定回写文本。
 * JSON、XML 都先压缩再作为更新入参；原文若本身不是这两种，则按编辑后的文本回写。
 */
export function compactCellContent(mode: CellContentMode, raw: string): CompactCellContent {
  const text = String(raw ?? '');
  if (mode === 'xml') {
    const xml = compactXmlText(text);
    if (xml != null) return { ok: true, text: xml };
    const json = compactJsonText(text);
    if (json != null) return { ok: true, text: json };
    return { ok: false, message: INVALID_MESSAGE };
  }
  const json = compactJsonText(text);
  if (json != null) return { ok: true, text: json };
  const xml = compactXmlText(text);
  if (xml != null) return { ok: true, text: xml };
  if (mode === 'raw') return { ok: true, text };
  return { ok: false, message: INVALID_MESSAGE };
}
