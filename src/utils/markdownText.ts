export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function stripMarkdownSyntax(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s]*[-*+•·]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '');
}

const COLLAPSED_FENCE_LANG =
  'bash|shell|sh|zsh|fish|ps1|powershell|ts|tsx|typescript|js|jsx|javascript|json|jsonc|py|python|go|rs|rust|css|scss|html|xml|md|markdown|text|plaintext|txt|yaml|yml|sql|diff|dockerfile|docker|java|kt|kotlin|swift|c|cpp|h|hpp|rb|ruby|php|toml|ini|env|graphql|vue|svelte|csharp|cs|lua|r|scala|zig|nim|elixir|ex|dart|proto|protobuf';

const COLLAPSED_OPEN_FENCE = new RegExp(`\`\`\`(${COLLAPSED_FENCE_LANG})(?=[^\\s\`])`, 'gi');
const COLLAPSED_CLOSE_FENCE = new RegExp(
  `\`\`\`(?!(?:${COLLAPSED_FENCE_LANG})\\b)(?=[A-Za-záàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ*#\\d])`,
  'gi',
);

export function repairCollapsedMarkdownFences(source: string): string {
  return source
    .replace(/(\S)```/g, '$1\n```')
    .replace(COLLAPSED_OPEN_FENCE, '```$1\n')
    .replace(COLLAPSED_CLOSE_FENCE, '```\n');
}

export function normalizeMarkdownSource(source: string): string {
  return repairCollapsedMarkdownFences(source.replace(/\r/g, '\n').replace(/\uFF5C/g, '|'));
}
