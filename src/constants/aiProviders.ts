import type { CliAgentCommand } from '@/constants/cliAgentCommands';
import { DEFAULT_CLI_AGENT_COMMAND } from '@/constants/cliAgentCommands';

export type AiProviderId = 'cursor' | 'claude' | 'nexus';

export interface AiProviderOption {
  id: AiProviderId;
  label: string;
  subtitle?: string;
  disabled: boolean;
}

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  { id: 'cursor', label: 'Cursor', disabled: false },
  { id: 'claude', label: 'Claude Code', disabled: false },
  { id: 'nexus', label: 'Nexus', subtitle: 'Em breve', disabled: true },
];

export const DEFAULT_AI_PROVIDER: Exclude<AiProviderId, 'nexus'> = 'cursor';

export function isAiProviderId(value: string): value is AiProviderId {
  return value === 'cursor' || value === 'claude' || value === 'nexus';
}

export function isSelectableAiProviderId(value: string): value is Exclude<AiProviderId, 'nexus'> {
  return value === 'cursor' || value === 'claude';
}

export function preferredAiProviderToCli(provider: AiProviderId): CliAgentCommand {
  if (provider === 'claude') {
    return 'claude';
  }

  return DEFAULT_CLI_AGENT_COMMAND;
}
