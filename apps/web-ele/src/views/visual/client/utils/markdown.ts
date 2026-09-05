/**
 * AI Markdown 渲染（禁 HTML，消毒链接）
 * @author yanch
 */
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(text: string) {
  const html = md.render(text || '');
  return DOMPurify.sanitize(html);
}

export type MdPart =
  | { type: 'md'; html: string }
  | { type: 'sql'; sql: string };

/** 把正文中的 ```sql 代码块拆出来，便于渲染 SQL 卡片 */
export function splitSqlBlocks(text: string): MdPart[] {
  const parts: MdPart[] = [];
  const re = /```sql\s*([\s\S]*?)```/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const src = text || '';
  while ((m = re.exec(src))) {
    if (m.index > last) {
      parts.push({ type: 'md', html: renderMarkdown(src.slice(last, m.index)) });
    }
    parts.push({ type: 'sql', sql: (m[1] || '').trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    parts.push({ type: 'md', html: renderMarkdown(src.slice(last)) });
  }
  return parts;
}
