import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import graphql from 'highlight.js/lib/languages/graphql';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
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
  env: 'bash',
  gitignore: 'plaintext',
  prisma: 'sql',
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

  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

export function highlightCodeLines(content: string, filePath: string): string[] {
  if (!content) {
    return [''];
  }

  const language = resolveHighlightLanguage(filePath);

  try {
    const result = hljs.getLanguage(language)
      ? hljs.highlight(content, { language, ignoreIllegals: true })
      : hljs.highlight(content, { language: 'plaintext', ignoreIllegals: true });

    return result.value.split('\n');
  } catch {
    return content.split('\n').map((line) => escapeHtml(line));
  }
}
