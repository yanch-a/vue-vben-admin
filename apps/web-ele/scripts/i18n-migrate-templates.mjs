import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve('src');
const chinesePattern = /[\u3400-\u9fff]/;
const translatableAttributes = [
  'active-text',
  'aria-label',
  'cancel-button-text',
  'confirm-button-text',
  'content',
  'description',
  'empty-text',
  'inactive-text',
  'label',
  'placeholder',
  'text',
  'title',
];

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

function escapeSingleQuoted(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/**
 * 定位 SFC 顶层 template 内容，同时正确跳过内部具名插槽 template。
 */
function findTemplateRange(source) {
  const opening = /^<template(?:\s[^>]*)?>/m.exec(source);
  if (!opening) return null;
  const tagPattern = /<\/?template\b[^>]*>/gi;
  tagPattern.lastIndex = opening.index;
  let depth = 0;
  let start = -1;
  for (let tag = tagPattern.exec(source); tag; tag = tagPattern.exec(source)) {
    if (tag[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return { start, end: tag.index };
    } else {
      depth += 1;
      if (depth === 1) start = tagPattern.lastIndex;
    }
  }
  return null;
}

/**
 * 将模板中的历史中文静态文案迁移到全局 $tr 兼容入口。
 * 脚本可重复执行，已绑定属性和已迁移文本不会再次修改。
 */
function migrateTemplate(template) {
  // 第一轮迁移可能把多行静态说明保留在单引号中；统一折叠为空格以保持表达式合法。
  let output = template.replace(
    /\$tr\('((?:\\.|[^'])*)'\)/gs,
    (full, value) => `$tr('${value.replace(/\s+/g, ' ').trim()}')`,
  );
  const attributePattern = new RegExp(
    `(?<![:@#\\w-])(${translatableAttributes.join('|')})=("[^"]*"|'[^']*')`,
    'g',
  );
  output = output.replace(attributePattern, (full, name, quoted) => {
    const value = quoted.slice(1, -1);
    if (!chinesePattern.test(value) || value.includes('{{')) return full;
    return `:${name}="$tr('${escapeSingleQuoted(value)}')"`;
  });

  // 保护代码示例，SQL 和用户数据不属于界面文案。
  const protectedBlocks = [];
  output = output.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, (block) => {
    protectedBlocks.push(block);
    return `__LEMON_I18N_PROTECTED_${protectedBlocks.length - 1}__`;
  });

  output = output.replace(/>([^<>]*[\u3400-\u9fff][^<>]*)</g, (
    full,
    rawText,
  ) => {
    if (rawText.trimStart().startsWith('!--')) return full;
    const pieces = rawText.split(/({{[\s\S]*?}})/g).map((piece) => {
      if (piece.startsWith('{{')) {
        const expression = piece.slice(2, -2).trim();
        if (
          chinesePattern.test(expression) &&
          !expression.includes('$tr(') &&
          !expression.includes('$t(')
        ) {
          return `{{ $tr(${expression}) }}`;
        }
        return piece;
      }
      if (!chinesePattern.test(piece)) return piece;
      const leading = piece.match(/^\s*/)?.[0] ?? '';
      const trailing = piece.match(/\s*$/)?.[0] ?? '';
      const text = piece.trim();
      return text
        ? `${leading}{{ $tr('${escapeSingleQuoted(text)}') }}${trailing}`
        : piece;
    });
    return `>${pieces.join('')}<`;
  });

  return output.replace(
    /__LEMON_I18N_PROTECTED_(\d+)__/g,
    (_, index) => protectedBlocks[Number(index)],
  );
}

let changed = 0;
for (const file of await collectVueFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const range = findTemplateRange(source);
  if (!range) continue;
  const { end, start } = range;
  const template = source.slice(start, end);
  const migrated = migrateTemplate(template);
  if (migrated === template) continue;
  await writeFile(file, `${source.slice(0, start)}${migrated}${source.slice(end)}`);
  changed += 1;
}

console.log(`[i18n] Migrated ${changed} Vue template files.`);
