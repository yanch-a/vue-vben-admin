import { createApp, nextTick } from 'vue';
import { webcrypto } from 'node:crypto';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EncryptionPage from './index.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  rotate: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock('#/api/system/transportEncryption', () => ({
  getEncryptionSettings: mocks.get,
  setEncryptionEnabled: mocks.save,
  rotateEncryptionKey: mocks.rotate,
}));
vi.mock('@vben/access', () => ({
  useAccess: () => ({
    hasAccessByCodes: (codes: string[]) =>
      codes.some((code) => mocks.permissions.has(code)),
  }),
}));
vi.mock('@vben/common-ui', async () => {
  const { h } = await import('vue');
  return {
    Page: {
      setup:
        (_: unknown, { slots }: { slots: Record<string, () => unknown> }) =>
        () =>
          h('main', slots.default?.() as any),
    },
  };
});
vi.mock('#/locales/ui-text', () => ({
  translateUiText: (text: string) => text,
}));

/** 使用真实 Element Plus 控件验证权限、保存状态和轮换确认。 @author yanch */
describe('传输加密管理', () => {
  let cleanup: (() => void) | undefined;
  const initial = {
    enabled: false,
    keyReady: true,
    publicKey: 'public-key',
    keyId: 'key-fingerprint',
    algorithm: 'RSA-OAEP-SHA256 + AES-256-GCM',
    updatedAt: null,
  };

  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    mocks.permissions.clear();
    ['info', 'update', 'rotateKey'].forEach((action) =>
      mocks.permissions.add(`SecretKeyConfig:${action}`),
    );
    mocks.get.mockResolvedValue({ ...initial });
    mocks.save.mockResolvedValue({ ...initial, enabled: true });
    mocks.rotate.mockResolvedValue({ ...initial, keyId: 'new-fingerprint' });
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(
      'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>,
    );
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** 挂载真实页面，跳过应用壳的无关路由和状态依赖。 */
  async function mountPage() {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(EncryptionPage);
    app.use(ElementPlus);
    app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host);
    cleanup = () => app.unmount();
    await vi.waitFor(() =>
      expect(
        mocks.get.mock.calls.length || host.textContent?.includes('无权查看'),
      ).toBeTruthy(),
    );
    await nextTick();
    return host;
  }

  /** 按按钮文案定位，避免绑定组件内部层级。 */
  function button(host: HTMLElement, text: string): HTMLButtonElement {
    const target = [...host.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === text,
    );
    if (!target) throw new Error(`Missing button ${text}`);
    return target;
  }

  it('编辑开关不会立即保存，保存成功后才改变已生效状态', async () => {
    const host = await mountPage();
    await vi.waitFor(() => expect(host.textContent).toContain('加密已关闭'));
    expect(button(host, '保存配置').disabled).toBe(true);
    (host.querySelector('[role="switch"]') as HTMLElement).click();
    await nextTick();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(host.textContent).toContain('加密已关闭');
    expect(button(host, '轮换密钥').disabled).toBe(true);
    button(host, '保存配置').click();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(host.textContent).toContain('加密已启用'));
  });

  it('仅有查看权限时不展示保存和轮换操作', async () => {
    mocks.permissions.delete('SecretKeyConfig:update');
    mocks.permissions.delete('SecretKeyConfig:rotateKey');
    const host = await mountPage();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('key-fingerprint'),
    );
    expect(host.textContent).not.toContain('保存配置');
    expect(host.textContent).not.toContain('轮换密钥');
    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('无查看权限时不调用配置接口', async () => {
    mocks.permissions.clear();
    const host = await mountPage();
    expect(host.textContent).toContain('无权查看加密配置');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('轮换确认后更新指纹，取消时不调用服务', async () => {
    const host = await mountPage();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('key-fingerprint'),
    );
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel');
    button(host, '轮换密钥').click();
    await nextTick();
    expect(mocks.rotate).not.toHaveBeenCalled();
    button(host, '轮换密钥').click();
    await vi.waitFor(() => expect(mocks.rotate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(host.textContent).toContain('new-fingerprint'),
    );
  });

  it('加载失败提供重试入口，不展示虚假的关闭状态', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    const host = await mountPage();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('加载加密配置失败'),
    );
    expect(host.textContent).not.toContain('加密已关闭');
    button(host, '重试').click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('key-fingerprint'),
    );
  });

  it('不支持安全加密的环境禁止启用，避免保存后无法继续请求', async () => {
    vi.stubGlobal('crypto', {});
    const host = await mountPage();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('当前浏览器无法启用安全加密'),
    );
    expect(
      host.querySelector('[role="switch"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(button(host, '保存配置').disabled).toBe(true);
  });

  it('保存失败保留未保存状态，允许原操作重试', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline'));
    const host = await mountPage();
    await vi.waitFor(() =>
      expect(host.textContent).toContain('key-fingerprint'),
    );
    (host.querySelector('[role="switch"]') as HTMLElement).click();
    await nextTick();
    button(host, '保存配置').click();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(button(host, '保存配置').disabled).toBe(false),
    );
    expect(host.textContent).toContain('加密已关闭');
    expect(host.textContent).toContain('有未保存的修改');
  });
});
