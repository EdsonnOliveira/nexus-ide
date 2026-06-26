import { useEffect } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { clearAllAutomationSchedulers, syncAutomationSchedulers } from '@/utils/automationScheduler';
import { executeAutomation } from '@/utils/executeAutomation';

const firedAppOpenTriggers = new Set<string>();

export function useAutomationScheduler(): void {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);

  useEffect(() => {
    clearAllAutomationSchedulers();
    const project = projects.find((item) => item.id === activeProjectId) ?? null;
    syncAutomationSchedulers(project?.id ?? null, project?.automations ?? []);

    if (project && !firedAppOpenTriggers.has(project.id)) {
      firedAppOpenTriggers.add(project.id);
      for (const automation of project.automations ?? []) {
        if (automation.trigger !== 'app_open') {
          continue;
        }

        void executeAutomation(automation, project.id);
      }
    }

    return () => {
      clearAllAutomationSchedulers();
    };
  }, [activeProjectId, projects]);
}
