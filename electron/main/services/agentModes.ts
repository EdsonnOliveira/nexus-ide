import type { TerminalCommandHint } from './terminalHints';

const AGENT_MODE_DEFINITIONS: {
  id: string;
  label: string;
  badgeIcon: 'mode-agent' | 'mode-plan' | 'mode-ask' | 'mode-debug' | 'mode-multitask';
  badgeColor: string;
  command: string;
}[] = [
  {
    id: 'agent',
    label: 'Agent',
    badgeIcon: 'mode-agent',
    badgeColor: '#3b82f6',
    command: '/agent\n',
  },
  {
    id: 'plan',
    label: 'Plan',
    badgeIcon: 'mode-plan',
    badgeColor: '#22c55e',
    command: '/plan\n',
  },
  {
    id: 'debug',
    label: 'Debug',
    badgeIcon: 'mode-debug',
    badgeColor: '#f97316',
    command: '/debug\n',
  },
  {
    id: 'multitask',
    label: 'Multitask',
    badgeIcon: 'mode-multitask',
    badgeColor: '#a855f7',
    command: '/multitask\n',
  },
  {
    id: 'ask',
    label: 'Ask',
    badgeIcon: 'mode-ask',
    badgeColor: '#06b6d4',
    command: '/ask\n',
  },
];

export function getAgentModeHints(): TerminalCommandHint[] {
  return AGENT_MODE_DEFINITIONS.map((mode) => ({
    id: `mode-${mode.id}`,
    badge: '',
    badgeIcon: mode.badgeIcon,
    badgeColor: mode.badgeColor,
    label: mode.label,
    command: mode.command,
    hintKind: 'mode',
  }));
}
