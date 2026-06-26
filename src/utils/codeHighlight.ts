import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { isEnvFilePath } from '@/utils/codeEditorLanguage';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  vue: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  gitignore: 'plaintext',
  prisma: 'sql',
  swift: 'swift',
  gradle: 'groovy',
  groovy: 'groovy',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function resolveHighlightLanguage(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const extension = fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : '';

  if (fileName === 'Dockerfile') {
    return 'dockerfile';
  }

  if (isEnvFilePath(filePath)) {
    return 'ini';
  }

  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

const MARKDOWN_FENCE_LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  vue: 'xml',
  kt: 'kotlin',
  kts: 'kotlin',
  gql: 'graphql',
  docker: 'dockerfile',
  prisma: 'sql',
  gradle: 'groovy',
  text: 'plaintext',
  txt: 'plaintext',
};

function resolveMarkdownFenceLanguage(language: string): string {
  const normalized = language.trim().replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();

  if (!normalized) {
    return '';
  }

  return MARKDOWN_FENCE_LANGUAGE_ALIASES[normalized] ?? normalized;
}

const SHELL_CLI_TOOLS =
  'npm|npx|yarn|pnpm|node|deno|bun|git|curl|wget|docker|kubectl|brew|make|python3?|pip|uv|cargo|rustc|go|java|gradle|mvn|xattr|chmod|chown|killall|pkill|open|vite|turbo|eslint|prettier|tsc|tsx|vitest|jest';

const SHELL_SUBCOMMANDS =
  'install|uninstall|run|build|dev|start|test|lint|format|preview|deploy|publish|init|create|add|remove|update|upgrade|ci|exec|cache|config|login|logout|whoami|version|help|use|clean|watch|serve|check|fix|pull|push|clone|commit|status|checkout|merge|rebase|stash|diff|log';

function wrapHljsClass(className: string, value: string): string {
  return `<span class="${className}">${value}</span>`;
}

function enhanceShellPlainSegment(text: string): string {
  let result = text;

  result = result.replace(
    /(`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
    (match) => wrapHljsClass('hljs-string', match),
  );

  result = result.replace(
    /(~\/(?:[\w.-]+\/)*[\w.-]*|\/(?:[\w.-]+\/)+[\w.-]*|\.\/(?:[\w.-]+\/)*[\w.-]*)/g,
    (match) => wrapHljsClass('hljs-string', match),
  );

  result = result.replace(
    /(?<![\w-])(--[\w-]+|-[a-zA-Z][a-zA-Z0-9]*)/g,
    (match) => wrapHljsClass('hljs-attribute', match),
  );

  result = result.replace(
    new RegExp(`\\b(${SHELL_CLI_TOOLS})\\b`, 'g'),
    (match) => wrapHljsClass('hljs-built_in', match),
  );

  result = result.replace(
    new RegExp(`\\b(${SHELL_SUBCOMMANDS})\\b`, 'g'),
    (match) => wrapHljsClass('hljs-keyword', match),
  );

  return result;
}

function enhanceShellHighlightHtml(html: string): string {
  let output = '';
  let plain = '';
  let depth = 0;
  let index = 0;

  const flushPlain = () => {
    if (!plain) {
      return;
    }

    output += enhanceShellPlainSegment(plain);
    plain = '';
  };

  while (index < html.length) {
    if (html.startsWith('<span', index) || html.startsWith('</span>', index)) {
      flushPlain();
      const tagEnd = html.indexOf('>', index);

      if (tagEnd === -1) {
        output += html.slice(index);
        break;
      }

      const tag = html.slice(index, tagEnd + 1);
      output += tag;

      if (tag.startsWith('<span')) {
        depth += 1;
      } else {
        depth = Math.max(0, depth - 1);
      }

      index = tagEnd + 1;
      continue;
    }

    if (depth === 0) {
      plain += html[index];
    } else {
      output += html[index];
    }

    index += 1;
  }

  flushPlain();
  return output;
}

function isShellHighlightLanguage(language: string): boolean {
  return language === 'bash' || language === 'shell';
}

function applyShellHighlightEnhancement(html: string, language: string): string {
  if (!isShellHighlightLanguage(language)) {
    return html;
  }

  return enhanceShellHighlightHtml(html);
}

function highlightWithLanguage(content: string, language: string): string {
  const result = hljs.getLanguage(language)
    ? hljs.highlight(content, { language, ignoreIllegals: true })
    : hljs.highlight(content, { language: 'plaintext', ignoreIllegals: true });

  return applyShellHighlightEnhancement(result.value, language);
}

export function highlightMarkdownCodeBlock(content: string, language: string): string {
  if (!content) {
    return '';
  }

  const resolvedLanguage = resolveMarkdownFenceLanguage(language);

  try {
    if (!resolvedLanguage) {
      return hljs.highlightAuto(content).value;
    }

    if (hljs.getLanguage(resolvedLanguage)) {
      return highlightWithLanguage(content, resolvedLanguage);
    }

    return hljs.highlight(content, { language: 'plaintext', ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

function splitTextLines(text: string): string[] {
  if (!text) {
    return [];
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (normalized.endsWith('\n')) {
    return lines;
  }

  return lines;
}

export function highlightCodeLines(content: string, filePath: string): string[] {
  if (!content) {
    return [''];
  }

  const language = resolveHighlightLanguage(filePath);

  try {
    const highlighted = highlightWithLanguage(content, language);
    return highlighted.split('\n');
  } catch {
    return content.split('\n').map((line) => escapeHtml(line));
  }
}

export function highlightTextLinesByNumber(
  content: string,
  filePath: string,
): Map<number, string> {
  const textLines = splitTextLines(content);
  const map = new Map<number, string>();

  if (textLines.length === 0) {
    return map;
  }

  const highlightedLines = highlightCodeLines(textLines.join('\n'), filePath);

  textLines.forEach((line, index) => {
    map.set(index + 1, highlightedLines[index] ?? escapeHtml(line));
  });

  return map;
}
