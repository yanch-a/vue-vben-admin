/**
 * Blob 下载辅助：区分真实文件与业务失败 JSON（HTTP 200 + {code,msg}）
 * @author yanch
 */

export function unwrapFileBlob(res: unknown): Blob | null {
  if (res instanceof Blob) return res;
  if (res && typeof res === 'object' && (res as { data?: unknown }).data instanceof Blob) {
    return (res as { data: Blob }).data;
  }
  return null;
}

function isBusinessOkCode(code: unknown): boolean {
  return code === 200 || code === 0 || code === '200' || code === '0';
}

/**
 * 若 blob 实为业务错误 JSON，返回 msg；否则返回 null。
 * 通过 slice 窥探前缀，避免把真实 xlsx/sql 误判。
 */
export async function readBlobErrorMessage(blob: Blob): Promise<string | null> {
  const type = (blob.type || '').toLowerCase();
  const looksJsonType =
    type.includes('application/json') ||
    type.includes('text/json') ||
    type.includes('text/plain');

  const peekSize = Math.min(blob.size, 1024);
  if (peekSize <= 0) return null;

  let peek: string;
  try {
    peek = (await blob.slice(0, peekSize).text()).trimStart();
  } catch {
    return null;
  }

  const looksJsonBody = peek.startsWith('{') || peek.startsWith('[');
  if (!looksJsonType && !looksJsonBody) {
    return null;
  }

  let text: string;
  try {
    text = await blob.text();
  } catch {
    return null;
  }

  try {
    const json = JSON.parse(text) as {
      code?: unknown;
      msg?: string;
      message?: string;
    };
    if (json && typeof json === 'object' && 'code' in json && !isBusinessOkCode(json.code)) {
      return json.msg || json.message || '导出失败';
    }
  } catch {
    if (looksJsonType) {
      return '导出失败';
    }
  }
  return null;
}

export async function downloadBlobAsFile(
  blob: Blob,
  downloadName: string,
): Promise<void> {
  const url = window.URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
  } finally {
    window.URL.revokeObjectURL(url);
  }
}
