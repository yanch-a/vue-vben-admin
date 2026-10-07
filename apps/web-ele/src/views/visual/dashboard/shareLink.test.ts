import { describe, expect, it } from 'vitest';

import {
  appPrefixFromHref,
  buildEmbedCode,
  buildEmbedUrl,
  buildShareUrl,
  clearGrant,
  computeFitTransform,
  DEFAULT_EMBED_OPTIONS,
  expiryFromPreset,
  formatDateTime,
  invalidHosts,
  isEmbedParentAllowed,
  parseHostsText,
  parseShareDisplayOptions,
  readGrant,
  saveGrant,
  shareStateView,
  shareStatusMeta,
} from './shareLink';

const TOKEN = 'A'.repeat(20) + '-_' + 'b'.repeat(21);

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe('share link builders', () => {
  it('derives the app prefix for hash and history routers', () => {
    expect(appPrefixFromHref(`/lmdb/view/#/visual/dashboard/share/${TOKEN}`, TOKEN)).toBe('/lmdb/view/#');
    expect(appPrefixFromHref(`/visual/dashboard/share/${TOKEN}`, TOKEN)).toBe('');
  });

  it('builds the direct share url', () => {
    expect(buildShareUrl('https://bi.corp.com/', '/lmdb/view/#', TOKEN)).toBe(
      `https://bi.corp.com/lmdb/view/#/visual/dashboard/share/${TOKEN}`,
    );
  });

  it('builds the embed gateway url with only non-default options', () => {
    const base = { apiBase: '/lmdb', origin: 'https://bi.corp.com', token: TOKEN };
    expect(buildEmbedUrl({ ...base, appPrefix: '/lmdb/view/#', options: DEFAULT_EMBED_OPTIONS })).toBe(
      `https://bi.corp.com/lmdb/admin/biShare/public/${TOKEN}/embed`,
    );
    const url = buildEmbedUrl({
      ...base,
      appPrefix: '',
      options: { ...DEFAULT_EMBED_OPTIONS, fit: 'cover', header: false, refresh: 5, theme: 'light' },
    });
    expect(url).toBe(
      `https://bi.corp.com/lmdb/admin/biShare/public/${TOKEN}/embed?app=&theme=light&header=0&refresh=10&fit=cover`,
    );
    expect(buildEmbedUrl({ ...base, appPrefix: '/lmdb/view/#', options: { ...DEFAULT_EMBED_OPTIONS, refresh: 0 } }))
      .toContain('refresh=0');
  });

  it('escapes the embed code and rejects odd sizes', () => {
    const code = buildEmbedCode('https://x/embed?a=1&b="2"', { height: '480', width: '100%;evil' });
    expect(code).toContain('src="https://x/embed?a=1&amp;b=&quot;2&quot;"');
    expect(code).toContain('width="100%"');
    expect(code).toContain('height="480"');
    expect(code).toContain('allowfullscreen');
    expect(code.startsWith('<iframe ')).toBe(true);
  });
});

