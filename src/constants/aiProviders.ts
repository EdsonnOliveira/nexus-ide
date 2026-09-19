import type { CliAgentCommand } from '@/constants/cliAgentCommands';
import { DEFAULT_CLI_AGENT_COMMAND } from '@/constants/cliAgentCommands';

export type AiProviderId = 'cursor' | 'claude' | 'codex' | 'opencode' | 'antigravity' | 'nexus';

export type SelectableAiProviderId = Exclude<AiProviderId, 'nexus'>;

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

export const ASK_AI_PROVIDER_OPTIONS: { id: SelectableAiProviderId; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity' },
];

export const SELECTABLE_AI_PROVIDER_IDS: readonly SelectableAiProviderId[] =
  ASK_AI_PROVIDER_OPTIONS.map((option) => option.id);

export const DEFAULT_AI_PROVIDER: SelectableAiProviderId = 'cursor';

export const DEFAULT_ENABLED_AI_PROVIDERS: SelectableAiProviderId[] = [
  ...SELECTABLE_AI_PROVIDER_IDS,
];

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

export function isSelectableAiProviderId(value: string): value is SelectableAiProviderId {
  return (
    value === 'cursor' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'antigravity'
  );
}

export function normalizeEnabledAiProviders(value: unknown): SelectableAiProviderId[] {
  const source = Array.isArray(value) ? value : DEFAULT_ENABLED_AI_PROVIDERS;
  const selected = new Set<SelectableAiProviderId>();

  for (const item of source) {
    if (typeof item === 'string' && isSelectableAiProviderId(item)) {
      selected.add(item);
    }
  }

  const next = SELECTABLE_AI_PROVIDER_IDS.filter((id) => selected.has(id));

  if (next.length === 0) {
    return [DEFAULT_AI_PROVIDER];
  }

  return next;
}

export function resolveEnabledAiProvider(
  preferred: SelectableAiProviderId,
  enabled: readonly SelectableAiProviderId[],
): SelectableAiProviderId {
  if (enabled.includes(preferred)) {
    return preferred;
  }

  return enabled[0] ?? DEFAULT_AI_PROVIDER;
}

export function normalizeNoAttachmentAiProvider(value: unknown): SelectableAiProviderId | null {
  return typeof value === 'string' && isSelectableAiProviderId(value) ? value : null;
}

export function resolveAiProviderForPromptAttachments({
  hasAttachments,
  preferredAiProvider,
  noAttachmentAiProvider,
  enabledAiProviders,
}: {
  hasAttachments: boolean;
  preferredAiProvider: SelectableAiProviderId;
  noAttachmentAiProvider: SelectableAiProviderId | null;
  enabledAiProviders?: readonly SelectableAiProviderId[];
}): SelectableAiProviderId | null {
  if (!noAttachmentAiProvider) {
    return null;
  }

  if (enabledAiProviders && !enabledAiProviders.includes(noAttachmentAiProvider)) {
    return null;
  }

  return hasAttachments ? preferredAiProvider : noAttachmentAiProvider;
}

export function visibleAskAiProviderOptions(
  enabled: readonly SelectableAiProviderId[],
  alwaysInclude?: SelectableAiProviderId,
): { id: SelectableAiProviderId; label: string }[] {
  return ASK_AI_PROVIDER_OPTIONS.filter(
    (option) => enabled.includes(option.id) || option.id === alwaysInclude,
  );
}

export function isVisibleAiUsageProvider(
  id: string,
  enabled: readonly SelectableAiProviderId[],
): boolean {
  if (isSelectableAiProviderId(id)) {
    return enabled.includes(id);
  }

  return true;
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
