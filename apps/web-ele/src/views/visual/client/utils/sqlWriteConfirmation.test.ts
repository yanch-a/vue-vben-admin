import type { VNode } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('element-plus', () => ({
  ElMessageBox: { confirm },
}));

import {
  canMuteSqlWriteConfirm,
  confirmSqlWrite,
  isSqlWriteConfirmationMuted,
} from './sqlWriteConfirmation';

const STORAGE_KEY = 'lemon-sql-update-delete-confirm-muted-until';
const DAY_MS = 24 * 60 * 60 * 1000;

/** 在确认框 VNode 里找到「30 天内不再提示」的勾选框。 */
function findMuteCheckbox(node: unknown): VNode | null {
  if (!node || typeof node !== 'object') return null;
  const vnode = node as VNode;
  if (vnode.type === 'input' && vnode.props?.type === 'checkbox') return vnode;
  const children = vnode.children;
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    const found = findMuteCheckbox(child);
    if (found) return found;
  }
  return null;
}

describe('canMuteSqlWriteConfirm', () => {
  it('数据写入可以 30 天免确认', () => {
    expect(canMuteSqlWriteConfirm('INSERT INTO t VALUES (1)')).toBe(true);
    expect(canMuteSqlWriteConfirm('update t set a = 1')).toBe(true);
    expect(canMuteSqlWriteConfirm('DELETE FROM t WHERE id = 1')).toBe(true);
    expect(canMuteSqlWriteConfirm('REPLACE INTO t VALUES (1)')).toBe(true);
    expect(canMuteSqlWriteConfirm('MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.a = s.a')).toBe(true);
    expect(canMuteSqlWriteConfirm('WITH c AS (SELECT 1 AS id) INSERT INTO t SELECT id FROM c')).toBe(true);
    expect(canMuteSqlWriteConfirm('db.users.insertOne({ name: "a" })')).toBe(true);
  });

  it('结构变更和查询不能免确认', () => {
    expect(canMuteSqlWriteConfirm('DROP TABLE t')).toBe(false);
    expect(canMuteSqlWriteConfirm('TRUNCATE TABLE t')).toBe(false);
    expect(canMuteSqlWriteConfirm('REVOKE SELECT ON t FROM u')).toBe(false);
    expect(canMuteSqlWriteConfirm('SELECT * FROM t')).toBe(false);
    expect(canMuteSqlWriteConfirm('db.users.drop()')).toBe(false);
  });
});

describe('confirmSqlWrite', () => {
  beforeEach(() => {
    localStorage.clear();
    confirm.mockReset();
  });

  it('INSERT 确认框带 30 天不再提示，勾选后写入到期时间', async () => {
    confirm.mockImplementation(async (content: unknown) => {
      const checkbox = findMuteCheckbox(content);
      expect(checkbox).not.toBeNull();
      checkbox?.props?.onChange?.({ target: { checked: true } });
    });

    await expect(confirmSqlWrite('INSERT INTO t VALUES (1)')).resolves.toBe(true);

    const expiresAt = Number(localStorage.getItem(STORAGE_KEY));
    expect(expiresAt).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS + 1000);
    expect(isSqlWriteConfirmationMuted()).toBe(true);
  });

  it('免确认有效期内，INSERT 和 UPDATE 都不再弹窗', async () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + 30 * DAY_MS));

    await expect(confirmSqlWrite('INSERT INTO t VALUES (1)')).resolves.toBe(true);
    await expect(confirmSqlWrite('UPDATE t SET a = 1')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('未勾选时不记住，DROP 确认框没有免确认勾选', async () => {
    confirm.mockResolvedValue(undefined);

    await expect(confirmSqlWrite('UPDATE t SET a = 1')).resolves.toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await expect(confirmSqlWrite('DROP TABLE t')).resolves.toBe(true);
    expect(typeof confirm.mock.calls[1]?.[0]).toBe('string');
    expect(findMuteCheckbox(confirm.mock.calls[1]?.[0])).toBeNull();
  });

  it('取消确认不执行，过期记录会被清掉', async () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() - DAY_MS));
    confirm.mockRejectedValueOnce(new Error('cancel'));

    await expect(confirmSqlWrite('DELETE FROM t')).resolves.toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(isSqlWriteConfirmationMuted()).toBe(false);
  });
});