describe('allowed hosts', () => {
  it('splits and dedupes input', () => {
    expect(parseHostsText('a.com, b.com\n a.com;c.com  ')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('mirrors the backend validation', () => {
    expect(invalidHosts(['bi.example.com', '*.corp.local', 'https://x.com/app', 'intranet:8080'])).toEqual([]);
    expect(invalidHosts(["'none'", '*', '*.com', 'javascript:alert(1)', 'x.com:99999', 'a_b.com', 'ftp://x.com']))
      .toHaveLength(7);
  });
});

describe('states and options', () => {
  it('maps share statuses and page states', () => {
    expect(shareStatusMeta('ACTIVE')).toEqual({ label: '生效中', type: 'success' });
    expect(shareStatusMeta('REVOKED').type).toBe('danger');
    expect(shareStatusMeta('EXPIRED').label).toBe('已过期');
    expect(shareStateView('REVOKED')).toMatchObject({ retryable: false, title: '分享链接已被撤销' });
    expect(shareStateView('EXPIRED').title).toBe('分享链接已过期');
    expect(shareStateView('RATE_LIMITED').retryable).toBe(true);
    expect(shareStateView('EMBED_DENIED').title).toBe('该页面不允许以这种方式嵌入');
    expect(shareStateView('whatever').title).toBe('大屏暂时无法查看');
  });

  it('parses display options defensively', () => {
    expect(parseShareDisplayOptions({})).toEqual({ embed: false, fit: 'contain', header: true, theme: '' });
    expect(parseShareDisplayOptions({ embed: '1', fit: 'WIDTH', header: '0', theme: ['light'] })).toEqual({
      embed: true,
      fit: 'width',
      header: false,
      theme: 'light',
    });
    expect(parseShareDisplayOptions({ fit: 'zoom', theme: '<x>' })).toMatchObject({ fit: 'contain', theme: '' });
  });

  it('computes fit transforms', () => {
    const vp = { height: 500, width: 1000 };
    const canvas = { height: 1080, width: 1920 };
    expect(computeFitTransform('contain', vp, canvas).scaleX).toBeCloseTo(500 / 1080);
    expect(computeFitTransform('cover', vp, canvas).scaleX).toBeCloseTo(1000 / 1920 > 500 / 1080 ? 1000 / 1920 : 500 / 1080);
    const stretch = computeFitTransform('stretch', vp, canvas);
    expect(stretch.scaleX).toBeCloseTo(1000 / 1920);
    expect(stretch.scaleY).toBeCloseTo(500 / 1080);
    expect(computeFitTransform('width', vp, canvas)).toEqual({ scaleX: 1000 / 1920, scaleY: 1000 / 1920, scroll: true });
  });

  it('computes expiry presets', () => {
    const now = 1_000_000;
    expect(expiryFromPreset('never', now)).toBeNull();
    expect(expiryFromPreset('7d', now)).toBe(now + 7 * 86_400_000);
    expect(expiryFromPreset('custom', now, now - 1)).toBeNull();
    expect(expiryFromPreset('custom', now, now + 5)).toBe(now + 5);
  });

  it('formats timestamps', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(new Date(2026, 9, 7, 9, 5).getTime())).toBe('2026-10-07 09:05');
    expect(formatDateTime('2026-10-07 10:00:00')).toBe('2026-10-07 10:00');
  });
});

describe('embed parent check', () => {
  const origin = 'https://bi.corp.com';

  it('allows top-level pages and the same-origin gateway only', () => {
    const top: any = { location: { origin } };
    top.parent = top;
    expect(isEmbedParentAllowed(top, TOKEN)).toBe(true);

    const gateway = { location: { origin, pathname: `/lmdb/admin/biShare/public/${TOKEN}/embed` } };
    expect(isEmbedParentAllowed({ location: { origin }, parent: gateway } as any, TOKEN)).toBe(true);

    const otherToken = { location: { origin, pathname: `/lmdb/admin/biShare/public/other/embed` } };
    expect(isEmbedParentAllowed({ location: { origin }, parent: otherToken } as any, TOKEN)).toBe(false);

    const appPage = { location: { origin, pathname: '/lmdb/view/' } };
    expect(isEmbedParentAllowed({ location: { origin }, parent: appPage } as any, TOKEN)).toBe(false);

    const crossOrigin = {
      get location(): any {
        throw new Error('SecurityError');
      },
    };
    expect(isEmbedParentAllowed({ location: { origin }, parent: crossOrigin } as any, TOKEN)).toBe(false);
  });
});

describe('grant storage', () => {
  it('stores, expires and clears grants per token', () => {
    const store = memoryStore();
    saveGrant(store, TOKEN, 'g1', 2000);
    expect(readGrant(store, TOKEN, 1000)).toBe('g1');
    expect(readGrant(store, 'other', 1000)).toBe('');
    expect(readGrant(store, TOKEN, 2000)).toBe('');
    expect(store.map.size).toBe(0);
    saveGrant(store, TOKEN, 'g2', 5000);
    clearGrant(store, TOKEN);
    expect(readGrant(store, TOKEN, 0)).toBe('');
    expect(readGrant(null, TOKEN)).toBe('');
    store.setItem(`lemon-share-grant:${TOKEN}`, '{broken');
    expect(readGrant(store, TOKEN)).toBe('');
  });
});
