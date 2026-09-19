import { useEffect, useRef } from 'react';
import { useTabActions } from '@/stores/useTabStore';
import { openAgentFinishPane, runAgentFinishGit } from '@/utils/runAgentFinishGit';

export function useAgentFinishMacNotification(): void {
  const { selectPane, addAgentTabForProject } = useTabActions();
  const selectPaneRef = useRef(selectPane);
  const addAgentTabForProjectRef = useRef(addAgentTabForProject);

  selectPaneRef.current = selectPane;
  addAgentTabForProjectRef.current = addAgentTabForProject;

  useEffect(() => {
    if (!window.nexus?.agentFinish?.onAction) {
      return;
    }

    return window.nexus.agentFinish.onAction((payload) => {
      if (payload.action === 'open') {
        void openAgentFinishPane(payload.projectId, payload.paneId, selectPaneRef.current);
        return;
      }

      void runAgentFinishGit(payload.projectId, payload.paneId, {
        selectPane: selectPaneRef.current,
        addAgentTabForProject: addAgentTabForProjectRef.current,
      });
    });
  }, []);
}
