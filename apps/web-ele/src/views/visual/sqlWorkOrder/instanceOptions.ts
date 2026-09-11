export function normalizeInstanceNames(response: any): string[] {
  const payload = response?.data ?? response;
  const roots = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const names = roots.flatMap((root: any) => {
    const values = Array.isArray(root?.instances) ? root.instances : [];
    return values.map((item: any) => {
      if (typeof item === 'string') return item.trim();
      return String(item?.instanceName ?? item?.name ?? '').trim();
    });
  });
  return [...new Set(names.filter(Boolean))];
}
