import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve('src');
const catalogPath = path.resolve('src/locales/langs/en-US/ui-text.json');
const chinesePattern = /[\u3400-\u9fff]/;

/**
 * 递归读取业务 Vue 文件。
 * @author yanch
 */
async function collectVueFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectVueFiles(target)));
    else if (entry.isFile() && entry.name.endsWith('.vue')) files.push(target);
  }
  return files;
}

/**
 * 定位 SFC 顶层 template 内容，同时正确跳过内部具名插槽 template。
 */
function findTemplateContent(source) {
  const opening = /^<template(?:\s[^>]*)?>/m.exec(source);
  if (!opening) return '';
  const tagPattern = /<\/?template\b[^>]*>/gi;
  tagPattern.lastIndex = opening.index;
  let depth = 0;
  let start = -1;
  for (let tag = tagPattern.exec(source); tag; tag = tagPattern.exec(source)) {
    if (tag[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return source.slice(start, tag.index);
    } else {
      depth += 1;
      if (depth === 1) start = tagPattern.lastIndex;
    }
  }
  return '';
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const missing = new Map();
const hardcoded = [];
const missingFragments = new Map();

/**
 * 与运行时相同地执行长词优先替换，用于识别真正缺少覆盖的中文片段。
 */
function canTranslate(text) {
  if (catalog[text]) return true;
  let translated = text;
  for (const [chinese, english] of Object.entries(catalog).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    translated = translated.split(chinese).join(english);
  }
  if (!chinesePattern.test(translated)) return true;
  for (const fragment of translated.match(/[\u3400-\u9fff]+/g) ?? []) {
    missingFragments.set(fragment, (missingFragments.get(fragment) ?? 0) + 1);
  }
  return false;
}

for (const file of await collectVueFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(process.cwd(), file);
  const translatedTextPattern =
    /\$tr\(\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|`((?:\\.|[^`])*)`)\s*\)/g;
  for (const match of source.matchAll(translatedTextPattern)) {
    const key = (match[1] ?? match[2] ?? match[3] ?? '')
      .replaceAll("\\'", "'")
      .replaceAll('\\"', '"')
      .replaceAll('\\`', '`')
      .replaceAll('\\\\', '\\');
    if (!canTranslate(key)) {
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(relative);
    }
  }

  const templateContent = findTemplateContent(source);
  if (!templateContent) continue;
  const template = templateContent
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, '');
  const staticAttributePattern =
    /(?<![:@#\w-])(active-text|aria-label|cancel-button-text|confirm-button-text|content|description|empty-text|inactive-text|label|placeholder|text|title)=("[^"]*"|'[^']*')/g;
  for (const match of template.matchAll(staticAttributePattern)) {
    if (chinesePattern.test(match[2])) {
      hardcoded.push(`${relative}: ${match[0]}`);
    }
  }
  // 先整体移除插值表达式，避免表达式中的 > / < 比较符被误识别为 HTML 文本边界。
  const templateWithoutInterpolations = template.replace(
    /\{\{[\s\S]*?\}\}/g,
    '',
  );
  for (const match of templateWithoutInterpolations.matchAll(/>([^<>]*)</g)) {
    const staticText = match[1].trim();
    if (chinesePattern.test(staticText)) {
      hardcoded.push(`${relative}: ${staticText}`);
    }
  }
}

if (missing.size || hardcoded.length) {
  if (missing.size) {
    console.error('[i18n] Missing English catalog entries:');
    for (const [key, files] of [...missing].slice(0, 120)) {
      console.error(`- ${JSON.stringify(key)} (${files[0]})`);
    }
    console.error('[i18n] Most frequent untranslated fragments:');
    for (const [fragment, count] of [...missingFragments].sort(
      (left, right) => right[1] - left[1],
    ).slice(0, 250)) {
      console.error(`- ${fragment}: ${count}`);
    }
  }
  if (hardcoded.length) {
    console.error('[i18n] Unmigrated static template text:');
    for (const item of hardcoded.slice(0, 100)) console.error(`- ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[i18n] Audit passed: ${Object.keys(catalog).length} English UI texts covered.`,
  );
}
