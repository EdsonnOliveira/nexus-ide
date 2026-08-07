import { preferredAiProviderToCli } from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { buildAgentPaneLaunchCommand } from '@/utils/agentCliSession';

export async function resolveAgentLaunchCommand(_projectPath: string | null): Promise<string> {
  const preferredAiProvider = useAppSettingsStore.getState().preferredAiProvider;

  return buildAgentPaneLaunchCommand(preferredAiProviderToCli(preferredAiProvider));
}
