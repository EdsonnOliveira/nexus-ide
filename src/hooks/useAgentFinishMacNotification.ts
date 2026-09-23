import { useEffect, useRef } from 'react';
import { useTabActions } from '@/stores/useTabStore';
import { runAgentFinishAction } from '@/utils/runAgentFinishGit';

export function useAgentFinishMacNotification(): void {
  const { selectPane, addAgentTabForProject } = useTabActions();
  const selectPaneRef = useRef(selectPane);
  const addAgentTabForProjectRef = useRef(addAgentTabForProject);

  selectPaneRef.current = selectPane;
  addAgentTabForProjectRef.current = addAgentTabForProject;

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    if (!window.nexus?.agentFinish?.onAction) {
      return;
    }

    return window.nexus.agentFinish.onAction((payload) => {
      void runAgentFinishAction(payload, {
        selectPane: selectPaneRef.current,
        addAgentTabForProject: addAgentTabForProjectRef.current,
      });
    });
  }, []);
}
