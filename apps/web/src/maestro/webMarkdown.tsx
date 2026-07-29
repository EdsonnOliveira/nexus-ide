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
    (_match, label: string, href: string) =>
      `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`,
  );
  return html;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed.includes('-')) {
    return false;
  }

  return /^[\|\s:\-]+$/.test(trimmed);
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\*\*(.+)\*\*$/, '$1').trim();

  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    return trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
  }

  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim().replace(/^\*\*(.+)\*\*$/, '$1').trim();

  if (!trimmed.includes('|')) {
    return false;
  }

  if (isTableSeparator(trimmed)) {
    return true;
  }

  if (trimmed.startsWith('|')) {
    return parseTableCells(trimmed).length >= 2;
  }

  const cells = parseTableCells(trimmed);

  if (cells.length < 2) {
    return false;
  }

  return cells.every((cell) => cell.length > 0 && cell.length <= 96 && !/[{}();=<>]/.test(cell));
}

function splitGluedTableRow(line: string): string[] {
  const trimmed = line.trim();

  if (!trimmed.includes('|')) {
    return [line];
  }

  const parts = trimmed.split(/\|\s+\|(?=[^|])/);

  if (parts.length <= 1) {
    return [line];
  }

  const rows = parts.map((part, index) => {
    const value = part.trim();

    if (index === 0) {
      return value.endsWith('|') ? value : `${value} |`;
    }

    if (index === parts.length - 1) {
      return value.startsWith('|') ? value : `| ${value}`;
    }

    const middle = value.startsWith('|') ? value : `| ${value}`;
    return middle.endsWith('|') ? middle : `${middle} |`;
  });

  if (rows.length > 1 && rows.every((row) => isTableRow(row))) {
    return rows;
  }

  return [line];
}

function expandMarkdownLines(source: string): string[] {
  const lines: string[] = [];

  for (const line of source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    lines.push(...splitGluedTableRow(line));
  }

  return lines;
}

function renderMarkdownTable(tableLines: string[]): string {
  const rows = tableLines
    .filter((line) => !isTableSeparator(line.trim()))
    .map((line) => parseTableCells(line.trim()))
    .filter((cells) => cells.some(Boolean));

  if (rows.length === 0) {
    return '';
  }

  const [header, ...body] = rows;
  const thead = `<thead><tr>${header
    .map(
      (cell) =>
        `<th><span class="markdown-table-th-knockout">${formatInline(cell)}</span></th>`,
    )
    .join('')}</tr></thead>`;
  const tbody =
    body.length > 0
      ? `<tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${formatInline(cell)}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody>`
      : '';

  return `<div class="markdown-table-wrap"><table>${thead}${tbody}</table></div>`;
}

export function renderWebMarkdown(source: string): string {
  const lines = expandMarkdownLines(source);
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

    if (isTableRow(trimmed)) {
      const tableLines: string[] = [];
      while (index < lines.length && isTableRow((lines[index] ?? '').trim())) {
        tableLines.push((lines[index] ?? '').trim());
        index += 1;
      }
      const tableHtml = renderMarkdownTable(tableLines);
      if (tableHtml) {
        blocks.push(tableHtml);
      }
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
        isTableRow(next) ||
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
