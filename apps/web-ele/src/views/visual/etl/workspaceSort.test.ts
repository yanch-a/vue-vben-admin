/**
 * 工作区列表排序与拖动的回归测试。
 *
 * @author yanch
 */
import type { EtlWorkspaceRow } from '#/api/visual/etl';

import { describe, expect, it } from 'vitest';

import { moveEtlWorkspace, parseEtlWorkspaceSort, sortEtlWorkspaces } from './workspaceSort';

function row(id: number, name: string, createTime: string, updateTime: string): EtlWorkspaceRow {
  return { id, workspaceName: name, createTime, updateTime, revision: 1, publishedVersion: 0, status: 'DRAFT' };
}

const rows = [
  row(3, '订单同步 10', '2026-10-03 08:00:00', '2026-10-20 09:00:00'),
  row(1, 'alpha', '2026-10-01 08:00:00', '2026-10-21 09:00:00'),
  row(2, '订单同步 9', '2026-10-02 08:00:00', '2026-10-19 09:00:00'),
];
const ids = (list: EtlWorkspaceRow[]) => list.map((item) => item.id);

describe('sortEtlWorkspaces', () => {
  it('自定义顺序保持后端返回的顺序，倒序时反过来，不改原数组', () => {
    expect(ids(sortEtlWorkspaces(rows, { mode: 'custom', desc: false }))).toEqual([3, 1, 2]);
    expect(ids(sortEtlWorkspaces(rows, { mode: 'custom', desc: true }))).toEqual([2, 1, 3]);
    expect(ids(rows)).toEqual([3, 1, 2]);
  });

  it('名称按自然顺序（9 在 10 前），支持倒序', () => {
    const asc = ids(sortEtlWorkspaces(rows, { mode: 'name', desc: false }));
    // 中英文的先后由浏览器的中文排序规则决定，这里只断言数字按自然顺序。
    expect(asc.indexOf(2)).toBeLessThan(asc.indexOf(3));
    expect(ids(sortEtlWorkspaces(rows, { mode: 'name', desc: true }))).toEqual([...asc].reverse());
  });

  it('按更新时间、创建时间排序；缺时间的排在最早', () => {
    expect(ids(sortEtlWorkspaces(rows, { mode: 'updated', desc: true }))).toEqual([1, 3, 2]);
    expect(ids(sortEtlWorkspaces(rows, { mode: 'created', desc: false }))).toEqual([1, 2, 3]);
    const missing = [...rows, { ...row(4, 'x', '', ''), createTime: undefined }];
    expect(ids(sortEtlWorkspaces(missing, { mode: 'created', desc: false }))[0]).toBe(4);
  });
});

describe('moveEtlWorkspace', () => {
  it('拖到目标前面或后面', () => {
    expect(moveEtlWorkspace(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(moveEtlWorkspace(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
    expect(moveEtlWorkspace(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c']);
  });

  it('拖到自己、原位置或未知项时不保存', () => {
    expect(moveEtlWorkspace(['a', 'b'], 'a', 'a', false)).toBeNull();
    expect(moveEtlWorkspace(['a', 'b'], 'a', 'b', false)).toBeNull();
    expect(moveEtlWorkspace(['a', 'b'], 'x', 'b', false)).toBeNull();
  });
});

describe('parseEtlWorkspaceSort', () => {
  it('读取记住的排序，坏值回到自定义顺序', () => {
    expect(parseEtlWorkspaceSort('{"mode":"name","desc":true}')).toEqual({ mode: 'name', desc: true });
    expect(parseEtlWorkspaceSort('{"mode":"bad"}')).toEqual({ mode: 'custom', desc: false });
    expect(parseEtlWorkspaceSort('not json')).toEqual({ mode: 'custom', desc: false });
    expect(parseEtlWorkspaceSort(null)).toEqual({ mode: 'custom', desc: false });
  });
});