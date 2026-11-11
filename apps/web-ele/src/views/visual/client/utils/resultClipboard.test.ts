import { describe, expect, it } from 'vitest';

import {
  plainTextFromResultSelection,
  stripResultCopyTrailingBreak,
} from './resultClipboard';

describe('结果集复制去掉末尾换行', () => {
  it('只去掉原文里没有的那一个末尾换行', () => {
    expect(stripResultCopyTrailingBreak('hello\n', 'hello')).toBe('hello');
    expect(stripResultCopyTrailingBreak('hello\r\n', 'hello')).toBe('hello');
    expect(stripResultCopyTrailingBreak('a\nb\n', 'b')).toBe('a\nb');
    expect(stripResultCopyTrailingBreak('hello\n', 'hello\n')).toBe('hello\n');
    expect(stripResultCopyTrailingBreak('hello', 'hello')).toBe('hello');
  });

  it('整格选中时用格子原文，不带块边界多出来的换行', () => {
    const root = document.createElement('div');
    root.className = 'vrt-scroll';
    root.innerHTML =
      '<div class="vrt-td"><span class="vrt-cell-text">hello</span>\n</div>';
    document.body.appendChild(root);
    const cell = root.querySelector('.vrt-td')!;
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(plainTextFromResultSelection(root, selection)).toBe('hello');
    root.remove();
    selection.removeAllRanges();
  });

  it('单元格内容本身以换行结尾时保留', () => {
    const root = document.createElement('div');
    root.className = 'vrt-scroll';
    root.innerHTML = '<div class="vrt-td"><span class="vrt-cell-text"></span></div>';
    document.body.appendChild(root);
    const span = root.querySelector('.vrt-cell-text')!;
    span.textContent = 'hello\n';
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(plainTextFromResultSelection(root, selection)).toBe('hello\n');
    root.remove();
    selection.removeAllRanges();
  });

  it('编辑框里的选区不改写', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="vrt-td"><input class="vrt-editor" value="hello" /></div>';
    document.body.appendChild(root);
    const input = root.querySelector('input')!;
    input.focus();
    input.setSelectionRange(0, 5);
    const selection = window.getSelection()!;
    expect(plainTextFromResultSelection(root, selection)).toBeNull();
    root.remove();
  });
});
