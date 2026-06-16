import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import type { Extension } from '@codemirror/state';

function resolveFileExtension(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  if (fileName === 'Dockerfile') {
    return 'dockerfile';
  }

  if (!fileName.includes('.')) {
    return '';
  }

  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function getCodeEditorExtensions(filePath: string): Extension[] {
  switch (resolveFileExtension(filePath)) {
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })];
    case 'ts':
    case 'mts':
    case 'cts':
      return [javascript({ typescript: true })];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()];
    case 'json':
      return [json()];
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return [css()];
    case 'html':
    case 'htm':
    case 'vue':
    case 'xml':
    case 'svg':
    case 'plist':
      return [html()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'yaml':
    case 'yml':
      return [yaml()];
    case 'py':
      return [python()];
    case 'sql':
    case 'prisma':
      return [sql()];
    default:
      return [];
  }
}
