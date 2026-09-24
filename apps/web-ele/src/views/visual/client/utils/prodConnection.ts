/**
 * 生产连接识别：名称/描述/主机备注含关键词，或显式 env/tag/isProd 字段。
 * @author yanch
 */
const PROD_NAME_RE = /生产|prod|正式|production/i;

export function isProductionConnection(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  if (row.isProd === true || row.isProd === 1 || row.isProd === '1') return true;
  const env = String(row.env ?? row.envTag ?? row.envType ?? row.environment ?? '').trim();
  if (env && /^(prod|production|prd|正式|生产)$/i.test(env)) return true;
  const hay = [row.dbName, row.description, row.remark, row.tag, row.tags]
    .filter(Boolean)
    .join(' ');
  return PROD_NAME_RE.test(hay);
}
