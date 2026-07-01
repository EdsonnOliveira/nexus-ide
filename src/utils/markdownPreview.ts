import { highlightMarkdownCodeBlock, highlightMermaidDiagram } from '@/utils/codeHighlight';
import { wrapInlineCodeHtml } from '@/utils/inlineCodeBadge';

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
    .replace(/^[\s]*[-*+•·]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '');
}

function applyInlineMarkdown(value: string): string {
  let html = value;
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, (_, code: string) => wrapInlineCodeHtml(code));
  return html;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed.includes('-')) {
    return false;
  }

  return /^[\|\s:\-]+$/.test(trimmed);
}

export function normalizeMarkdownSource(source: string): string {
  return source.replace(/\r/g, '\n').replace(/\uFF5C/g, '|');
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

  for (const line of normalizeMarkdownSource(source).split('\n')) {
    lines.push(...splitGluedTableRow(line));
  }

  return lines;
}

function looksLikeMarkdownProseLine(line: string): boolean {
  const trimmed = line.trim();

  if (/^\*\*[^*\n]+(?::\*\*|\*\*:)/.test(trimmed)) {
    return true;
  }

  if (/^\*\*[^*\n]+\*\*\s/.test(trimmed)) {
    return true;
  }

  const letterCount = (trimmed.match(/[a-zA-ZáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g) ?? []).length;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  if (wordCount >= 10 && letterCount >= 40) {
    return true;
  }

  if (wordCount >= 6 && letterCount / Math.max(trimmed.length, 1) > 0.62) {
    return true;
  }

  return false;
}

function looksLikeCodeLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (isTableSeparator(trimmed)) {
    return false;
  }

  if (/^\s*(export|import|const|let|var|function|class|interface|type|return|if|else|for|while|switch|case|await|async|new|throw|default)\b/.test(
    trimmed,
  )
  ) {
    return true;
  }

  if (/^\s*\/\//.test(trimmed)) {
    return true;
  }

  if (/[{}]/.test(trimmed)) {
    return true;
  }

  if (/=>/.test(trimmed)) {
    return true;
  }

  if (looksLikeMarkdownProseLine(trimmed)) {
    return false;
  }

  if (/;/.test(trimmed)) {
    if (/^\s*(const|let|var|return|import|export|throw|break|continue|case|default)\b/.test(trimmed)) {
      return true;
    }

    if (/=>/.test(trimmed)) {
      return true;
    }

    if (/^\s*[\w$.)]+\s*;/.test(trimmed)) {
      return true;
    }
  }

  if (/=>|\+\+|--|<<|>>|::|\?\./.test(trimmed)) {
    return true;
  }

  if (/^\s*\)?\s*:\s*[\w<>,\s|.&]+[{;]/.test(trimmed)) {
    return true;
  }

  if (/^\s*if\s*\(/.test(trimmed)) {
    return true;
  }

  if (/[=<>]=/.test(trimmed)) {
    return true;
  }

  return false;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim().replace(/^\*\*(.+)\*\*$/, '$1').trim();

  if (!trimmed.includes('|')) {
    return false;
  }

  if (isTableSeparator(trimmed)) {
    return true;
  }

  if (looksLikeCodeLine(trimmed)) {
    return false;
  }

  if (trimmed.startsWith('|')) {
    return parseTableCells(trimmed).length >= 2;
  }

  const cells = parseTableCells(trimmed);

  if (cells.length < 2) {
    return false;
  }

  return cells.every((cell) => cell.length > 0 && cell.length <= 64 && !/[{}();=<>]/.test(cell));
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

function renderMarkdownTable(tableLines: string[]): string {
  const rows = tableLines
    .filter((line) => !isTableSeparator(line.trim()))
    .map((line) => parseTableCells(line.trim()))
    .filter((cells) => cells.some(Boolean));

  if (rows.length === 0) {
    return '';
  }

  const [header, ...body] = rows;
  const thead = `<thead><tr>${header.map((cell) => `<th><span class="markdown-table-th-knockout">${applyInlineMarkdown(escapeHtml(cell))}</span></th>`).join('')}</tr></thead>`;
  const tbody =
    body.length > 0
      ? `<tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(escapeHtml(cell))}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody>`
      : '';

  return `<div class="markdown-table-wrap"><table>${thead}${tbody}</table></div>`;
}

function isAgentSectionTitle(line: string, nextLine: string | null): boolean {
  if (line.length < 4 || line.length > 96) {
    return false;
  }

  if (looksLikeCodeLine(line)) {
    return false;
  }

  if (/^[#|•·\-*`>]/.test(line)) {
    return false;
  }

  if (line.startsWith('```') || isTableRow(line)) {
    return false;
  }

  if (/^\*\*(.+)\*\*$/.test(line)) {
    const inner = line.replace(/^\*\*(.+)\*\*$/, '$1').trim();

    if (looksLikeCodeLine(inner)) {
      return false;
    }

    return true;
  }

  const endsWithColon = /:\s*$/.test(line);
  const endsWithSentence = /[.!?]\s*$/.test(line);

  if (endsWithColon && line.length <= 72) {
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    return wordCount <= 5;
  }

  if (endsWithSentence) {
    return false;
  }

  if (!nextLine) {
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    return endsWithColon && wordCount >= 2 && wordCount <= 8;
  }

  const nextIsList = /^(?:[-*+•·]|\d+\.)\s/.test(nextLine);
  const nextIsTable = isTableRow(nextLine);

  if (nextIsList || nextIsTable) {
    const wordCount = line.split(/\s+/).filter(Boolean).length;

    if (wordCount < 2 && !endsWithColon) {
      return false;
    }

    return !/\.\s/.test(line) || endsWithColon;
  }

  const wordCount = line.split(/\s+/).filter(Boolean).length;

  return wordCount >= 3 && line.length <= 80 && !/\.\s/.test(line);
}

function isMermaidDiagramLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (/^```\s*mermaid/i.test(trimmed)) {
    return true;
  }

  return (
    /^graph\s+(?:TD|LR|TB|RL|BT)\b/i.test(trimmed) ||
    /^flowchart\s+(?:TD|LR|TB|RL|BT)\b/i.test(trimmed) ||
    /^sequenceDiagram\b/i.test(trimmed) ||
    /^classDiagram\b/i.test(trimmed) ||
    /^stateDiagram(?:-v2)?\b/i.test(trimmed)
  );
}

function isMermaidDiagramContentLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (isTableSeparator(trimmed) || isTableRow(trimmed)) {
    return false;
  }

  if (isMermaidDiagramLine(trimmed)) {
    return true;
  }

  if (/^(subgraph|end|classDef|style|linkStyle|click|direction|participant|actor|note)\b/i.test(trimmed)) {
    return true;
  }

  if (/(-->|---|-\.->|==>|===|:::)/.test(trimmed)) {
    return true;
  }

  if (/^\s*[\w$][\w$-]*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/.test(trimmed)) {
    return true;
  }

  return false;
}

function stripMermaidFenceContent(rawCode: string): string {
  const lines = rawCode.split('\n');
  const first = lines[0]?.trim() ?? '';
  const last = lines[lines.length - 1]?.trim() ?? '';

  if (!/^```\s*mermaid/i.test(first)) {
    return rawCode;
  }

  return lines.slice(1, last === '```' ? -1 : lines.length).join('\n');
}

function looksLikeProseLine(trimmed: string): boolean {
  if (looksLikeCodeLine(trimmed)) {
    return false;
  }

  if (/^\s*(export|import|const|let|var|function|class|interface|type|return|if|else|for|while|switch|case|await|async)\b/.test(trimmed)) {
    return false;
  }

  if (/[{}();]/.test(trimmed) && /[=<>]/.test(trimmed)) {
    return false;
  }

  if (/:\s*$/.test(trimmed)) {
    const alpha = (trimmed.match(/[a-zA-ZáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g) ?? []).length;
    return alpha >= 8;
  }

  return false;
}

function shouldAutoCloseMarkdownFence(line: string, codeLineCount: number): boolean {
  if (codeLineCount === 0) {
    return false;
  }

  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed === '```' || /^```\s*\S+/.test(trimmed)) {
    return true;
  }

  if (/^#{1,6}\s/.test(trimmed)) {
    return true;
  }

  if (/^(?:[-*+•·]\s|\d+\.\s)/.test(trimmed)) {
    return true;
  }

  if (/^\*\*[^*]+\*\*\s*$/.test(trimmed)) {
    const inner = trimmed.replace(/^\*\*(.+)\*\*$/, '$1').trim();

    if (!looksLikeCodeLine(inner)) {
      return true;
    }
  }

  if (/^\*\*[^*]+\*\*[:\s]/.test(trimmed) && !looksLikeCodeLine(trimmed)) {
    return true;
  }

  if (/^Obs\.(?:\s|$)/i.test(trimmed)) {
    return true;
  }

  if (looksLikeProseLine(trimmed)) {
    return true;
  }

  return false;
}

function collectCodeBlock(lines: string[], startIndex: number): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const current = lines[index]?.trim() ?? '';

    if (!current) {
      if (block.length > 0) {
        break;
      }

      index += 1;
      continue;
    }

    if (isMermaidDiagramLine(current)) {
      break;
    }

    if (!looksLikeCodeLine(current)) {
      if (block.length > 0) {
        break;
      }

      break;
    }

    block.push(lines[index] ?? '');
    index += 1;
  }

  return { block, nextIndex: index };
}

function inferMarkdownCodeLanguage(code: string): string {
  if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram)\b/m.test(code)) {
    return 'mermaid';
  }

  if (/^\s*#!\/usr\/bin\/env\s+bash/m.test(code) || /^\s*(npm|yarn|pnpm|npx|git|cd|curl)\b/m.test(code)) {
    return 'bash';
  }

  if (
    /^\s*(def|class)\s+\w+/m.test(code) ||
    (/:\s*$/.test(code.split('\n')[0] ?? '') && !/^\s*(export|import|const|let|var|function|class)\b/.test(code))
  ) {
    return 'python';
  }

  if (
    /^\s*(export|import|const|let|var|function|class|interface|type|enum)\b/m.test(code) ||
    /^\s*\/\//m.test(code) ||
    /=>\s*[({]/.test(code)
  ) {
    return 'typescript';
  }

  return 'typescript';
}

function renderHighlightedCodeBlock(rawCode: string, language: string): string {
  const resolvedLanguage = language === 'mermaid' ? 'mermaid' : language;
  const sourceCode = resolvedLanguage === 'mermaid' ? stripMermaidFenceContent(rawCode) : rawCode;
  const highlightedCode =
    resolvedLanguage === 'mermaid'
      ? highlightMermaidDiagram(sourceCode)
      : highlightMarkdownCodeBlock(sourceCode, resolvedLanguage);
  const langClass = resolvedLanguage ? ` language-${resolvedLanguage}` : '';

  return `<pre class="hljs"><code class="hljs${langClass}">${highlightedCode}</code></pre>`;
}

function collectMermaidBlock(lines: string[], startIndex: number): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = startIndex;
  const opensFence = /^```\s*mermaid/i.test(lines[startIndex]?.trim() ?? '');

  if (opensFence) {
    while (index < lines.length) {
      block.push(lines[index] ?? '');
      const current = lines[index]?.trim() ?? '';

      if (index > startIndex && current === '```') {
        index += 1;
        break;
      }

      index += 1;
    }

    return { block, nextIndex: index };
  }

  while (index < lines.length) {
    const current = lines[index]?.trim() ?? '';

    if (!current) {
      break;
    }

    if (!isMermaidDiagramContentLine(current) && block.length > 0) {
      break;
    }

    if (isMermaidDiagramContentLine(current)) {
      block.push(lines[index] ?? '');
      index += 1;
      continue;
    }

    break;
  }

  return { block, nextIndex: index };
}

function isListContinuationLine(line: string): boolean {
  if (!line || line.length > 180) {
    return false;
  }

  if (/^(?:#{1,6}\s|[-*+•·]\s|\d+\.\s|```|\|)/.test(line)) {
    return false;
  }

  if (isTableRow(line)) {
    return false;
  }

  return true;
}

function normalizeSectionTitle(line: string): string {
  return line.replace(/^\*\*(.+)\*\*$/, '$1').trim();
}

export function renderMarkdownPreview(source: string): string {
  const lines = expandMarkdownLines(source);
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
      const safeLanguage = language.replace(/[^a-zA-Z0-9_-]/g, '');
      const isMarkdownFence = safeLanguage === 'markdown' || safeLanguage === 'md';
      index += 1;
      const codeLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];

        if (currentLine.trim() === '```') {
          index += 1;
          break;
        }

        if (!isMarkdownFence && shouldAutoCloseMarkdownFence(currentLine, codeLines.length)) {
          break;
        }

        codeLines.push(currentLine);
        index += 1;
      }

      const rawCode = codeLines.join('\n');
      const resolvedLanguage = safeLanguage || inferMarkdownCodeLanguage(rawCode);

      if (isMarkdownFence) {
        blocks.push(renderMarkdownPreview(rawCode));
        continue;
      }

      const highlightedCode = highlightMarkdownCodeBlock(rawCode, resolvedLanguage);
      const langClass = resolvedLanguage ? ` language-${resolvedLanguage}` : '';
      blocks.push(`<pre class="hljs"><code class="hljs${langClass}">${highlightedCode}</code></pre>`);
      continue;
    }

    if (isTableRow(trimmed)) {
      const tableLines: string[] = [];

      while (index < lines.length && isTableRow(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }

      const tableHtml = renderMarkdownTable(tableLines);

      if (tableHtml) {
        blocks.push(tableHtml);
      }

      continue;
    }

    if (looksLikeCodeLine(trimmed) && !isMermaidDiagramLine(trimmed)) {
      const { block, nextIndex } = collectCodeBlock(lines, index);
      index = nextIndex;
      const rawCode = block.join('\n').trimEnd();

      if (rawCode) {
        blocks.push(renderHighlightedCodeBlock(rawCode, inferMarkdownCodeLanguage(rawCode)));
        continue;
      }
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = applyInlineMarkdown(escapeHtml(headingMatch[2]));
      blocks.push(`<h${level}>${content}</h${level}>`);
      index += 1;
      continue;
    }

    if (isMermaidDiagramLine(trimmed)) {
      const { block, nextIndex } = collectMermaidBlock(lines, index);
      index = nextIndex;
      const rawCode = block.join('\n');
      blocks.push(renderHighlightedCodeBlock(rawCode, 'mermaid'));
      continue;
    }

    const nextLine = (() => {
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor]?.trim() ?? '';

        if (candidate) {
          return candidate;
        }
      }

      return null;
    })();

    if (isAgentSectionTitle(trimmed, nextLine)) {
      const level = /:\s*$/.test(trimmed) ? 4 : 3;
      const title = normalizeSectionTitle(trimmed);
      blocks.push(`<h${level}>${applyInlineMarkdown(escapeHtml(title))}</h${level}>`);
      index += 1;
      continue;
    }

    const unorderedMatch = trimmed.match(/^(?:[-*+•·]\s+)(.+)$/);

    if (unorderedMatch) {
      const itemText = unorderedMatch[1];
      const nextNonEmptyLine = (() => {
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
          const candidate = lines[cursor]?.trim() ?? '';

          if (candidate) {
            return candidate;
          }
        }

        return null;
      })();
      const nextIsAnotherBullet = nextNonEmptyLine
        ? /^(?:[-*+•·]\s)/.test(nextNonEmptyLine)
        : false;

      if (!nextIsAnotherBullet && itemText.length >= 72) {
        blocks.push(`<p>* ${applyInlineMarkdown(escapeHtml(itemText))}</p>`);
        index += 1;
        continue;
      }

      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        const itemMatch = current.match(/^(?:[-*+•·]\s+)(.+)$/);

        if (itemMatch) {
          items.push(`<li>${applyInlineMarkdown(escapeHtml(itemMatch[1]))}</li>`);
          index += 1;
          continue;
        }

        if (items.length > 0 && isListContinuationLine(current)) {
          const lastItem = items[items.length - 1] ?? '';
          items[items.length - 1] = lastItem.replace(
            /<\/li>$/,
            ` ${applyInlineMarkdown(escapeHtml(current))}</li>`,
          );
          index += 1;
          continue;
        }

        break;
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

        if (itemMatch) {
          items.push(`<li>${applyInlineMarkdown(escapeHtml(itemMatch[1]))}</li>`);
          index += 1;
          continue;
        }

        if (items.length > 0 && isListContinuationLine(current)) {
          const lastItem = items[items.length - 1] ?? '';
          items[items.length - 1] = lastItem.replace(
            /<\/li>$/,
            ` ${applyInlineMarkdown(escapeHtml(current))}</li>`,
          );
          index += 1;
          continue;
        }

        break;
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

      if (/^(?:[-*+•·]\s)/.test(current)) {
        break;
      }

      if (/^\d+\.\s/.test(current)) {
        break;
      }

      if (/^```/.test(current)) {
        break;
      }

      if (isTableRow(current)) {
        break;
      }

      if (isMermaidDiagramLine(current)) {
        break;
      }

      if (looksLikeCodeLine(current)) {
        break;
      }

      if (isAgentSectionTitle(current, lines[index + 1]?.trim() || null)) {
        break;
      }

      paragraphLines.push(applyInlineMarkdown(escapeHtml(current)));
      index += 1;
    }

    blocks.push(`<p>${paragraphLines.join('<br />')}</p>`);
  }

  return blocks.join('');
}
