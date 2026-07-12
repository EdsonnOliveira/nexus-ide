export interface TerminalPromptInfo {
  nodeVersion: string;
  path: string;
  branch: string;
  files: number;
  additions: number;
  deletions: number;
}

const PROMPT_PREFIX = '\x1eNEXUS_PROMPT\x1f';
const PROMPT_HIDE = '\x1eNEXUS_PROMPT_HIDE\x1e';
const MARKER_SUFFIX = '\x1e';

function sanitizePromptField(value: string): string {
  return value.replace(/[\x1e\x1f]/g, '');
}

function isIncompleteMarkerPrefix(value: string): boolean {
  if (!value || value[0] !== '\x1e') {
    return false;
  }

  return PROMPT_HIDE.startsWith(value) || PROMPT_PREFIX.startsWith(value);
}

export function parseTerminalPromptPayload(payload: string): TerminalPromptInfo | null {
  const parts = payload.split('\x1f');

  if (parts.length < 6) {
    return null;
  }

  return {
    nodeVersion: sanitizePromptField(parts[0] ?? ''),
    path: sanitizePromptField(parts[1] ?? ''),
    branch: sanitizePromptField(parts[2] ?? ''),
    files: Number(parts[3] || 0) || 0,
    additions: Number(parts[4] || 0) || 0,
    deletions: Number(parts[5] || 0) || 0,
  };
}

export function createNexusPromptStreamParser(
  onPromptInfo: (info: TerminalPromptInfo) => void,
  onPromptHide: () => void,
) {
  let pending = '';

  return (chunk: string): string => {
    const combined = pending + chunk;
    pending = '';
    let output = '';
    let cursor = 0;

    while (cursor < combined.length) {
      const hideStart = combined.indexOf(PROMPT_HIDE, cursor);
      const infoStart = combined.indexOf(PROMPT_PREFIX, cursor);
      let start = -1;
      let kind: 'hide' | 'info' | null = null;

      if (hideStart !== -1 && (infoStart === -1 || hideStart <= infoStart)) {
        start = hideStart;
        kind = 'hide';
      } else if (infoStart !== -1) {
        start = infoStart;
        kind = 'info';
      }

      if (start === -1 || !kind) {
        const remainder = combined.slice(cursor);

        if (isIncompleteMarkerPrefix(remainder)) {
          pending = remainder;
        } else {
          output += remainder;
        }

        break;
      }

      output += combined.slice(cursor, start);

      if (kind === 'hide') {
        onPromptHide();
        cursor = start + PROMPT_HIDE.length;
        continue;
      }

      const valueStart = start + PROMPT_PREFIX.length;
      const end = combined.indexOf(MARKER_SUFFIX, valueStart);

      if (end === -1) {
        pending = combined.slice(start);
        break;
      }

      const info = parseTerminalPromptPayload(combined.slice(valueStart, end));

      if (info) {
        onPromptInfo(info);
      }

      cursor = end + MARKER_SUFFIX.length;
    }

    return output;
  };
}
