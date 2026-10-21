/**
 * ETL 工作区文档的撤销 / 重做历史。
 *
 * <p>历史记在整份工作区 JSON 上（唯一数据源），表单、画布、JSON 三个视图看到的永远一致。
 * 每一步是一份快照：工作区其余部分一段 JSON，每个任务各一段 JSON。没变的任务直接复用上一步的同一个字符串，
 * 上百个任务时每步只多占改动任务那一段的内存。</p>
 *
 * <p>commit 传同一个 coalesceKey 时合并成一步（例如一次节点抽屉编辑），换 key、撤销或重做后重新开始。</p>
 *
 * @author yanch
 */
import type { EtlPipeline, EtlWorkspaceDocument } from '#/api/visual/etl';

export const ETL_HISTORY_LIMIT = 100;

export interface EtlHistorySnapshot {
  /** 除 pipelines 外的工作区内容。 */
  meta: string;
  pipelines: string[];
}

export interface EtlHistory {
  canRedo: () => boolean;
  canUndo: () => boolean;
  /** 记录当前文档；与上一步相同返回 false。 */
  commit: (doc: EtlWorkspaceDocument, coalesceKey?: string) => boolean;
  redo: () => EtlWorkspaceDocument | null;
  /** 清空历史，以当前文档为起点（加载、切换工作区时调用）。 */
  reset: (doc?: EtlWorkspaceDocument) => void;
  size: () => { redo: number; undo: number };
  undo: () => EtlWorkspaceDocument | null;
}

/** 生成快照；与 previous 相同的任务复用原字符串（结构共享）。 */
export function etlHistorySnapshot(doc: EtlWorkspaceDocument, previous?: EtlHistorySnapshot): EtlHistorySnapshot {
  const { pipelines, ...rest } = doc;
  // 按内容找上一步里相同的字符串并复用，任务顺序变化（移动、删除）时也能共享。
  const reuse = new Map((previous?.pipelines || []).map((item) => [item, item]));
  return {
    meta: reuseString(JSON.stringify(rest), previous?.meta),
    pipelines: (pipelines || []).map((pipeline: EtlPipeline) => {
      const text = JSON.stringify(pipeline);
      return reuse.get(text) ?? text;
    }),
  };
}

function reuseString(text: string, previous?: string) {
  return previous === text ? previous : text;
}

function sameSnapshot(left?: EtlHistorySnapshot, right?: EtlHistorySnapshot) {
  if (!left || !right) return false;
  return left.meta === right.meta && left.pipelines.length === right.pipelines.length && left.pipelines.every((item, index) => item === right.pipelines[index]);
}

/** 快照还原成可编辑的新文档对象。 */
export function etlHistoryRestore(snapshot: EtlHistorySnapshot): EtlWorkspaceDocument {
  return { ...JSON.parse(snapshot.meta), pipelines: snapshot.pipelines.map((item) => JSON.parse(item)) };
}

export function createEtlHistory(limit = ETL_HISTORY_LIMIT): EtlHistory {
  let current: EtlHistorySnapshot | undefined;
  let undoStack: EtlHistorySnapshot[] = [];
  let redoStack: EtlHistorySnapshot[] = [];
  let lastKey = '';

  return {
    canRedo: () => redoStack.length > 0,
    canUndo: () => undoStack.length > 0,
    commit(doc, coalesceKey = '') {
      const next = etlHistorySnapshot(doc, current);
      if (!current) {
        current = next;
        return false;
      }
      if (sameSnapshot(current, next)) return false;
      // 同一编辑会话只保留会话开始前的那一步，会话内的中间状态直接覆盖。
      if (!coalesceKey || coalesceKey !== lastKey) {
        undoStack.push(current);
        if (undoStack.length > limit) undoStack = undoStack.slice(undoStack.length - limit);
      }
      current = next;
      redoStack = [];
      lastKey = coalesceKey;
      return true;
    },
    redo() {
      const next = redoStack.pop();
      if (!next || !current) return null;
      undoStack.push(current);
      current = next;
      lastKey = '';
      return etlHistoryRestore(next);
    },
    reset(doc) {
      current = doc ? etlHistorySnapshot(doc) : undefined;
      undoStack = [];
      redoStack = [];
      lastKey = '';
    },
    size: () => ({ undo: undoStack.length, redo: redoStack.length }),
    undo() {
      const previous = undoStack.pop();
      if (!previous || !current) return null;
      redoStack.push(current);
      current = previous;
      lastKey = '';
      return etlHistoryRestore(previous);
    },
  };
}