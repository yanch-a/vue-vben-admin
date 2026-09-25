/**
 * 对象树检索范围。
 *
 * 选中数据库实例（或 Schema）时检索该节点下的全部分类；
 * 选中 Tables / Views 等目录，或目录里的对象时，只检索这一类。
 * 范围外的节点保持原样显示，避免「先搜表、再搜视图」后表列表停在上一次的过滤结果。
 *
 * @author yanch
 */

export type ObjectSearchScope =
  | {
      type: 'instance';
      instanceName: string;
    }
  | {
      type: 'schema';
      instanceName: string;
      schemaName: string;
    }
  | {
      type: 'folder';
      instanceName: string;
      schemaName?: string;
      objectKind: string;
    };

const PROGRAM_KINDS = new Set([
  'views',
  'procedures',
  'functions',
  'triggers',
  'events',
]);

/** 叶子节点所属的目录类型；实例 / Schema 本身没有目录类型。 */
export function objectFolderKind(data: any): string {
  if (!data) return '';
  if (data.nodeType === 'folder') return String(data.objectKind || '');
  if (data.nodeType === 'table' || data.nodeType === 'column') return 'tables';
  if (data.nodeType === 'savedQuery') return 'queries';
  if (PROGRAM_KINDS.has(data.nodeType)) return String(data.nodeType);
  return String(data.objectKind || '');
}

/**
 * 根据当前树选中项决定检索范围。
 * 没有点过树时，用编辑器当前库作为实例级检索，这样不用先点开 Tables 也能搜表。
 */
export function resolveObjectSearchScope(
  data: any,
  activeInstanceName?: string,
): ObjectSearchScope | null {
  const instanceName = String(data?.instanceName || '').trim();
  if (data?.nodeType === 'instance' && instanceName) {
    return { type: 'instance', instanceName };
  }
  if (data?.nodeType === 'schema' && instanceName && data.schemaName) {
    return {
      type: 'schema',
      instanceName,
      schemaName: String(data.schemaName),
    };
  }
  if (data?.nodeType === 'folder' && instanceName && data.objectKind) {
    const schemaName = data.schemaName ? String(data.schemaName) : '';
    return {
      type: 'folder',
      instanceName,
      ...(schemaName ? { schemaName } : {}),
      objectKind: String(data.objectKind),
    };
  }
  const folderKind = objectFolderKind(data);
  if (instanceName && folderKind) {
    const schemaName = data.schemaName ? String(data.schemaName) : '';
    return {
      type: 'folder',
      instanceName,
      ...(schemaName ? { schemaName } : {}),
      objectKind: folderKind,
    };
  }
  const active = String(activeInstanceName || '').trim();
  if (active) return { type: 'instance', instanceName: active };
  return null;
}

/**
 * 本次检索需要展开并加载的目录。
 * 实例 / Schema 返回该层已有的全部分类；选中某一目录时只返回那一类。
 */
export function foldersToSearch(
  scope: ObjectSearchScope,
  availableKinds: string[],
): string[] {
  if (scope.type === 'folder') {
    return availableKinds.filter((kind) => kind === scope.objectKind);
  }
  return [...availableKinds];
}

function sameText(left: unknown, right: unknown) {
  return String(left || '') === String(right || '');
}

/** 节点是否属于本次检索范围。范围外的节点在过滤时一律保留。 */
export function isObjectInSearchScope(data: any, scope: ObjectSearchScope): boolean {
  if (!data || !sameText(data.instanceName, scope.instanceName)) return false;
  if (scope.type === 'instance') return true;
  if (scope.type === 'schema') {
    if (data.nodeType === 'instance') return true;
    if (data.schemaName && !sameText(data.schemaName, scope.schemaName)) return false;
    if (data.nodeType === 'schema') return sameText(data.schemaName, scope.schemaName);
    return true;
  }
  if (scope.schemaName && data.schemaName && !sameText(data.schemaName, scope.schemaName)) {
    return false;
  }
  const kind = objectFolderKind(data);
  return !!kind && kind === scope.objectKind;
}

/** 实例、Schema、分类目录始终保留，检索只隐藏目录里的对象。 */
function isStructuralNode(data: any) {
  return data?.nodeType === 'instance'
    || data?.nodeType === 'schema'
    || data?.nodeType === 'folder';
}

function textMatches(data: any, keyword: string): boolean {
  const fields = [
    data?.label,
    data?.name,
    data?.rawTableName,
    data?.rawObjectName,
    data?.displayName,
  ];
  if (fields.some((field) => String(field || '').toLowerCase().includes(keyword))) {
    return true;
  }
  // Schema 节点上挂着预取对象，文件夹还没展开时也能凭表名把 Schema 留在树上。
  if (data?.nodeType === 'schema' && data.objectNodes) {
    return Object.values(data.objectNodes).some(
      (nodes) => Array.isArray(nodes) && nodes.some((child) => textMatches(child, keyword)),
    );
  }
  return false;
}

/**
 * ElTree 过滤谓词。
 * 关键字为空，或节点不在当前检索范围时，节点保持显示，从而还原上一次检索藏掉的表。
 * 没有范围时退回按名称过滤当前已经加载的节点。
 */
/**
 * 检索过程中点了别的节点时，是否要把已展开的 Tables 收起来。
 * 点 Tables 目录、表或列时保持展开，方便继续看表；点 Views 等其它节点则收起，
 * 避免整表列表把当前检索结果顶到最下面。
 */
export function shouldCollapseTablesOnClick(data: {
  nodeType?: string;
  objectKind?: string;
} | null | undefined): boolean {
  if (!data?.nodeType) return false;
  if (data.nodeType === 'folder' && data.objectKind === 'tables') return false;
  if (data.nodeType === 'table' || data.nodeType === 'column') return false;
  return true;
}

export function objectNodeMatchesKeyword(
  data: any,
  keyword: string,
  scope: ObjectSearchScope | null,
): boolean {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized) return true;
  // 目录本身不参与关键字匹配，避免 Tables 这类节点连同子表一起被藏掉。
  if (isStructuralNode(data)) return true;
  if (scope && !isObjectInSearchScope(data, scope)) return true;
  return textMatches(data, normalized);
}
