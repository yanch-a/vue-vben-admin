/**
 * SQL 写操作确认策略。
 *
 * UPDATE / DELETE 可由当前浏览器记住 30 天；DROP / TRUNCATE 等结构操作始终确认。
 * localStorage 只保存到期时间，不保存 SQL、库名或用户数据。
 *
 * @author yanch
 */
import { h } from 'vue';

import { ElMessageBox } from 'element-plus';

import { describeSqlWriteRisk } from './sqlWriteGuard';

const STORAGE_KEY = 'lemon-sql-update-delete-confirm-muted-until';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** 判断语句是否属于允许 30 天免确认的 UPDATE / DELETE。 */
export function isUpdateOrDeleteSql(sql: string): boolean {
  const normalized = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*(--|#)[^\n]*$/gm, ' ')
    .trim();
  return /^(UPDATE|DELETE)\b/i.test(normalized)
    || /^WITH\b[\s\S]*?\b(UPDATE|DELETE)\b/i.test(normalized);
}

/** 当前浏览器的免确认期限是否仍有效。 */
export function isUpdateDeleteConfirmationMuted(): boolean {
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
  const canMute = isUpdateOrDeleteSql(sql);
  if (canMute && isUpdateDeleteConfirmationMuted()) return true;

  let muteForThirtyDays = false;
  const message = options?.message || describeSqlWriteRisk(sql);
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
          h('span', '30 天内不再提示 UPDATE / DELETE'),
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
