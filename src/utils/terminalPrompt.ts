import {
  TERMINAL_BADGE_MAX_COLS,
  TERMINAL_BADGE_MIN_COLS,
  TERMINAL_BADGE_PROMPT_GAP_COLS,
} from '@/utils/terminalBadgeMetrics';

const PROMPT_HOLD_BACK = /\d{1,4}%$/;
const PROMPT_ONLY_SPACES = ` {${TERMINAL_BADGE_MIN_COLS + TERMINAL_BADGE_PROMPT_GAP_COLS},${TERMINAL_BADGE_MAX_COLS + TERMINAL_BADGE_PROMPT_GAP_COLS}}(?=[\\r\\n]|$)`;

export function stripShellPromptArtifacts(data: string): string {
  return data
    .replace(/\r(\d{1,4})%(?=[\s\u007f]|$|[a-zA-Z~/!.'"`[(])/g, '\r')
    .replace(/(^|\n)(\d{1,4})%(?=[\s\u007f]|$|[a-zA-Z~/!.'"`[(])/gm, '$1')
    .replace(/\r[%#](?=[\s\u007f\r\n]|$|[a-zA-Z~/!.'"`[(])/g, '\r')
    .replace(/(^|\n)[%#](?=[\s\u007f\r\n]|$|[a-zA-Z~/!.'"`[(])/gm, '$1')
    .replace(
      /\r([A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?:\s+[^\s%#]+)?\s*)[%#](?=[\s\u007f]|$|[a-zA-Z~/!.'"`[(])/g,
      '\r',
    )
    .replace(
      /(^|\n)([A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?:\s+[^\s%#]+)?\s*)[%#](?=[\s\u007f]|$|[a-zA-Z~/!.'"`[(])/gm,
      '$1',
    )
    .replace(
      /\r((?:~\/[^\s%#\r\n]+|\/[^\s%#\r\n]+))\s*[%#]\s*/g,
      '\r',
    )
    .replace(
      /(^|\n)((?:~\/[^\s%#\r\n]+|\/[^\s%#\r\n]+))\s*[%#]\s*/gm,
      '$1',
    )
    .replace(new RegExp(`\\r${PROMPT_ONLY_SPACES}`, 'g'), '\r')
    .replace(new RegExp(`(^|\\n)${PROMPT_ONLY_SPACES}`, 'gm'), '$1');
}

export class TerminalOutputSanitizer {
  private carry = '';

  reset(): void {
    this.carry = '';
  }

  process(data: string, parseCwd: (chunk: string) => string): string {
    const combined = parseCwd(this.carry + data);
    this.carry = '';

    if (!combined) {
      return combined;
    }

    if (!combined.endsWith('\n') && !combined.endsWith('\r')) {
      const holdback = combined.match(PROMPT_HOLD_BACK);

      if (holdback) {
        this.carry = holdback[0];
        return stripShellPromptArtifacts(combined.slice(0, combined.length - holdback[0].length));
      }
    }

    return stripShellPromptArtifacts(combined);
  }
}
