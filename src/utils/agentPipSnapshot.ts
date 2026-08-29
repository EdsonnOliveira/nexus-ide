import type { AgentTab, Project } from '@/types';
import type { CloudAgentSession } from '@/types/cloudAgent';
import type { AgentPipSnapshot } from '@/types/agentPip';
import type { AgentContextUsageSnapshot } from '@/utils/agentContextUsageParser';
import { useAgentComposerDraftStore } from '@/stores/useAgentComposerDraftStore';

export const CLOUD_AGENT_PIP_PREFIX = 'cloud:';

export function buildDesktopAgentPipSnapshot(input: {
  paneId: string;
  project: Project;
  logoDataUrl: string | null;
  busy: boolean;
  tab: AgentTab;
  revision: number;
  contextUsage?: AgentContextUsageSnapshot | null;
  pinging?: boolean;
}): AgentPipSnapshot {
  return {
    kind: 'desktop',
    paneId: input.paneId,
    projectId: input.project.id,
    projectPath: input.project.path,
    projectName: input.project.name,
    projectColor: input.project.color,
    projectIcon: input.project.icon,
    logoDataUrl: input.logoDataUrl,
    busy: input.busy || input.tab.turns.some((turn) => turn.running),
    draft: useAgentComposerDraftStore.getState().getDraft(input.paneId),
    revision: input.revision,
    contextUsage: input.contextUsage ?? null,
    pinging: Boolean(input.pinging),
    tab: input.tab,
    followUps: input.tab.followUps ?? [],
    cloudTurns: [],
    project: {
      id: input.project.id,
      name: input.project.name,
      path: input.project.path,
      color: input.project.color,
      icon: input.project.icon,
      logo: input.project.logo,
      agentResponseSkills: input.project.agentResponseSkills ?? [],
    },
  };
}

export function buildCloudAgentPipSnapshot(
  session: CloudAgentSession,
  pinging = false,
): AgentPipSnapshot {
  return {
    kind: 'cloud',
    paneId: `${CLOUD_AGENT_PIP_PREFIX}${session.id}`,
    projectId: session.projectId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    projectColor: session.projectColor,
    projectIcon: '',
    logoDataUrl: session.logoUrl,
    busy: session.status === 'running' || session.turns.some((turn) => turn.status === 'running'),
    draft: '',
    revision: Date.now(),
    contextUsage: null,
    pinging: Boolean(pinging),
    tab: null,
    followUps: [],
    cloudTurns: session.turns,
    project: null,
  };
}

export async function readLogoDataUrl(logo: string | null | undefined): Promise<string | null> {
  if (!logo) {
    return null;
  }

  if (logo.startsWith('data:') || logo.startsWith('http')) {
    return logo;
  }

  return window.nexus.files.readImageAsDataUrl(logo);
}
