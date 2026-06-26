import type { Terminal } from '@xterm/xterm';
import { stripAnsi } from '@/utils/terminalTaskCompletion';

const AGENT_INPUT_ARROW_PATTERN = /(?:^|\s)(?:->|→|›|◆|>|❯|»|▶)\s*(.*)$/;
const CSI_FRAGMENT_PATTERN = /\[(?:\d{1,3}(?:;\d{1,3})*)?[ -/]*[@-~A-Za-z]/g;
const OSC_FRAGMENT_PATTERN = /\]\d+;[^\s\]]*(?:\\|\x07)?/g;

export function sanitizeAgentPrompt(text: string): string {
  return stripAnsi(text)
    .replace(/\x1b/g, '')
    .replace(CSI_FRAGMENT_PATTERN, '')
    .replace(OSC_FRAGMENT_PATTERN, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function readShellPromptInput(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const cursorY = buffer.cursorY;

  for (let y = cursorY; y >= Math.max(0, cursorY - 15); y -= 1) {
    const line = buffer.getLine(y);

    if (!line) {
      continue;
    }

    const lineText = line.translateToString(true).replace(/\s+$/, '');
    const agentMatch = lineText.match(AGENT_INPUT_ARROW_PATTERN);

    if (agentMatch) {
      return sanitizeAgentPrompt(agentMatch[1] ?? '');
    }
  }

  const cursorLine = buffer.getLine(cursorY);

  if (!cursorLine) {
    return '';
  }

  const lineText = cursorLine.translateToString(true).replace(/\s+$/, '');
  const shellMatch = lineText.match(/[%#]\s*(.*)$/);

  if (!shellMatch) {
    return sanitizeAgentPrompt(lineText);
  }

  return sanitizeAgentPrompt(shellMatch[1] ?? '');
}
