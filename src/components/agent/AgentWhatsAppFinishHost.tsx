import { memo, useCallback } from 'react';
import { AgentWhatsAppFinishModal } from '@/components/agent/AgentWhatsAppFinishModal';
import { useAgentWhatsAppNotifyStore } from '@/stores/useAgentWhatsAppNotifyStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { patchTurnWhatsAppNotify } from '@/utils/agentWhatsAppNotify';
import { findPaneTab, updatePaneInTabs } from '@/utils/tabGroups';

function AgentWhatsAppFinishHostComponent() {
  const finish = useAgentWhatsAppNotifyStore((state) => state.finish);
  const { selectPane } = useTabActions();

  const handleSent = useCallback(
    (turnId: string, message: string, link: string) => {
      const active = useAgentWhatsAppNotifyStore.getState().finish;

      if (!active || active.turnId !== turnId) {
        return;
      }

      const project = useProjectStore
        .getState()
        .projects.find((entry) => entry.id === active.projectId);

      if (!project) {
        return;
      }

      const pane = findPaneTab(project.tabs, active.paneId);

      if (!pane || pane.type !== 'agent') {
        return;
      }

      const nextTabs = updatePaneInTabs(project.tabs, active.paneId, (tab) => {
        if (tab.type !== 'agent') {
          return tab;
        }

        return {
          ...tab,
          whatsappLink: link,
          turns: patchTurnWhatsAppNotify(tab.turns, turnId, { message, link }),
        };
      });

      void useProjectStore.getState().updateProject(active.projectId, { tabs: nextTabs });
      void selectPane(active.paneId);
    },
    [selectPane],
  );

  if (!finish) {
    return null;
  }

  return <AgentWhatsAppFinishModal payload={finish} onSent={handleSent} />;
}

export const AgentWhatsAppFinishHost = memo(AgentWhatsAppFinishHostComponent);
