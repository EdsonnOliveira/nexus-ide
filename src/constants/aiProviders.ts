import type { CliAgentCommand } from '@/constants/cliAgentCommands';
import { DEFAULT_CLI_AGENT_COMMAND } from '@/constants/cliAgentCommands';

export type AiProviderId = 'cursor' | 'claude' | 'codex' | 'opencode' | 'antigravity' | 'nexus';

export interface AiProviderOption {
  id: AiProviderId;
  label: string;
  subtitle?: string;
  disabled: boolean;
}

export const AI_PROVIDER_OPTIONS: AiProviderOption[] = [
  { id: 'cursor', label: 'Cursor', disabled: false },
  { id: 'claude', label: 'Claude Code', disabled: false },
  { id: 'codex', label: 'Codex', disabled: false },
  { id: 'opencode', label: 'OpenCode', disabled: false },
  { id: 'antigravity', label: 'Antigravity', disabled: false },
  { id: 'nexus', label: 'Nexus', subtitle: 'Em breve', disabled: true },
];

export const ASK_AI_PROVIDER_OPTIONS: { id: Exclude<AiProviderId, 'nexus'>; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity' },
];

export const DEFAULT_AI_PROVIDER: Exclude<AiProviderId, 'nexus'> = 'cursor';

export function aiProviderLabel(provider: Exclude<AiProviderId, 'nexus'>): string {
  return ASK_AI_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? 'Cursor';
}

export const DEFAULT_OPENCODE_MODEL = 'opencode/big-pickle';

export function isAiProviderId(value: string): value is AiProviderId {
  return (
    value === 'cursor' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'antigravity' ||
    value === 'nexus'
  );
}

export function isSelectableAiProviderId(value: string): value is Exclude<AiProviderId, 'nexus'> {
  return (
    value === 'cursor' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'antigravity'
  );
}

export function preferredAiProviderToCli(provider: AiProviderId): CliAgentCommand {
  if (provider === 'claude') {
    return 'claude';
  }

  if (provider === 'codex') {
    return 'codex';
  }

  if (provider === 'opencode') {
    return 'opencode';
  }

  if (provider === 'antigravity') {
    return 'agy';
  }

  return DEFAULT_CLI_AGENT_COMMAND;
}

export function cliAgentToAiProvider(cliAgent: string): Exclude<AiProviderId, 'nexus'> {
  const base = cliAgent.trim().split(/\s+/)[0] ?? '';

  if (base === 'claude') {
    return 'claude';
  }

  if (base === 'codex') {
    return 'codex';
  }

  if (base === 'opencode') {
    return 'opencode';
  }

  if (base === 'agy') {
    return 'antigravity';
  }

  return DEFAULT_AI_PROVIDER;
}
