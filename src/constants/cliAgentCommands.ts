export const CLI_AGENT_COMMANDS = ['cursor-agent', 'claude', 'codex', 'gemini'] as const;

export type CliAgentCommand = (typeof CLI_AGENT_COMMANDS)[number];

export const DEFAULT_CLI_AGENT_COMMAND: CliAgentCommand = 'cursor-agent';

export function extractCliAgentCommand(command: string): string | null {
  const base = command.trim().split(/\s+/)[0] ?? '';

  return CLI_AGENT_COMMANDS.includes(base as CliAgentCommand) ? base : null;
}
