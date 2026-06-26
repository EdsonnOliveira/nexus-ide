import type { ITheme } from '@xterm/xterm';
import { buildMonokaiTheme } from '@/constants/monokaiTheme';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { TerminalAgent } from '@/types';

export function buildTerminalTheme(agent: TerminalAgent): ITheme {
  const config = TERMINAL_AGENTS[agent];

  return buildMonokaiTheme(config.cursorColor, '#272822', config.selectionBackground);
}

export function getTerminalCursorCssVar(agent: TerminalAgent): string {
  return TERMINAL_AGENTS[agent].cursorColor;
}
