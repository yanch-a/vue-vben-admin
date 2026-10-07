import { isProdEnv } from './connectionEnv';

/**
 * 生产连接识别：以连接的 env 字段为准（env == PROD）；
 * env 为空的历史连接才回退到名称/描述关键词（生产 / prod / 正式 / production）。
 * 规则见 connectionEnv.ts，与后端 DbEnvironment 一致。
 * @author yanch
 */
export function isProductionConnection(row: any): boolean {
  return isProdEnv(row);
}
