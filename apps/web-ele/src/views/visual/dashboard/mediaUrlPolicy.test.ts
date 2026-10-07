/** 大屏图片 / 内嵌网页地址安全策略回归测试。@author yanch */
import { describe, expect, it } from 'vitest';

import {
  IFRAME_SANDBOX_CROSS_ORIGIN,
  IFRAME_SANDBOX_SAME_ORIGIN,
  isHostAllowed,
  resolveDashboardMediaUrl,
  toCssUrl,
} from './mediaUrlPolicy';

const ORIGIN = 'http://127.0.0.1:5777';

describe('内嵌网页地址', () => {
  it('外站 https 地址放行并带跨域 sandbox（不含 allow-top-navigation）', () => {
    const media = resolveDashboardMediaUrl('https://grafana.example.com/d/abc', 'iframe', null, ORIGIN);
    expect(media.blocked).toBe(false);
    expect(media.src).toBe('https://grafana.example.com/d/abc');
    expect(media.sandbox).toBe(IFRAME_SANDBOX_CROSS_ORIGIN);
    expect(media.sandbox).not.toContain('allow-top-navigation');
  });

  it('拦截 javascript: / data: / blob: 以及夹带空白的协议', () => {
    for (const url of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:http://127.0.0.1:5777/abc',
      'file:///etc/passwd',
    ]) {
      const media = resolveDashboardMediaUrl(url, 'iframe', null, ORIGIN);
      expect(media.blocked, url).toBe(true);
      expect(media.src, url).toBe('');
    }
  });

  it('同源附件不给 allow-same-origin，读不到本站 token', () => {
    const media = resolveDashboardMediaUrl('/attachment/a.html', 'iframe', null, ORIGIN);
    expect(media.blocked).toBe(false);
    expect(media.src).toBe('/lmdb/attachment/a.html');
    expect(media.sameOrigin).toBe(true);
    expect(media.sandbox).toBe(IFRAME_SANDBOX_SAME_ORIGIN);
    expect(media.sandbox).not.toContain('allow-same-origin');
  });

  it('配置白名单后只放行命中的域名', () => {
    const policy = { iframeAllowedHosts: ['grafana.example.com', '*.corp.local', 'bi.example.com:8443'] };
    expect(resolveDashboardMediaUrl('https://grafana.example.com/x', 'iframe', policy, ORIGIN).blocked).toBe(false);
    expect(resolveDashboardMediaUrl('https://a.b.corp.local/x', 'iframe', policy, ORIGIN).blocked).toBe(false);
    expect(resolveDashboardMediaUrl('https://corp.local/x', 'iframe', policy, ORIGIN).blocked).toBe(true);
    expect(resolveDashboardMediaUrl('https://bi.example.com:8443/x', 'iframe', policy, ORIGIN).blocked).toBe(false);
    expect(resolveDashboardMediaUrl('https://bi.example.com/x', 'iframe', policy, ORIGIN).blocked).toBe(true);
    expect(resolveDashboardMediaUrl('https://evil.example.org/x', 'iframe', policy, ORIGIN).blocked).toBe(true);
    // 同源附件不受外站白名单限制（已经强制无 allow-same-origin 的 sandbox）
    expect(resolveDashboardMediaUrl('/attachment/a.html', 'iframe', policy, ORIGIN).blocked).toBe(false);
    // 协议相对地址与反斜杠写法都按外站处理，不能伪装成本站附件绕过白名单
    for (const url of ['//evil.example.org/x', '\\\\evil.example.org/x', '/\\evil.example.org/x']) {
      expect(resolveDashboardMediaUrl(url, 'iframe', policy, ORIGIN).blocked, url).toBe(true);
    }
  });

  it('白名单条目容忍协议、路径与大小写', () => {
    const url = new URL('https://Grafana.Example.com/d');
    expect(isHostAllowed(url, ['https://grafana.example.com/'])).toBe(true);
    expect(isHostAllowed(url, ['*'])).toBe(true);
    expect(isHostAllowed(url, [])).toBe(true);
    expect(isHostAllowed(url, ['other.com'])).toBe(false);
  });
});

describe('图片地址', () => {
  it('允许 http(s)、相对路径、blob 与 data:image', () => {
    expect(resolveDashboardMediaUrl('https://cdn.example.com/a.png', 'image', null, ORIGIN).src).toBe('https://cdn.example.com/a.png');
    expect(resolveDashboardMediaUrl('/attachment/a.png', 'image', null, ORIGIN).src).toBe('/lmdb/attachment/a.png');
    expect(resolveDashboardMediaUrl('blob:abc', 'image', null, ORIGIN).src).toBe('blob:abc');
    expect(resolveDashboardMediaUrl('data:image/png;base64,AAAA', 'image', null, ORIGIN).src).toBe('data:image/png;base64,AAAA');
  });

  it('丢弃 javascript: 与非图片 data:', () => {
    expect(resolveDashboardMediaUrl('javascript:alert(1)', 'image', null, ORIGIN).src).toBe('');
    expect(resolveDashboardMediaUrl('data:text/html,<b>x</b>', 'image', null, ORIGIN).src).toBe('');
  });
});

describe('CSS url()', () => {
  it('转义引号与反斜杠，无法跳出 url()', () => {
    const css = toCssUrl('/a.png") ; background:red; ("');
    expect(css.startsWith('url("')).toBe(true);
    expect(css.slice(5, -2)).not.toContain('"');
  });
});
