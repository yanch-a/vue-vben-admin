/**
 * 将后端裸异常（NumberFormatException 等）转成运维可读中文。
 * @author yanch
 */
export function humanizeApiError(raw: unknown, fallback = '请求失败'): string {
  const text = String(
    (raw as any)?.msg
      ?? (raw as any)?.message
      ?? (raw as any)?.response?.data?.msg
      ?? (raw as any)?.response?.data?.message
      ?? raw
      ?? '',
  ).trim();
  if (!text) return fallback;

  if (/NumberFormatException/i.test(text) || /For input string:/i.test(text)) {
    return '接口路径或参数不正确（无法解析编号），请检查地址是否写错，例如应使用 /page 而非把动作名当成 ID。';
  }
  if (/Failed to convert/i.test(text) && /Number/i.test(text)) {
    return '请求参数类型不正确，请刷新页面后重试；若从收藏夹打开，请改用侧栏正式入口。';
  }
  if (/HttpRequestMethodNotSupported|Request method/i.test(text)) {
    return '请求方式不正确（GET/POST 不匹配），请刷新后重试。';
  }
  if (/NoHandlerFound|404|Not Found/i.test(text) && /message|Exception/i.test(text)) {
    return '接口不存在或尚未开通，请确认后端服务已启动且版本匹配。';
  }
  if (/NullPointerException/i.test(text)) {
    return '服务端处理异常（空指针），请稍后重试或联系管理员查看日志。';
  }
  if (/SQLSyntaxErrorException|SQLException/i.test(text) && text.length > 180) {
    const short = text.replace(/^[\s\S]*?:\s*/, '').slice(0, 160);
    return `数据库执行失败：${short}`;
  }
  if (text.length > 280 && /Exception|at com\.|at org\./i.test(text)) {
    const first = text.split(/\r?\n/)[0] || text;
    return first.slice(0, 200);
  }
  return text;
}
