/**
 * SQL 写操作确认策略。
 *
 * INSERT / UPDATE / DELETE 等数据写入可由当前浏览器记住 30 天；
 * DROP / TRUNCATE 等结构变更始终确认。
 * localStorage 只保存到期时间，不保存 SQL、库名或用户数据。
 *
 * @author yanch
 */
import { h } from 'vue';

import { ElMessageBox } from 'element-plus';

import { mongoCommandKind } from './mongoCommand';
import { describeSqlWriteRisk, isFreeDmlSql } from './sqlWriteGuard';

/**
 * 到期时间戳。键名沿用旧值，已经勾选过的浏览器不会被重置。
 * 范围已从 UPDATE / DELETE 扩大到全部数据写入。
 */
const STORAGE_KEY = 'lemon-sql-update-delete-confirm-muted-until';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 判断这条语句勾选「30 天内不再提示」后，后续是否可以跳过确认。
 * 只覆盖改数据的语句；删表、清空表、收回权限仍每次确认。
 */
export function canMuteSqlWriteConfirm(sql: string): boolean {
  if (isFreeDmlSql(sql)) return true;
  // Mongo 的 insert / update / delete 与 SQL DML 共用同一个确认框。
  return mongoCommandKind(sql) === 'data';
}

/** 当前浏览器的免确认期限是否仍有效。 */
export function isSqlWriteConfirmationMuted(): boolean {
  try {
    const expiresAt = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式或禁用存储时退回每次确认。
  }
  return false;
}

/**
 * 弹出统一写操作确认框。
 *
 * @return true 表示用户确认或命中免确认；false 表示取消。
 */
export async function confirmSqlWrite(
  sql: string,
  options?: { message?: string; title?: string },
): Promise<boolean> {
  const canMute = canMuteSqlWriteConfirm(sql);
  if (canMute && isSqlWriteConfirmationMuted()) return true;

  let muteForThirtyDays = false;
  const message = options?.message || describeSqlWriteRisk(sql);
  // 原生 checkbox 自己保存勾选状态。确认框内容不是响应式组件，受控组件勾上后不会刷新。
  const content = canMute
    ? h('div', { class: 'sql-write-confirmation' }, [
        h('p', { style: 'margin: 0 0 12px; line-height: 1.6' }, message),
        h('label', { style: 'display: flex; align-items: center; gap: 8px; cursor: pointer' }, [
          h('input', {
            type: 'checkbox',
            onChange: (event: Event) => {
              muteForThirtyDays = (event.target as HTMLInputElement).checked;
            },
          }),
          h('span', '30 天内不再提示'),
        ]),
      ])
    : message;

  try {
    await ElMessageBox.confirm(content, options?.title || '写操作确认', {
      type: 'warning',
      confirmButtonText: '确认执行',
      cancelButtonText: '取消',
    });
    if (canMute && muteForThirtyDays) {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now() + THIRTY_DAYS_MS));
      } catch {
        // 存储失败不影响本次执行，只是不启用后续免确认。
      }
    }
    return true;
  } catch {
    return false;
  }
}
