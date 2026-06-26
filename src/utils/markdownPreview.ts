import { highlightMarkdownCodeBlock } from '@/utils/codeHighlight';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function stripMarkdownSyntax(source: string): string {
  return source
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '');
}

function applyInlineMarkdown(value: string): string {
  let html = value;
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

export function renderMarkdownPreview(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```(\S*)$/);

    if (fenceMatch) {
      const language = fenceMatch[1] ?? '';
      index += 1;
      const codeLines: string[] = [];

      while (index < lines.length) {
        if (lines[index].trim() === '```') {
          index += 1;
          break;
        }

        codeLines.push(lines[index]);
        index += 1;
      }

      const rawCode = codeLines.join('\n');
      const safeLanguage = language.replace(/[^a-zA-Z0-9_-]/g, '');
      const highlightedCode = highlightMarkdownCodeBlock(rawCode, safeLanguage);
      const langClass = safeLanguage ? ` language-${safeLanguage}` : '';
      blocks.push(`<pre class="hljs"><code class="hljs${langClass}">${highlightedCode}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = applyInlineMarkdown(escapeHtml(headingMatch[2]));
      blocks.push(`<h${level}>${content}</h${level}>`);
      index += 1;
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);

    if (unorderedMatch) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        const itemMatch = current.match(/^[-*+]\s+(.+)$/);

        if (!itemMatch) {
          break;
        }

        items.push(`<li>${applyInlineMarkdown(escapeHtml(itemMatch[1]))}</li>`);
        index += 1;
      }

      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);

    if (orderedMatch) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        const itemMatch = current.match(/^\d+\.\s+(.+)$/);

        if (!itemMatch) {
          break;
        }

        items.push(`<li>${applyInlineMarkdown(escapeHtml(itemMatch[1]))}</li>`);
        index += 1;
      }

      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const current = lines[index].trim();

      if (!current) {
        break;
      }

      if (/^#{1,6}\s/.test(current)) {
        break;
      }

      if (/^[-*+]\s/.test(current)) {
        break;
      }

      if (/^\d+\.\s/.test(current)) {
        break;
      }

      if (/^```/.test(current)) {
        break;
      }

      paragraphLines.push(applyInlineMarkdown(escapeHtml(current)));
      index += 1;
    }

    blocks.push(`<p>${paragraphLines.join('<br />')}</p>`);
  }

  return blocks.join('');
}
