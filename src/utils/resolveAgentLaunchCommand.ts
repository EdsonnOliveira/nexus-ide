import { DEFAULT_CLI_AGENT_COMMAND } from '@/constants/cliAgentCommands';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

export async function resolveAgentLaunchCommand(projectPath: string | null): Promise<string> {
  const lastAgentCommand = useTerminalSessionStore.getState().lastAgentCommand;

  if (lastAgentCommand) {
    return lastAgentCommand;
  }

  if (!projectPath) {
    return DEFAULT_CLI_AGENT_COMMAND;
  }

  const hints = await window.nexus.files.getTerminalHints(projectPath);
  const cliHint = hints.find((hint) => hint.id.startsWith('cli-'));

  if (cliHint) {
    return cliHint.command.replace(/\n$/, '');
  }

  return DEFAULT_CLI_AGENT_COMMAND;
}
