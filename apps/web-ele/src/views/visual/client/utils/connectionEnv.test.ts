import { describe, expect, it } from 'vitest';

import {
  describeRule,
  envTagType,
  formatChangeWindowStatus,
  isChangeWindowBlockedMessage,
  isProdEnv,
  normalizeEnv,
  resolveConnectionEnv,
  shortWindowTime,
} from './connectionEnv';
import { isProductionConnection } from './prodConnection';

describe('connectionEnv', () => {
  it('normalizes aliases', () => {
    expect(normalizeEnv(' prd ')).toBe('PROD');
    expect(normalizeEnv('生产')).toBe('PROD');
    expect(normalizeEnv('staging')).toBe('UAT');
    expect(normalizeEnv('qa')).toBe('TEST');
    expect(normalizeEnv('dev')).toBe('DEV');
    expect(normalizeEnv('')).toBeNull();
    expect(normalizeEnv('moon')).toBeNull();
  });

  it('prefers the explicit env field over the legacy name heuristic', () => {
    expect(resolveConnectionEnv({ env: 'PROD', dbName: 'orders' })).toEqual({
      env: 'PROD',
      source: 'FIELD',
      text: 'PROD',
    });
    // 名称含 prod，但显式标记 TEST：不是生产
    expect(isProdEnv({ env: 'TEST', dbName: 'product_prod_copy' })).toBe(false);
    expect(isProductionConnection({ env: 'TEST', dbName: '生产备份' })).toBe(false);
    // env 为空：按旧关键词兜底
    expect(resolveConnectionEnv({ dbName: '生产-订单' })).toMatchObject({
      env: 'PROD',
      source: 'LEGACY_NAME',
    });
    expect(isProductionConnection({ description: 'production replica' })).toBe(true);
    expect(isProductionConnection({ dbName: 'dev-db' })).toBe(false);
    expect(resolveConnectionEnv({ env: 'uat', envLabel: '预发-华东' }).text).toBe('预发-华东');
    expect(resolveConnectionEnv(null).env).toBeNull();
  });

  it('maps env to tag colors with PROD in red', () => {
    expect(envTagType('PROD')).toBe('danger');
    expect(envTagType('UAT')).toBe('warning');
    expect(envTagType('TEST')).toBe('primary');
    expect(envTagType('DEV')).toBe('success');
    expect(envTagType(null)).toBe('info');
  });

  it('shortens window times relative to now', () => {
    expect(shortWindowTime('2026-10-07 22:00', '2026-10-07 12:00')).toBe('22:00');
    expect(shortWindowTime('2026-10-08 06:00', '2026-10-07 23:00')).toBe('10-08 06:00');
    expect(shortWindowTime('2027-01-04 09:00', '2026-10-07 09:30')).toBe('2027-01-04 09:00');
    expect(shortWindowTime(null, '2026-10-07 12:00')).toBe('');
  });

  it('formats change window status for the toolbar', () => {
    expect(formatChangeWindowStatus(null).level).toBe('none');
    expect(formatChangeWindowStatus({ restricted: false, open: true }).level).toBe('none');

    const open = formatChangeWindowStatus({
      restricted: true,
      open: true,
      now: '2026-10-07 21:00',
      openUntil: '2026-10-07 22:00',
      timezone: 'Asia/Shanghai',
    });
    expect(open.level).toBe('open');
    expect(open.text).toBe('变更窗口开放至 22:00');
    expect(open.tagType).toBe('success');

    expect(
      formatChangeWindowStatus({ restricted: true, open: true, now: '2026-10-07 21:00' }).text,
    ).toBe('变更窗口开放中');

    const closed = formatChangeWindowStatus({
      restricted: true,
      open: false,
      now: '2026-10-07 12:00',
      nextOpenAt: '2026-10-07 22:00',
      message: 'blocked',
    });
    expect(closed.level).toBe('closed');
    expect(closed.text).toBe('当前不在变更窗口，下次开放 22:00');
    expect(closed.detail).toBe('blocked');

    const frozen = formatChangeWindowStatus({
      restricted: true,
      open: false,
      frozen: true,
      now: '2026-10-07 12:00',
      freezeEnd: '2026-10-08 00:00',
    });
    expect(frozen.level).toBe('frozen');
    expect(frozen.text).toBe('封网中，至 10-08 00:00');

    expect(formatChangeWindowStatus({ restricted: true, invalid: true, open: false }).level).toBe(
      'invalid',
    );
  });

  it('detects change window block messages', () => {
    expect(isChangeWindowBlockedMessage('当前不在目标连接的变更窗口内，工单暂不能执行')).toBe(true);
    expect(isChangeWindowBlockedMessage('无权在变更窗口外执行工单')).toBe(false);
    expect(isChangeWindowBlockedMessage('回滚脚本存在无法自动还原的语句')).toBe(false);
  });

  it('describes rules', () => {
    expect(describeRule({ days: [5, 1], start: '22:00', end: '06:00' })).toBe(
      '周一、周五 22:00-06:00（跨夜）',
    );
    expect(describeRule({ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '00:00' })).toBe(
      '每天 全天',
    );
  });
});
