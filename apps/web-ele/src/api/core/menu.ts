import type { RouteRecordStringComponent } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取用户菜单（vben 专用）
 * lemon: GET /router/getVbenList → data: RouteRecordStringComponent[]
 *
 * 后端已按 vben 字段组装；前端再兜底规范化旧 Remix 裸名图标。
 * 旧接口 /router/getList 仍保留给 admin-plus。
 */
export async function getAllMenusApi(): Promise<RouteRecordStringComponent[]> {
  const data = await requestClient.get<RouteRecordStringComponent[]>(
    '/router/getVbenList',
  );
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.list)
      ? (data as any).list
      : [];
  return normalizeMenuIcons(list);
}

function normalizeIcon(icon?: string) {
  if (!icon) return icon;
  if (icon.includes(':') || icon.startsWith('http')) return icon;
  return `ri:${icon}`;
}

function normalizeMenuIcons(
  routes: RouteRecordStringComponent[],
): RouteRecordStringComponent[] {
  return routes.map((route) => {
    const meta = {
      ...route.meta,
      title: route.meta?.title ?? String(route.name ?? route.path ?? ''),
    };
    if (typeof meta.icon === 'string') {
      meta.icon = normalizeIcon(meta.icon);
    }
    if (typeof meta.activeIcon === 'string') {
      meta.activeIcon = normalizeIcon(meta.activeIcon);
    }
    return {
      ...route,
      meta,
      children: route.children
        ? normalizeMenuIcons(route.children as RouteRecordStringComponent[])
        : undefined,
    };
  });
}
