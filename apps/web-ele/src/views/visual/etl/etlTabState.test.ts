/**
 * 重新进入 ETL 时，任务选择要跟标签栏一致，不能跟下拉第一项走。
 * @author yanch
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  preferredOpenPipelineId,
  readLastEtlWorkspace,
  rememberEtlWorkspace,
  saveClosedPipelineIds,
} from './etlTabState';

const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('preferredOpenPipelineId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the first visible tab when the dropdown head is closed', () => {
    saveClosedPipelineIds('ws', ['a']);
    expect(preferredOpenPipelineId(tasks, 'ws')).toBe('b');
  });

  it('stays on the task already being viewed when that tab is still open', () => {
    saveClosedPipelineIds('ws', ['a']);
    expect(preferredOpenPipelineId(tasks, 'ws', 'c')).toBe('c');
  });

  it('does not reopen a closed task just because it was last hinted', () => {
    saveClosedPipelineIds('ws', ['a', 'c']);
    expect(preferredOpenPipelineId(tasks, 'ws', 'a')).toBe('b');
  });

  it('leaves every tab closed instead of forcing the dropdown head', () => {
    saveClosedPipelineIds('ws', ['a', 'b', 'c']);
    expect(preferredOpenPipelineId(tasks, 'ws', 'a')).toBe('');
  });

  it('remembers the workspace that was actually open', () => {
    rememberEtlWorkspace(18);
    expect(readLastEtlWorkspace()).toBe('18');
  });
});
