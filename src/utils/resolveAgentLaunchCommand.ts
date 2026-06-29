import { DEFAULT_CLI_AGENT_COMMAND } from '@/constants/cliAgentCommands';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { buildAgentPaneLaunchCommand } from '@/utils/agentCliSession';

export async function resolveAgentLaunchCommand(projectPath: string | null): Promise<string> {
  const lastAgentCommand = useTerminalSessionStore.getState().lastAgentCommand;

  if (lastAgentCommand) {
    return buildAgentPaneLaunchCommand(lastAgentCommand);
  }

  if (!projectPath) {
    return buildAgentPaneLaunchCommand(DEFAULT_CLI_AGENT_COMMAND);
  }

  const hints = await window.nexus.files.getTerminalHints(projectPath);
  const cliHint = hints.find((hint) => hint.id.startsWith('cli-'));

  if (cliHint) {
    return buildAgentPaneLaunchCommand(cliHint.command.replace(/\n$/, ''));
  }

  return buildAgentPaneLaunchCommand(DEFAULT_CLI_AGENT_COMMAND);
}
