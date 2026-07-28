import { useEffect } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { clearAllAutomationSchedulers, syncAutomationSchedulers } from '@/utils/automationScheduler';

export function useAutomationScheduler(): void {
  const projectsMigrated = useProjectStore((state) => state.projectsMigrated);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);

  useEffect(() => {
    if (!projectsMigrated) {
      return;
    }

    clearAllAutomationSchedulers();
    const project = projects.find((item) => item.id === activeProjectId) ?? null;
    syncAutomationSchedulers(project?.id ?? null, project?.automations ?? []);

    return () => {
      clearAllAutomationSchedulers();
    };
  }, [activeProjectId, projects, projectsMigrated]);
}
