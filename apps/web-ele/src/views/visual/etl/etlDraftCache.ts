/**
 * ETL 工作区本地未保存草稿缓存。
 * 按工作区 id 落盘，原样保留未完成 JSON；revision 冲突由用户选择，不自动删除。
 * @author yanch
 */
import { shallowRef } from 'vue';

import { getDesktopScopedStorageKey } from '../../../desktop/runtime';

const VERSION = 1;
/** 与后端任务区 JSON 上限对齐，避免撑爆 localStorage */
const MAX_CHARS = 2 * 1024 * 1024;

export interface EtlLocalDraft {
  version: typeof VERSION;
  workspaceId: string;
  /** 生成此本地稿时所基于的服务端 revision */
  baseRevision: number;
  workspaceName: string;
  description: string;
  draftJson: string;
  /** JSON 编辑器原始文本可能未完成，恢复时不能静默退回旧步骤文档。 */
  editorMode?: 'steps' | 'json';
  /** JSON 文本非法时恢复步骤上下文用的最后可用文档。 */
  documentJson?: string;
  activePipelineId?: string;
  selectedNodeId?: string;
  updatedAt: number;
}

type Store = Record<string, EtlLocalDraft>;

/** 侧栏黄底 / * 标记用的脏工作区 id 集合 */
export const etlDirtyIds = shallowRef(new Set<string>());

function storageKey() {
  return getDesktopScopedStorageKey('lemon-etl-drafts-v1');
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  const keys = Object.keys(store);
  if (!keys.length) localStorage.removeItem(storageKey());
  else localStorage.setItem(storageKey(), JSON.stringify(store));
  etlDirtyIds.value = new Set(keys);
}

/** 挂载时同步一次侧栏脏标记。 */
export function refreshEtlDirtyIds() {
  etlDirtyIds.value = new Set(Object.keys(readStore()));
}

export function getEtlLocalDraft(
  id: string | number,
): EtlLocalDraft | undefined {
  return readStore()[String(id)];
}

export function hasEtlLocalDraft(id: string | number) {
  return Boolean(readStore()[String(id)]);
}

/** 写入本地草稿；超限或配额失败返回 false。 */
export function saveEtlLocalDraft(
  draft: Omit<EtlLocalDraft, 'version' | 'updatedAt'> & {
    updatedAt?: number;
  },
): boolean {
  if (!draft.workspaceId || draft.draftJson.length > MAX_CHARS) return false;
  const store = readStore();
  store[String(draft.workspaceId)] = {
    ...draft,
    version: VERSION,
    updatedAt: draft.updatedAt ?? Date.now(),
  };
  try {
    writeStore(store);
    return true;
  } catch {
    return false;
  }
}

export function clearEtlLocalDraft(id: string | number) {
  const store = readStore();
  const key = String(id);
  if (!(key in store)) return;
  delete store[key];
  writeStore(store);
}
