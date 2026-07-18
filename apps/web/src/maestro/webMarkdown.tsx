import { wrapInlineCodeHtml } from './webInlineCodeBadge';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isLikelyImagePath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(value);
}

function resolveWebMarkdownImageSrc(src: string): string | null {
  const trimmed = src.trim().replace(/&amp;/g, '&');

  if (!trimmed || /[\s<>"']/.test(trimmed)) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function renderWebMarkdownImage(alt: string, src: string): string {
  const resolved = resolveWebMarkdownImageSrc(src);
  const safeAlt = escapeHtml(alt);
  const safeRef = escapeHtml(src.trim());

  if (resolved) {
    return `<img class="markdown-preview__img" src="${escapeHtml(resolved)}" alt="${safeAlt}" data-image-ref="${safeRef}" loading="lazy" />`;
  }

  const trimmed = src.trim();

  if (
    isLikelyImagePath(trimmed) ||
    (trimmed.length > 0 && !/^[a-z][a-z0-9.+-]*:/i.test(trimmed) && !/[\s<>"']/.test(trimmed))
  ) {
    return `<img class="markdown-preview__img markdown-preview__img--pending" alt="${safeAlt}" data-image-path="${safeRef}" loading="lazy" />`;
  }

  return `<span class="markdown-preview__img-missing" title="${safeRef}">${safeAlt || safeRef}</span>`;
}

function formatInline(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
    (_, alt: string, src: string) => renderWebMarkdownImage(alt, src),
  );
  html = html.replace(/`([^`]+)`/g, (_, code: string) => wrapInlineCodeHtml(code));
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,]|$)/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  return html;
}

export function renderWebMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed
        .slice(3)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim() !== '```') {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const langClass = language ? ` language-${language}` : '';
      blocks.push(
        `<pre class="hljs"><code class="hljs${langClass}">${escapeHtml(codeLines.join('\n'))}</code></pre>`,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test((lines[index] ?? '').trim())) {
        items.push(`<li>${formatInline((lines[index] ?? '').trim().replace(/^[-*]\s+/, ''))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? '').trim())) {
        items.push(
          `<li>${formatInline((lines[index] ?? '').trim().replace(/^\d+\.\s+/, ''))}</li>`,
        );
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? '').trim();
      if (
        !next ||
        next.startsWith('```') ||
        /^#{1,3}\s+/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push(`<p>${formatInline(paragraph.join(' '))}</p>`);
  }

  return blocks.join('');
}
