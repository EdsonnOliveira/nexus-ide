import type { AutomationAgentMode } from '@/constants/agentModes';

const AGENT_MODE_COMMANDS: AutomationAgentMode[] = ['agent', 'plan', 'debug', 'multitask', 'ask'];

export function parseAgentModeCommand(command: string): AutomationAgentMode | null {
  const trimmed = command.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const mode = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase();

  if (!mode || !AGENT_MODE_COMMANDS.includes(mode as AutomationAgentMode)) {
    return null;
  }

  return mode as AutomationAgentMode;
}

export function shouldShowAgentSkillHints(mode: AutomationAgentMode): boolean {
  return mode === 'agent' || mode === 'multitask';
}
