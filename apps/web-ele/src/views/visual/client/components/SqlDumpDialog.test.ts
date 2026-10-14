import { createApp, nextTick } from 'vue';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SqlDumpDialog from './SqlDumpDialog.vue';

const api = vi.hoisted(() => ({ export: vi.fn(), download: vi.fn(), start: vi.fn(), started: vi.fn() }));
vi.mock('#/api/visual/dbBackup', () => ({ startDbBackup: api.start }));
vi.mock('#/api/visual/database', () => ({
  getTables: async () => [{ tableName: 'parent' }, { tableName: 'child' }],
  exportSqlDump: api.export,
}));
vi.mock('#/utils/blobDownload', () => ({
  unwrapFileBlob: () => new Blob(['CREATE TABLE t(id INT);']),
  readBlobErrorMessage: async () => null,
  downloadBlobAsFile: api.download,
}));

/** 通过真实表单控件检查引擎选择、纯净选项和默认全量导出。 @author yanch */
describe('数据库导出选项', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => { unmount?.(); document.body.innerHTML = ''; vi.clearAllMocks(); });

  /** 首次打开即加载表清单，使用真实 Element Plus 控件和用户事件。 */
  async function mount(preselectedTables: string[] = [], background = false) {
    api.export.mockResolvedValue({});
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp(SqlDumpDialog, { modelValue: true, dbConfigId: 1, instanceName: 'source', dbType: 'MY_SQL', preselectedTables, background, onStarted: api.started });
    app.use(ElementPlus); app.config.globalProperties.$tr = (text: unknown) => String(text);
    app.mount(host); unmount = () => app.unmount();
    await nextTick(); await nextTick(); await nextTick();
  }

  /** 点击标签内的原生控件，触发 v-model 而不直接修改组件内部状态。 */
  async function choose(label: string) {
    const item = [...document.querySelectorAll('label')].find((element) => element.textContent?.includes(label));
    expect(item).toBeDefined(); item!.querySelector<HTMLInputElement>('input')!.click();
    await nextTick();
  }

  /** 从页脚发起导出并等待下载 Promise。 */
  async function submit() {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === '导出');
    expect(button).toBeDefined(); button!.click(); await nextTick(); await nextTick();
  }

  it('Java 默认导出全部行，不包含源库切换命令', async () => {
    await mount(); await submit();
    expect(api.export).toHaveBeenCalledWith(expect.objectContaining({ engine: 'jdbc', maxRows: 0, includeUseDatabase: false, tableNames: ['parent', 'child'] }));
    expect(api.download).toHaveBeenCalled();
  });

  it('用户可显式选择客户端，纯净模式切回 Java 并清除冲突选项', async () => {
    await mount(); await choose('官方客户端'); await submit();
    expect(api.export).toHaveBeenLastCalledWith(expect.objectContaining({ engine: 'native', pureSql: false }));
    await choose('纯净 SQL'); await submit();
    expect(api.export).toHaveBeenLastCalledWith(expect.objectContaining({ engine: 'jdbc', pureSql: true, includeDrop: false, foreignKeyChecks0: false, includeVersionInfo: false }));
  });

  it('单表入口只导出指定表，无法匹配时不会误导出全库', async () => {
    await mount(['child']); await submit();
    expect(api.export).toHaveBeenCalledWith(expect.objectContaining({ tableNames: ['child'] }));
    unmount?.(); await mount(['missing']); await submit();
    expect(api.export).toHaveBeenCalledTimes(1);
  });

  it('库级导出提交后台任务并交给进度面板，不阻塞等待整个文件', async () => {
    api.start.mockResolvedValue({ taskId: 'export123', status: 'PENDING' });
    await mount([], true); await choose('纯净 SQL'); await submit();
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ engine: 'jdbc', instanceName: 'source',
      options: expect.objectContaining({ pureSql: true, maxRows: 0, tableNames: ['parent', 'child'], fileName: 'source_dump.sql' }) }));
    expect(api.started).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'export123' }));
    expect(api.export).not.toHaveBeenCalled(); expect(api.download).not.toHaveBeenCalled();
  });

  it('库级标准导出明确包含附属对象，选择部分表后不会扩大范围', async () => {
    api.start.mockResolvedValue({ taskId: 'scope123', status: 'PENDING' });
    await mount([], true); await submit();
    expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({
      options: expect.objectContaining({ includeDatabaseObjects: true }),
    }));
    await choose('parent'); await submit();
    expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({
      options: expect.objectContaining({ includeDatabaseObjects: false, tableNames: ['child'] }),
    }));
  });

  it('目录全选控件可清空和重新勾选，提交列表不包含目录本身', async () => {
    await mount(); await choose('表（全选）'); await submit();
    expect(api.export).not.toHaveBeenCalled();
    await choose('表（全选）'); await submit();
    expect(api.export).toHaveBeenCalledWith(expect.objectContaining({ tableNames: ['parent', 'child'] }));
  });
});
