export type WebAskAiProviderId = 'cursor' | 'claude' | 'opencode' | 'antigravity';

export const WEB_ASK_AI_PROVIDER_OPTIONS: { id: WebAskAiProviderId; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity' },
];

export const DEFAULT_WEB_AGENT_COMMAND = 'cursor-agent';

export function isWebAskAiProviderId(value: string): value is WebAskAiProviderId {
  return (
    value === 'cursor' || value === 'claude' || value === 'opencode' || value === 'antigravity'
  );
}

export function webAiProviderToAgentCommand(provider: WebAskAiProviderId): string {
  if (provider === 'claude') {
    return 'claude';
  }

  if (provider === 'opencode') {
    return 'opencode';
  }

  if (provider === 'antigravity') {
    return 'agy';
  }

  return DEFAULT_WEB_AGENT_COMMAND;
}

export function agentCommandToWebAiProvider(command: string): WebAskAiProviderId {
  const base = command.trim().split(/\s+/)[0] ?? '';

  if (base === 'claude') {
    return 'claude';
  }

  if (base === 'opencode') {
    return 'opencode';
  }

  if (base === 'agy') {
    return 'antigravity';
  }

  return 'cursor';
}

export function normalizeWebAgentCommand(command: string | null | undefined): string {
  const base = (command ?? '').trim().split(/\s+/)[0] ?? '';

  if (base === 'claude' || base === 'opencode' || base === 'agy' || base === 'cursor-agent') {
    return base;
  }

  return DEFAULT_WEB_AGENT_COMMAND;
}
