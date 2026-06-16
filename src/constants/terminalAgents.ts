import type { TerminalAgent, TerminalAgentConfig } from '@/types';

export const TERMINAL_AGENT_ORDER: TerminalAgent[] = [
  'cursor',
  'claude',
  'composer',
  'shell',
];

export const TERMINAL_AGENTS: Record<TerminalAgent, TerminalAgentConfig> = {
  cursor: {
    label: 'Cursor Agent',
    cursorColor: '#3b82f6',
    selectionBackground: 'rgba(59, 130, 246, 0.35)',
    promptPrefix: '→',
    promptColor: '#3b82f6',
    inputPlaceholder: 'Adicionar follow-up',
    launchCommand: null,
  },
  claude: {
    label: 'Claude',
    cursorColor: '#d97706',
    selectionBackground: 'rgba(217, 119, 6, 0.3)',
    promptPrefix: '›',
    promptColor: '#f97316',
    inputPlaceholder: 'Message Claude...',
    launchCommand: null,
  },
  composer: {
    label: 'Composer 2.5 Fast',
    cursorColor: '#8b5cf6',
    selectionBackground: 'rgba(139, 92, 246, 0.35)',
    promptPrefix: '◆',
    promptColor: '#a78bfa',
    inputPlaceholder: 'Adicionar follow-up',
    launchCommand: null,
  },
  shell: {
    label: 'Terminal padrão',
    cursorColor: '#3b82f6',
    selectionBackground: 'rgba(59, 130, 246, 0.35)',
    promptPrefix: '→',
    promptColor: '#3b82f6',
    inputPlaceholder: 'Digite o comando...',
    launchCommand: null,
  },
};

export function getNextTerminalAgent(current: TerminalAgent): TerminalAgent {
  const index = TERMINAL_AGENT_ORDER.indexOf(current);
  const nextIndex = index === -1 ? 0 : (index + 1) % TERMINAL_AGENT_ORDER.length;
  return TERMINAL_AGENT_ORDER[nextIndex];
}
