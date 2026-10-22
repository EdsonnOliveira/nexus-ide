import type { AgentTab, AgentTurn, AgentWhatsAppNotify } from '@/types';
import { resolveAgentFinishProject } from '@/utils/findProjectIdByPaneId';
import { resolvePromptDisplayContent } from '@/utils/agentPromptAttachments';
import { useAgentWhatsAppNotifyStore } from '@/stores/useAgentWhatsAppNotifyStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { findPaneTab } from '@/utils/tabGroups';

function truncatePromptPreview(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function resolveAgentWhatsAppLink(tab: Pick<AgentTab, 'whatsappLink'> | null | undefined): string {
  return tab?.whatsappLink?.trim() ?? '';
}

export function openAgentWhatsAppFinishForTurn(input: {
  turn: AgentTurn;
  paneId: string;
  projectId?: string | null;
  agentLabel?: string;
}): void {
  const notify = input.turn.whatsappNotify;

  if (!notify || input.turn.running) {
    return;
  }

  const resolved = resolveAgentFinishProject({
    projectId: input.projectId ?? '',
    paneId: input.paneId,
  });
  const projectTabs =
    useProjectStore.getState().projects.find((entry) => entry.id === resolved.projectId)?.tabs ??
    [];
  const paneTab = findPaneTab(projectTabs, input.paneId);
  const cliLabel =
    input.agentLabel?.trim() ||
    (paneTab?.type === 'agent' ? resolveAgentTabCli(paneTab) : '') ||
    'Agent';
  const promptPreview = truncatePromptPreview(
    resolvePromptDisplayContent(input.turn.user.content) ||
      input.turn.user.skillLabel?.trim() ||
      'Prompt',
  );

  const agentLink =
    notify.link.trim() ||
    (paneTab?.type === 'agent' ? resolveAgentWhatsAppLink(paneTab) : '');

  useAgentWhatsAppNotifyStore.getState().openFinish({
    paneId: input.paneId,
    projectId: resolved.projectId,
    turnId: input.turn.id,
    agentLabel: resolved.projectName
      ? `${resolved.projectName} · ${cliLabel}`
      : cliLabel,
    promptPreview,
    message: notify.message,
    link: agentLink,
  });

  void window.nexus?.agentPip?.focusMain?.();
}

export function patchTurnWhatsAppNotify(
  turns: AgentTurn[],
  turnId: string,
  notify: AgentWhatsAppNotify | null,
): AgentTurn[] {
  return turns.map((turn) => {
    if (turn.id !== turnId) {
      return turn;
    }

    if (!notify) {
      if (!turn.whatsappNotify) {
        return turn;
      }

      const nextTurn: AgentTurn = { ...turn };
      delete nextTurn.whatsappNotify;
      return nextTurn;
    }

    return {
      ...turn,
      whatsappNotify: {
        message: notify.message,
        link: notify.link,
      },
    };
  });
}
