/** 后台任务显示规则，导出窗口与悬浮面板共用，避免两处进度和文件格式不一致。 @author yanch */
export interface TransferDisplayTask {
  status: string;
  total: number;
  done: number;
  engine?: string;
  phase?: string;
}

/** 只有服务端成功才能显示 100%；表写完后还可能需要压缩和关闭文件。 */
export function taskPercent(task: TransferDisplayTask): number {
  if (task.status === 'SUCCESS') return 100;
  if (!task.total || task.total < 0) return 0;
  const value = Math.max(0, Math.round((task.done / task.total) * 100));
  return Math.min(task.status === 'PENDING' || task.status === 'RUNNING' ? 99 : 100, value);
}

/** 官方工具没有可测的 SQL/表总数；压缩也没有表进度，显示持续动画和阶段文字。 */
export function taskIndeterminate(task: TransferDisplayTask): boolean {
  return (task.status === 'PENDING' || task.status === 'RUNNING')
    && (!task.total || task.engine === 'NATIVE' || task.phase === 'PACKING');
}

/** 按真实文件扩展名展示，Mongo archive 和达梦 DMP 不能标为 SQL。 */
export function backupFormat(fileName?: string, zipped?: boolean): string {
  if (zipped || fileName?.toLowerCase().endsWith('.zip')) return 'ZIP';
  const extension = fileName?.split('.').pop()?.toLowerCase();
  const formats: Record<string, string> = { archive: 'MongoDB Archive', dmp: 'DMP', js: 'JavaScript', sql: 'SQL' };
  return extension ? formats[extension] || extension.toUpperCase() : '准备中';
}

/** 显示已经写出的文件大小，官方工具没有总进度时仍有可观察的反馈。 */
export function transferSize(bytes?: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
