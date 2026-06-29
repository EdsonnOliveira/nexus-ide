export type InlineCodeBadgeTone =
  | 'default'
  | 'keyword'
  | 'string'
  | 'number'
  | 'type'
  | 'path'
  | 'variable'
  | 'function'
  | 'call'
  | 'constant';

const INLINE_CODE_BADGE_CLASS: Record<InlineCodeBadgeTone, string> = {
  default: 'markdown-preview__inline-code--default',
  keyword: 'markdown-preview__inline-code--keyword',
  string: 'markdown-preview__inline-code--string',
  number: 'markdown-preview__inline-code--number',
  type: 'markdown-preview__inline-code--type',
  path: 'markdown-preview__inline-code--path',
  variable: 'markdown-preview__inline-code--variable',
  function: 'markdown-preview__inline-code--function',
  call: 'markdown-preview__inline-code--call',
  constant: 'markdown-preview__inline-code--constant',
};

export function resolveInlineCodeBadgeTone(raw: string): InlineCodeBadgeTone {
  const token = raw.trim();

  if (!token) {
    return 'default';
  }

  if (/^(true|false|null|undefined)$/i.test(token)) {
    return 'number';
  }

  if (/^-?\d+(?:\.\d+)?$/.test(token)) {
    return 'number';
  }

  if (
    token.startsWith('.') ||
    token.includes('(') ||
    token.includes('"') ||
    token.includes("'") ||
    token.includes('&quot;') ||
    token.includes('&#39;') ||
    token.includes('=&gt;') ||
    token.includes('=>')
  ) {
    return 'call';
  }

  if (/^[A-Z][a-zA-Z0-9]*$/.test(token) && /[A-Z].*[A-Z]/.test(token.slice(1))) {
    return 'type';
  }

  if (/^[A-Z][a-zA-Z0-9_$]*$/.test(token)) {
    return 'type';
  }

  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(token)) {
    return 'path';
  }

  if (token.includes('/') || /\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|sql|json|yaml|yml|md)$/i.test(token)) {
    return 'path';
  }

  if (/^[A-Z][A-Z0-9_]+$/.test(token)) {
    return 'constant';
  }

  if (/^[a-z][a-z0-9_]*$/.test(token) && token.includes('_')) {
    return 'variable';
  }

  if (/^[a-z][a-zA-Z0-9]*$/.test(token)) {
    return 'function';
  }

  if (/^(import|export|from|const|let|var|return|async|await|if|else|for|while|class|interface|type|enum)$/i.test(token)) {
    return 'keyword';
  }

  return 'default';
}

export function resolveInlineCodeBadgeClass(raw: string): string {
  return INLINE_CODE_BADGE_CLASS[resolveInlineCodeBadgeTone(raw)];
}

export function wrapInlineCodeHtml(raw: string): string {
  const badgeClass = resolveInlineCodeBadgeClass(raw);
  return `<code class="${badgeClass}">${raw}</code>`;
}
