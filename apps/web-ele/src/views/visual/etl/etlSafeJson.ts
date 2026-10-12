/** ETL JSON 数字精度门禁，防止导入/恢复/AI 候选被 JS Number 静默改值。@author yanch */
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** 不展开指数，仅比较有效数字和十进制指数，支持尾零、负数和科学计数法。 */
function decimalIdentity(text: string): string {
  const negative=text.startsWith('-'), parts=text.replace(/^-/, '').split(/[eE]/);
  const coefficient=parts[0]!, fraction=coefficient.includes('.') ? coefficient.length-coefficient.indexOf('.')-1 : 0;
  let digits=coefficient.replace('.','').replace(/^0+/,'');
  if (!digits) return '0';
  const trailing=digits.length-digits.replace(/0+$/,'').length;digits=digits.slice(0,digits.length-trailing);
  return `${negative?'-':''}${digits}e${Number(parts[1]||0)-fraction+trailing}`;
}

/**
 * 先由原生 JSON 验证语法，再扫描字符串外的数字字面量，拒绝不能精确往返的数字。
 * 不改数字类型或配置内容；高精度值应明确使用字符串和 cast，错误草稿仍可保留原文。
 */
export function parseEtlJson(text: string, maxChars=2*1024*1024): any {
  if (text.length>maxChars) throw new Error(`ETL JSON 超出大小限制（MB）: ${maxChars/1024/1024}`);
  const result=JSON.parse(text);
  let quoted=false, escaped=false;
  for (let index=0;index<text.length;index++) {
    const char=text[index]!;
    if (quoted) { if (escaped) escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue; }
    if (char==='"') { quoted=true;continue; }
    if (char!=='-' && (char<'0'||char>'9')) continue;
    NUMBER_TOKEN.lastIndex=index;const token=NUMBER_TOKEN.exec(text)?.[0];if(!token)continue;
    const number=Number(token);
    if (!Number.isFinite(number) || (Number.isInteger(number)&&!Number.isSafeInteger(number)) || decimalIdentity(token)!==decimalIdentity(String(number)))
      throw new Error('ETL JSON 包含不能精确表示的数字，请使用字符串并在转换步骤显式 cast；原始输入未应用');
    index+=token.length-1;
  }
  return result;
}
