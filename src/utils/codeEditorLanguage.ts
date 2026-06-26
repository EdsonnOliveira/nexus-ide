import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import type { Extension } from '@codemirror/state';

export function isEnvFilePath(filePath: string): boolean {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  return fileName === '.env' || fileName.startsWith('.env.');
}

function resolveFileExtension(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  if (fileName === 'Dockerfile') {
    return 'dockerfile';
  }

  if (isEnvFilePath(filePath)) {
    return 'env';
  }

  if (!fileName.includes('.')) {
    return '';
  }

  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function getCodeEditorExtensions(filePath: string): Extension[] {
  switch (resolveFileExtension(filePath)) {
    case 'env':
      return [StreamLanguage.define(properties)];
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
    case 'swift':
      return [StreamLanguage.define(swift)];
    case 'gradle':
    case 'groovy':
    case 'kt':
    case 'kts':
      return [StreamLanguage.define(groovy)];
    default:
      return [];
  }
}
