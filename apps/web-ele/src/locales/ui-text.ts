import { i18n } from '@vben/locales';

/**
 * 中文字符检测，用于跳过无需翻译的标识符和英文文案。
 */
const HAN_TEXT_RE = /[\u3400-\u9fff]/;

/**
 * 运行期间已经报告过的缺失文案，避免开发控制台重复刷屏。
 */
const reportedMissingTexts = new Set<string>();

type UiTextCatalog = Record<string, string>;

/**
 * 读取当前已加载的业务界面兼容文案。
 *
 * <p>业务新代码应优先使用语义化的 $t 消息键；该目录用于将历史页面中数量较多的
 * 中文静态文案一次性纳入国际化，并为后续逐页迁移保留兼容层。</p>
 *
 * @author yanch
 */
function getEnglishCatalog(): UiTextCatalog {
  const messages = i18n.global.getLocaleMessage('en-US') as Record<
    string,
    unknown
  >;
  const catalog = messages['ui-text'];
  return catalog && typeof catalog === 'object'
    ? (catalog as UiTextCatalog)
    : {};
}

/**
 * 翻译业务界面的历史中文文案。
 *
 * <p>先做整句匹配，动态消息再按长词优先替换。仍缺少翻译时保留原文并在开发环境
 * 报告，防止错误翻译 SQL、数据库对象名称或用户数据。</p>
 *
 * @param value 原始界面文案
 * @returns 当前语言对应的显示文案
 */
function translateUiText(value: unknown): string {
  const source = String(value ?? '');
  if (!source || i18n.global.locale.value !== 'en-US') {
    return source;
  }

  const leading = source.match(/^\s*/)?.[0] ?? '';
  const trailing = source.match(/\s*$/)?.[0] ?? '';
  const text = source.trim();
  if (!text || !HAN_TEXT_RE.test(text)) {
    return source;
  }

  const catalog = getEnglishCatalog();
  const exact = catalog[text];
  if (exact) {
    return `${leading}${exact}${trailing}`;
  }

  // 动态提示通常由固定短语和变量拼接而成，按中文键长度倒序替换可避免短词抢占。
  let translated = text;
  const phrases = Object.entries(catalog).sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [chinese, english] of phrases) {
    if (translated.includes(chinese)) {
      translated = translated.split(chinese).join(` ${english} `);
    }
  }
  if (!HAN_TEXT_RE.test(translated)) {
    const normalized = translated
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.:;!?%)\]}])/g, '$1')
      .replace(/([{[(])\s+/g, '$1')
      .trim();
    return `${leading}${normalized}${trailing}`;
  }

  if (import.meta.env.DEV && !reportedMissingTexts.has(text)) {
    reportedMissingTexts.add(text);
    console.warn(`[i18n] Missing English UI text: ${text}`);
  }
  return source;
}

export { translateUiText };
