/**
 * 从可访问菜单树中解析「第一个可进入页面」路径（对齐 admin-plus 登录后进首个菜单）
 * @author yanch
 */

export type MenuPathNode = {
  children?: MenuPathNode[];
  meta?: { hideInMenu?: boolean };
  path?: string;
  show?: boolean;
};

/**
 * 深度优先取第一个应展示、且带有效 path 的叶子（或无子节点的菜单）
 */
export function resolveFirstMenuPath(
  menus: MenuPathNode[] | null | undefined,
): string | undefined {
  if (!menus?.length) {
    return undefined;
  }
  for (const menu of menus) {
    if (menu.show === false || menu.meta?.hideInMenu) {
      continue;
    }
    const children = (menu.children || []).filter(
      (c) => c.show !== false && !c.meta?.hideInMenu,
    );
    if (children.length > 0) {
      const childPath = resolveFirstMenuPath(children);
      if (childPath) {
        return childPath;
      }
    }
    const path = (menu.path || '').trim();
    if (path && path !== '/') {
      return path.startsWith('/') ? path : `/${path}`;
    }
  }
  return undefined;
}
