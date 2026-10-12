import { describe, expect, it } from 'vitest';
import { backupFormat, taskIndeterminate, taskPercent, transferSize } from './clientTaskDisplay';

/** 后台任务边界回归：真实格式、压缩阶段和终态必须一致。 @author yanch */
describe('数据库后台任务显示', () => {
  it('表已写完但仍压缩时不能显示完成，成功后才显示 100%', () => {
    const task = { status: 'RUNNING', total: 8, done: 8, phase: 'PACKING' };
    expect(taskPercent(task)).toBe(99);
    expect(taskIndeterminate(task)).toBe(true);
    expect(taskPercent({ ...task, status: 'SUCCESS' })).toBe(100);
    expect(taskIndeterminate({ ...task, status: 'SUCCESS' })).toBe(false);
  });
  it('官方导入即使有占位总数也不能伪造确定进度', () => {
    expect(taskIndeterminate({ status: 'RUNNING', total: 1, done: 0, engine: 'NATIVE' })).toBe(true);
    expect(taskIndeterminate({ status: 'RUNNING', total: 10, done: 3, engine: 'MANAGED' })).toBe(false);
    expect(taskPercent({ status: 'RUNNING', total: 10, done: 3 })).toBe(30);
  });
  it('归档格式不能误标为 SQL，提交阶段不会提前显示 SQL', () => {
    expect(backupFormat('db.archive')).toBe('MongoDB Archive');
    expect(backupFormat('db.dmp')).toBe('DMP');
    expect(backupFormat('db.js')).toBe('JavaScript');
    expect(backupFormat('db.sql')).toBe('SQL');
    expect(backupFormat('db.sql', true)).toBe('ZIP');
    expect(backupFormat()).toBe('准备中');
  });
  it('失败和取消停止动画，空库完成也能显示完成', () => {
    expect(taskIndeterminate({ status: 'FAILED', total: 0, done: 0, engine: 'NATIVE' })).toBe(false);
    expect(taskIndeterminate({ status: 'CANCELLED', total: 0, done: 0 })).toBe(false);
    expect(taskPercent({ status: 'SUCCESS', total: 0, done: 0 })).toBe(100);
    expect(taskPercent({ status: 'RUNNING', total: 10, done: -1 })).toBe(0);
  });
  it('导出大文件可以显示 GB，官方工具运行过程中也有字节反馈', () => {
    expect(transferSize(2 * 1024 ** 3)).toBe('2.0 GB');
    expect(transferSize(1024 ** 2)).toBe('1.0 MB');
  });
});
