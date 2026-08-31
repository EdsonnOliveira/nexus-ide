import { useEffect } from 'react';
import type { Automation } from '@/types/automation';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  clearAllAutomationSchedulers,
  syncAutomationSchedulers,
} from '@/utils/automationScheduler';

const EMPTY_AUTOMATIONS: Automation[] = [];

export function useAutomationScheduler(): void {
  const projectsMigrated = useProjectStore((state) => state.projectsMigrated);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const automations = useProjectStore((state) => {
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    return project?.automations ?? EMPTY_AUTOMATIONS;
  });

  useEffect(() => {
    if (!projectsMigrated) {
      return;
    }

    clearAllAutomationSchedulers();
    syncAutomationSchedulers(activeProjectId, automations);

    return () => {
      clearAllAutomationSchedulers();
    };
  }, [activeProjectId, automations, projectsMigrated]);
}
