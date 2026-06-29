export type AutomationAgentMode = 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';

export type AgentModeBadgeIcon =
  | 'mode-agent'
  | 'mode-plan'
  | 'mode-debug'
  | 'mode-multitask'
  | 'mode-ask';

export interface AgentModeOption {
  id: AutomationAgentMode;
  label: string;
  badgeIcon: AgentModeBadgeIcon;
  badgeColor: string;
}

export const AGENT_MODE_OPTIONS: AgentModeOption[] = [
  { id: 'agent', label: 'Agent', badgeIcon: 'mode-agent', badgeColor: '#3b82f6' },
  { id: 'plan', label: 'Plan', badgeIcon: 'mode-plan', badgeColor: '#22c55e' },
  { id: 'debug', label: 'Debug', badgeIcon: 'mode-debug', badgeColor: '#f97316' },
  { id: 'multitask', label: 'Multitask', badgeIcon: 'mode-multitask', badgeColor: '#a855f7' },
  { id: 'ask', label: 'Ask', badgeIcon: 'mode-ask', badgeColor: '#06b6d4' },
];

export type NonAgentMode = Exclude<AutomationAgentMode, 'agent'>;

export const AGENT_MODE_INPUT_PLACEHOLDERS: Record<NonAgentMode, string> = {
  plan: 'Planeje e desenhe antes de...',
  debug: 'Descreva o que precisa depurar...',
  multitask: 'Descreva as tarefas em paralelo...',
  ask: 'Pergunte sobre o projeto...',
};

export function getAgentModeOption(mode: AutomationAgentMode): AgentModeOption | undefined {
  return AGENT_MODE_OPTIONS.find((entry) => entry.id === mode);
}
