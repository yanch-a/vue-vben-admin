import { requestClient } from '#/api/request';

/**
 * 分页列表适配：lemon TableDataInfo → { items, total }
 */
export async function getPageList<T = any>(
  url: string,
  params?: Record<string, any>,
): Promise<{ items: T[]; total: number }> {
  const data = await requestClient.get<any>(url, { params });
  if (Array.isArray(data)) {
    return { items: data, total: data.length };
  }
  return {
    items: data?.list || data?.rows || [],
    total: Number(data?.total ?? 0),
  };
}

export async function getListData<T = any>(
  url: string,
  params?: Record<string, any>,
): Promise<T[]> {
  const data = await requestClient.get<any>(url, { params });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}
