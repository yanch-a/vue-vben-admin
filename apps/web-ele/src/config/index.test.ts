import { describe, expect, it } from 'vitest';

import { resolveBackendAssetUrl } from './index';

describe('resolveBackendAssetUrl', () => {
  it('为后台附件相对路径补充 API context-path', () => {
    expect(
      resolveBackendAssetUrl(
        '/attachment/20260913/4301a0899d03407ab6aa799ff5747cae.jpg',
      ),
    ).toBe('/lmdb/attachment/20260913/4301a0899d03407ab6aa799ff5747cae.jpg');
  });

  it('不会重复拼接已经存在的 API context-path', () => {
    expect(resolveBackendAssetUrl('/lmdb/attachment/avatar.jpg')).toBe(
      '/lmdb/attachment/avatar.jpg',
    );
  });

  it('保留完整 URL 和浏览器临时资源 URL', () => {
    expect(resolveBackendAssetUrl('https://cdn.example.com/avatar.jpg')).toBe(
      'https://cdn.example.com/avatar.jpg',
    );
    expect(resolveBackendAssetUrl('blob:avatar-preview')).toBe(
      'blob:avatar-preview',
    );
  });

  it('只放行 data:image，丢弃脚本类协议', () => {
    expect(resolveBackendAssetUrl('data:image/png;base64,AAAA')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(resolveBackendAssetUrl('data:text/html,<script>1</script>')).toBe('');
    expect(resolveBackendAssetUrl('javascript:alert(1)')).toBe('');
    expect(resolveBackendAssetUrl('java\tscript:alert(1)')).toBe('');
  });

  it('开头的反斜杠不会变成协议相对地址', () => {
    expect(resolveBackendAssetUrl('/\\evil.example.org/a.png')).not.toMatch(/^\/[/\\]/);
  });
});
