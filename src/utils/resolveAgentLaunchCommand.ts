import {
  preferredAiProviderToCli,
  type AiProviderId,
} from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { buildAgentPaneLaunchCommand } from '@/utils/agentCliSession';

export async function resolveAgentLaunchCommand(
  _projectPath: string | null,
  provider?: Exclude<AiProviderId, 'nexus'>,
): Promise<string> {
  const preferredAiProvider =
    provider ?? useAppSettingsStore.getState().preferredAiProvider;
  const cli = preferredAiProviderToCli(preferredAiProvider);
  const launchCommand = buildAgentPaneLaunchCommand(cli);

  return launchCommand.trim() || cli;
}
